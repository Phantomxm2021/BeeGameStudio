import { expect, test } from 'bun:test'
import { buildRevisionRetryCandidate } from '../followup-candidate'
import { prepareRevisionRequest } from '../request-preparation'
import { prepareRevisionWorkerInputs } from '../worker-input'
import { acceptRevisionRequest, commitRevisionRequestCandidate } from '../request-store'
import { openRevisionAttemptStore } from '../attempt-store'
import { publishRevisionCompletedCandidate } from '../completed-candidate'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { revisionDigest } from '../json-digest'
import { candidateFixtureFromReview } from '../../../foundation-reviewer/private/test-fixtures/candidate-fixture'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { buildReviewerTargetedResult } from '../../../foundation-reviewer/private/targeted-publication'
import { prepareReviewerRetryCandidate } from '../../../foundation-reviewer/private/candidate-handoff'
import { validateReviewerTargetedFacts } from '../../../foundation-reviewer/private/targeted-preparation'

function binding(result: { ownerId: string; projectId: string; resultId: string }) {
  return { ownerId: result.ownerId, projectId: result.projectId, resultId: result.resultId, resultDigest: revisionDigest(result) }
}

test('deterministic failure retains DEFERRED document bytes without describing the semantic result as PASS', async () => {
  const documents = reviewFixtureDocuments(true)
  documents[0]!.content = documents[0]!.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]')
  const review = completedReviewFixture({ documents, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback', expected: 'readable feedback', actual: 'missing',
      sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  const changed = documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md'
    ? doc.content.replace('game.mechanics:', 'More readable feedback.\n\ngame.mechanics:')
    : doc.path === 'docs/TECHNICAL_DESIGN.md' ? doc.content.replace('technical.supported_actions:',
      'Documentation updated without adding the required action.\n\ntechnical.supported_actions:') : doc.content }))
  const first = candidateFixtureFromReview(review, changed)
  const recheck = buildReviewerTargetedResult({ requestId: 'deferred-recheck', candidate: first.prepared, facts: [], semantic: [] })
  expect(recheck.recheck.documentVerdicts.find(doc => doc.documentPath === 'docs/GDD.md')!.status).toBe('DEFERRED')
  const revised = changed.map(doc => ({ ...doc, content: doc.path === 'docs/TECHNICAL_DESIGN.md'
    ? doc.content.replace('technical.supported_actions: ["move","attack","dash"]', 'technical.supported_actions: ["move","attack","dash","parry"]') : doc.content }))
  const input = { sourceResult: first.input.sourceResult, sourceBinding: first.input.sourceBinding,
    previousCandidateResult: first.input.candidateResult, previousCandidateBinding: first.input.candidateBinding,
    previousRecheckResult: recheck, previousRecheckBinding: binding(recheck), requestId: 'deferred-retry', candidateDocuments: revised }
  const retry = buildRevisionRetryCandidate(input)
  const { candidateDocuments: _documents, ...request } = input
  const plan = prepareRevisionRequest({ ...request, kind: 'retry_same_round', ownerId: recheck.ownerId, projectId: recheck.projectId })
  expect(plan.retainedDocumentPaths).toEqual(['docs/GDD.md'])
  expect(plan.batches.map(batch => batch.documentPath)).toEqual(['docs/TECHNICAL_DESIGN.md'])
  expect(plan.staging.documents[0]!.content).toBe(first.input.candidateResult.documents[0]!.content)
  expect(plan.staging.documents.find(doc => doc.path === 'docs/TECHNICAL_DESIGN.md')!.content)
    .toBe(first.input.sourceResult.documents.find(doc => doc.path === 'docs/TECHNICAL_DESIGN.md')!.content)
  expect(plan.dispatchIssueIds.length).toBeLessThan(plan.repairIssueIds.length)
  expect(plan.previous?.candidateId).toBe(first.input.candidateResult.candidateId)
  const workerInputs = prepareRevisionWorkerInputs(plan.request)
  expect(workerInputs).toHaveLength(1)
  expect(workerInputs[0]!.packet.documentPath).toBe('docs/TECHNICAL_DESIGN.md')
  expect(workerInputs[0]!.packet.baseDocumentDigest)
    .toBe(first.input.sourceResult.documents.find(doc => doc.path === 'docs/TECHNICAL_DESIGN.md')!.digest)
  expect(workerInputs[0]!.packet.issueIds).toEqual(plan.dispatchIssueIds)
  expect(retry.documents[0]!.content).toBe(first.input.candidateResult.documents[0]!.content)
  expect(retry).not.toHaveProperty('issueVerdicts')
  expect(retry.repairClaims.every(claim => claim.status === 'APPLIED')).toBe(true)
  const prepared = prepareReviewerRetryCandidate({ ...input, candidateResult: retry, candidateBinding: binding(retry) })
  const semantic = validateReviewerTargetedFacts(prepared, []).semantic.map(({ issue }) => ({ issueId: issue.id, output: { status: 'PASS' } }))
  expect(semantic).toHaveLength(1)
  expect(buildReviewerTargetedResult({ requestId: 'retry-review', candidate: prepared, facts: [], semantic }).kind).toBe('passed')
  const changedRetained = revised.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md' ? doc.content + '\nunauthorized retained edit' : doc.content }))
  expect(() => buildRevisionRetryCandidate({ ...input, candidateDocuments: changedRetained })).toThrow('retained')
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'revision-durable-retry-')))
  try {
    const accepted = await acceptRevisionRequest(workspace, plan.request)
    const committed = await commitRevisionRequestCandidate(workspace, { request: plan.request, candidateDocuments: revised,
      unresolvedIssues: plan.unresolvedIssues })
    expect(committed.candidate.candidateId).toBe(accepted.record.candidateId)
    expect(committed.candidate.candidateId).not.toBe(first.input.candidateResult.candidateId)
    expect(committed.candidate.previous).toEqual(plan.previous!)
    expect(prepareReviewerRetryCandidate({ ...input, candidateResult: committed.candidate, candidateBinding: binding(committed.candidate) })
      .candidate.candidateId).toBe(accepted.record.candidateId)
    await expect(commitRevisionRequestCandidate(workspace, { request: plan.request, candidateDocuments: changedRetained,
      unresolvedIssues: plan.unresolvedIssues })).rejects.toThrow('retained')
    await expect(commitRevisionRequestCandidate(workspace, { request: plan.request, candidateDocuments: revised,
      unresolvedIssues: [{ issueId: plan.repairIssueIds[0]!, reason: 'caller changed scope' }] })).rejects.toThrow('unresolved')
    const receiptRequest = { ...plan.request, requestId: 'deferred-receipt-retry' }
    const store = await openRevisionAttemptStore(workspace, receiptRequest)
    const batch = plan.batches[0]!
    if (batch.scope !== 'section') throw new Error('expected section retry fixture')
    const repaired = revised.find(document => document.path === batch.documentPath)!.content
    const lines = repaired.split('\n')
    const markdown = buildFoundationSectionIndex({ documents: { [batch.documentPath]: repaired } })
      .filter(section => batch.sectionIds.includes(section.sectionId))
      .map(section => lines.slice(section.startLine - 1, section.endLine).join('\n').trim()).join('\n\n')
    const attempt = await store.begin(batch.documentPath)
    await store.settle(batch.documentPath, { status: 'completed', attemptId: attempt.attemptId, markdown, usageEvents: [],
      completion: { scope: 'direct-child', pid: 12345, exitCode: 0, signalCode: null, stdoutDrained: true, termination: 'none' } })
    const fromReceipts = await publishRevisionCompletedCandidate(workspace, receiptRequest)
    expect(fromReceipts.result.documents[0]!.content).toBe(first.input.candidateResult.documents[0]!.content)
    expect(fromReceipts.result.previous).toEqual(plan.previous!)
    const receiptRecheck = prepareReviewerRetryCandidate({ ...input, candidateResult: fromReceipts.result, candidateBinding: binding(fromReceipts.result) })
    expect(receiptRecheck.candidate.resultId).toBe(fromReceipts.result.resultId)
    await expect(store.begin('docs/GDD.md')).rejects.toThrow('no dispatch')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
