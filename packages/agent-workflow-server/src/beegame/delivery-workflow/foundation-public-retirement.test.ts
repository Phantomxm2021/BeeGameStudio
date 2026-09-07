import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import { createDeliveryWorkflowController } from './controller'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'
import { transitionDeliveryRun } from './transition'
import { createFoundationRepairRequest, createFoundationCandidateReviewRequest, type FoundationCandidateResult } from './foundation-public-handoff'
import type { ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { firstCandidateFixture } from '../stage-modules/foundation-reviewer/private/test-fixtures/candidate-fixture'
import { buildReviewerTargetedResult } from '../stage-modules/foundation-reviewer/private/targeted-publication'
import { parseReviewerCandidateStart, type ReviewerCandidateInput } from '../stage-modules/foundation-reviewer/private/candidate-contract'
import { prepareReviewerRetryCandidate } from '../stage-modules/foundation-reviewer/private/candidate-handoff'
import { validateReviewerTargetedFacts } from '../stage-modules/foundation-reviewer/private/targeted-preparation'
import { reviewerDigest } from '../stage-modules/foundation-reviewer/private/review-summary'
import followup from '../stage-modules/foundation-revision/private/tests/fixtures/public-followup-inputs.json'

test('unsupported historical review is rejected without rewriting it or contacting workers', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'foundation-retirement-')))
  const store = createRunStore(workspacePath, 'owner')
  const run: DeliveryRun = { ...createInitialDeliveryRun({ ownerId: 'owner', projectId: 'history', confirmedBriefContext: 'history', confirmedBriefDigest: createHash('sha256').update('history').digest('hex') }),
    phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW', foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] } }
  await mkdir(join(workspacePath, '.beegame/workflow'), { recursive: true })
  await writeFile(join(workspacePath, '.beegame/workflow/run.json'), JSON.stringify(run))
  const before = await readFile(join(workspacePath, '.beegame/workflow/run.json'), 'utf8')
  const controller = createDeliveryWorkflowController({ workspacePath, ownerId: run.ownerId, workerPort: {} as never })
  try {
    const inspection = await store.inspectWorkflowSnapshot()
    expect(inspection.currentRun).toBeUndefined()
    expect(inspection.rawText).toBe(before)
    await expect(store.load()).rejects.toThrow(/unsupported|invalid/)
    await expect(controller.resume(run)).rejects.toThrow(/unsupported|invalid/)
    await expect(controller.ensureProgress(run)).rejects.toThrow(/unsupported|invalid/)
    let workerContacts = 0
    await expect(store.reconcile(async () => { workerContacts++; return true })).rejects.toThrow(/unsupported|invalid/)
    expect(workerContacts).toBe(0)
    expect(() => transitionDeliveryRun({ ...run, status: 'needs_action' }, { type: 'retry' })).toThrow('unsupported')
    for (const workerType of ['foundation-fact-extractor', 'foundation-semantic-reviewer', 'foundation-document-reviser']) {
      expect(() => controller.dispatcher.dispatch({ workerType } as never)).toThrow('retired')
      await expect(controller.dispatcher.replayTerminal({ workerType } as never)).rejects.toThrow('retired')
    }
    expect(await readFile(join(workspacePath, '.beegame/workflow/run.json'), 'utf8')).toBe(before)
  } finally {
    try {
      // Shutdown reads the same unsupported snapshot and must also fail closed.
      await expect(controller.dispose()).rejects.toThrow(/unsupported|invalid/)
      expect(await readFile(join(workspacePath, '.beegame/workflow/run.json'), 'utf8')).toBe(before)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  }
})

test('production orchestration no longer imports old reviewer or revision execution helpers', async () => {
  for (const path of ['controller.ts', 'dispatch.ts', 'transition.ts']) {
    const text = await readFile(join(import.meta.dir, path), 'utf8')
    expect(text).not.toMatch(/from ['"].*(?:stages\/foundation-review|foundation-review-boundary|foundation-revision-stage|foundation-revision-publication|foundation-fact-runtime)['"]/)
    expect(text).not.toContain('mutateFoundationReviewTask(')
    expect(text).not.toContain('materializeFoundationRevisionPlanning(')
  }
})

test('public repair mapping retains exact same-round predecessors and new-round source authority', () => {
  const retry = followup.retry.input
  const source = retry.sourceResult as ReviewerReviewResult
  const identity = { ownerId: source.ownerId, projectId: source.projectId }
  const previous = { candidate: retry.previousCandidateResult as FoundationCandidateResult,
    recheck: retry.previousRecheckResult as ReviewerReviewResult }
  const mapped = createFoundationRepairRequest({ ...identity, requestId: 'retry', source, previous })
  expect<unknown>(mapped.input).toEqual(retry)

  // Build a current-policy same-round retry fixture for the consumer-boundary
  // assertion below. The historical JSON above remains a byte-mapping oracle,
  // but its policy digest is intentionally frozen and is not a valid current
  // Reviewer input.
  const first = firstCandidateFixture()
  const validation = validateReviewerTargetedFacts(first.prepared, [])
  const recheck = buildReviewerTargetedResult({ requestId: 'public-retirement-recheck', candidate: first.prepared,
    facts: [], semantic: validation.semantic.map(({ issue, packet }) => ({ issueId: issue.id, output: {
      status: 'FAIL' as const,
      diagnostic: { observedActual: 'still missing', failureReasonCode: 'expected_not_met' as const,
        evidence: packet.sections.map(({ ref }) => ({ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest })) },
    } })) })
  const binding = (value: { ownerId: string; projectId: string; resultId: string }) => ({
    ownerId: value.ownerId, projectId: value.projectId, resultId: value.resultId, resultDigest: reviewerDigest(value) })
  const previousCandidate = first.input.candidateResult
  const currentPrevious = { candidateId: previousCandidate.candidateId, candidateResultId: previousCandidate.resultId,
    candidateResultDigest: reviewerDigest(previousCandidate), recheckResultId: recheck.resultId, recheckResultDigest: reviewerDigest(recheck) }
  const candidate = { ...first.input.candidateResult, requestId: 'public-retirement-retry', candidateId: 'public-retirement-candidate-two', previous: currentPrevious }
  const { resultId: _ignoredResultId, ...candidateBody } = candidate
  candidate.resultId = reviewerDigest(candidateBody)
  const currentMapped = createFoundationCandidateReviewRequest({ ownerId: candidate.ownerId, projectId: candidate.projectId,
    requestId: 'public-retirement-recheck', source: first.input.sourceResult, candidate: candidate as FoundationCandidateResult,
    previous: { candidate: previousCandidate as FoundationCandidateResult, recheck: recheck as ReviewerReviewResult } })
  type CurrentReviewerRetryStart = {
    protocolVersion: 1
    requestId: string
    ownerId: string
    projectId: string
    inputDigest: string
    input: Extract<ReviewerCandidateInput, { kind: 'retry' }>
  }
  const currentStart = currentMapped as unknown as CurrentReviewerRetryStart
  expect(() => parseReviewerCandidateStart(currentStart)).not.toThrow()

  // Substituting the new candidate as its previous candidate must fail at the
  // consumer's public input boundary; orchestration cannot silently bless it.
  const corrupted = structuredClone(currentStart.input)
  corrupted.previousCandidateResult = corrupted.candidateResult
  corrupted.previousCandidateBinding = corrupted.candidateBinding
  expect(() => prepareReviewerRetryCandidate(corrupted)).toThrow('retry candidate predecessor authority mismatch')
  const next = followup.nextRound.input.sourceResult as ReviewerReviewResult
  expect<unknown>(createFoundationRepairRequest({ ownerId: next.ownerId, projectId: next.projectId,
    requestId: 'next', source: next }).input).toEqual(followup.nextRound.input)
})
