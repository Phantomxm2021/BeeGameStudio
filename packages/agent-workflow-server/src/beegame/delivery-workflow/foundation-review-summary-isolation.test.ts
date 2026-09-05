import { afterEach, describe, expect, setSystemTime, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../../__tests__/complete-game-document-fixture'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  deriveFoundationAuditArtifacts,
  loadCommittedFoundationDerivedArtifacts,
  loadDeterministicFoundationReview,
  publishFoundationSemanticReview,
  publishDeterministicFoundationReview,
  publishFoundationDerivedArtifacts,
} from './foundation-audit-artifacts'
import { createFoundationFactStore, digestFactStore } from './foundation-fact-store'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, type FoundationSemanticResult } from './foundation-semantic-audit'
import { buildSemanticPacketFor } from './stages/foundation-review/packets'
import { prepareFoundationReviewSummary, type FoundationReviewSummaryInput } from './stages/foundation-review/summary'
import { foundationRuntimeTasks, summarizeFoundationIssues } from './foundation-audit-state'
import { compileFoundationIssueRegistry } from './foundation-audit-check-definitions'
import { mergeExactFoundationReviewIssues } from './foundation-final-issue-merge'
import { evaluateFoundationRevisionRoundPolicy } from './foundation-revision-round-policy'
import { requireSectionAuditIssues } from './stages/foundation-review/packets'

const roots: string[] = []
const revision = 'summary-isolation'

afterEach(async () => {
  setSystemTime()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{
  workspacePath: string
  input: FoundationReviewSummaryInput
  packets: Map<string, Awaited<ReturnType<typeof buildSemanticPacketFor>>>
}> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-review-summary-'))
  roots.push(workspacePath)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    await mkdir(dirname(join(workspacePath, path)), { recursive: true })
    await writeFile(join(workspacePath, path), renderTestCompleteGameDocument(path, completeTestSubmission(path)))
  }
  const staged = await deriveFoundationAuditArtifacts({
    workspacePath,
    revision,
    checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })),
  })
  const factStore = createFoundationFactStore([])
  const derived = await publishFoundationDerivedArtifacts({
    workspacePath,
    revision,
    documentDigests: staged.documentDigests,
    sectionIndex: staged.sectionIndex,
    factStore,
    normalizedFactDigest: digestFactStore(factStore),
    manifest: staged.manifest as unknown as Record<string, unknown>,
  })
  const prefix = await publishDeterministicFoundationReview({
    workspacePath,
    revision,
    documentDigests: staged.documentDigests,
    sectionIndex: staged.sectionIndex,
    factStore,
    issues: [],
  })
  const derivedRoot = `.beegame/audit/foundation/${revision}/derived`
  const derivedBinding = {
    manifestPath: `${derivedRoot}/manifest.json`, manifestDigest: derived.digests.manifest,
    markerPath: `${derivedRoot}/COMMITTED.json`, markerDigest: derived.digests.marker,
    factStorePath: `${derivedRoot}/fact-store.json`, factStoreDigest: derived.digests.factStore,
    sectionIndexPath: `${derivedRoot}/section-index.json`, sectionIndexDigest: derived.digests.sectionIndex,
  }
  const reviewRoot = `.beegame/audit/foundation/${revision}/staging/review/${prefix.reviewDigest}`
  const deterministic = {
    reviewDigest: prefix.reviewDigest,
    issueRegistryPath: `${reviewRoot}/issue-registry.json`, issueRegistryDigest: prefix.digests.issueRegistry,
    manifestPath: `${reviewRoot}/manifest.json`, manifestDigest: prefix.digests.manifest,
    markerPath: `${reviewRoot}/COMMITTED.json`, markerDigest: prefix.digests.marker,
    catalogVersion: prefix.catalogVersion, contractGraphDigest: prefix.contractGraphDigest,
    sectionIndexDigest: prefix.sectionIndexDigest, factStoreDigest: prefix.factStoreDigest,
  }
  const packets = new Map<string, Awaited<ReturnType<typeof buildSemanticPacketFor>>>()
  for (const check of FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks) {
    packets.set(check.checkId, await buildSemanticPacketFor({
      workspacePath, revision, checkId: check.checkId, sectionIndex: staged.sectionIndex,
      factStore, deterministicReviewDigest: prefix.reviewDigest, deterministicIssuePrefix: [], documentDigests: staged.documentDigests,
    }))
  }
  return {
    workspacePath,
    input: { workspacePath, snapshot: { revision, derived: derivedBinding, deterministic, tasks: [] } },
    packets,
  }
}

function sourceTasks(
  packets: Map<string, Awaited<ReturnType<typeof buildSemanticPacketFor>>>,
  resultFor: (checkId: string, packetIdentity: string) => FoundationSemanticResult,
): FoundationReviewSummaryInput['snapshot']['tasks'] {
  return FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map((check, index) => {
    const packet = packets.get(check.checkId)!
    return {
      taskId: `${revision}:semantic:${index}`,
      kind: 'semantic' as const,
      revision,
      checkId: check.checkId,
      packetDigest: packet.identity,
      status: 'completed',
      admittedResult: resultFor(check.checkId, packet.identity),
    }
  })
}

/** Execute the pre-extraction controller operation as the trusted oracle. */
async function baselineFinalize(input: FoundationReviewSummaryInput): Promise<any> {
  const root = join(import.meta.dir, '../../../../../')
  const source = execFileSync('git', ['show', 'a35320472244714876bee1a8d1662f513df8315f:packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts'], { cwd: root, encoding: 'utf8' })
  const start = source.indexOf('  async function finalizeFoundationSemanticReview(')
  const end = source.indexOf('\n  async function handleTerminalUnlocked(', start)
  const operation = source.slice(start, end)
  const run = {
    runId: 'baseline-run',
    foundationAuditState: {
      ...input.snapshot,
      status: 'semantic_review',
    },
  }
  let durable = structuredClone(run)
  const store = {
    mutationLock: async () => 'lease',
    load: async () => structuredClone(durable),
    commit: async (next: any) => { durable = structuredClone(next); return next },
    unlock: async () => undefined,
  }
  const dependencies = {
    store,
    input: { workspacePath: input.workspacePath },
    resumeUnlocked: async () => undefined,
    foundationRuntimeTasks,
    loadCommittedFoundationDerivedArtifacts,
    loadDeterministicFoundationReview,
    buildSemanticPacketFor,
    requireSectionAuditIssues,
    digestFoundationSemanticResult: (await import('./foundation-semantic-audit')).digestFoundationSemanticResult,
    semanticResultToFoundationIssueDrafts: (await import('./foundation-semantic-audit')).semanticResultToFoundationIssueDrafts,
    FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
    compileFoundationIssueRegistry,
    mergeExactFoundationReviewIssues,
    publishFoundationSemanticReview,
    evaluateFoundationRevisionRoundPolicy,
    summarizeFoundationIssues,
  }
  const generated = new Bun.Transpiler({ loader: 'ts' }).transformSync(operation)
  const finalize = new Function(...Object.keys(dependencies), `${generated};return finalizeFoundationSemanticReview`)(...Object.values(dependencies))
  await finalize(run)
  return durable
}

describe('Reviewer semantic summary isolation', () => {
  test('publishes the same bound PASS review and captures mutable inputs before reads', async () => {
    setSystemTime(new Date('2026-09-05T00:00:00.000Z'))
    const value = await fixture()
    const tasks = sourceTasks(value.packets, (checkId, packetIdentity) => ({ checkId, packetIdentity, outcome: 'PASS', issues: [] }))
    const baselineTasks = structuredClone(tasks)
    const input = { ...value.input, snapshot: { ...value.input.snapshot, tasks } }
    const pending = prepareFoundationReviewSummary(input)
    input.snapshot.revision = 'mutated'
    ;(tasks[0]!.admittedResult as any).checkId = 'mutated'
    const result = await pending
    const baseline = await baselineFinalize({ ...value.input, snapshot: { ...value.input.snapshot, tasks: baselineTasks } })
    expect(result.kind).toBe('proceed')
    expect(result.review).toEqual(baseline.foundationAuditState.review)
    expect(result.review.issueSummary).toEqual({ total: 0, blocker: 0, high: 0, medium: 0, low: 0 })
    expect(await loadDeterministicFoundationReview({ workspacePath: value.workspacePath, revision, reviewDigest: value.input.snapshot.deterministic!.reviewDigest })).toBeTruthy()
  })

  test('confirmation result takes precedence and issues produce revision authority', async () => {
    setSystemTime(new Date('2026-09-05T00:00:00.000Z'))
    const value = await fixture()
    const tasks = [...sourceTasks(value.packets, (checkId, packetIdentity) => ({ checkId, packetIdentity, outcome: 'PASS', issues: [] }))]
    const check = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks[0]!
    const packet = value.packets.get(check.checkId)!
    const issue = { problem: 'fixture issue', expected: 'expected', actual: 'actual', sourceSectionKey: packet.sections[0]!.sectionKey, remediation: { kind: 'patch' as const, sectionKeys: [packet.sections[0]!.sectionKey] } }
    tasks[0] = { ...tasks[0]!, admittedResult: { checkId: check.checkId, packetIdentity: packet.identity, outcome: 'ISSUES', issues: [issue] } }
    tasks.push({ taskId: `${revision}:confirmation:0`, kind: 'confirmation', revision, checkId: check.checkId, sourceTaskId: tasks[0]!.taskId, packetDigest: packet.identity, status: 'completed', admittedResult: { checkId: check.checkId, packetIdentity: packet.identity, outcome: 'ISSUES', issues: [issue] } })
    const result = await prepareFoundationReviewSummary({ ...value.input, snapshot: { ...value.input.snapshot, tasks } })
    const baseline = await baselineFinalize({ ...value.input, snapshot: { ...value.input.snapshot, tasks: structuredClone(tasks) } })
    expect(result.kind).toBe('revision-required')
    if (result.kind === 'revision-required') {
      expect(baseline.foundationAuditState.issueSummary).toEqual(result.review.issueSummary)
      expect(baseline.foundationAuditState.authority.issueAuthority).toEqual(result.authority.issueAuthority)
      expect(result.review.issueSummary.total).toBe(1)
      expect((result.authority.issueAuthority as any).reviewDigest).toBe(result.review.reviewDigest)
      expect(result.roundBefore.issueRegistryDigest).toBe(result.review.issueRegistryDigest)
      expect(result.phaseStartedAt).toBe('2026-09-05T00:00:00.000Z')
    }
  })

  test('missing authority and undecidable confirmation fail closed with original errors', async () => {
    const value = await fixture()
    const tasks = sourceTasks(value.packets, (checkId, packetIdentity) => ({ checkId, packetIdentity, outcome: 'PASS', issues: [] }))
    await expect(prepareFoundationReviewSummary({ ...value.input, snapshot: { ...value.input.snapshot, derived: undefined, tasks } })).rejects.toThrow('semantic finalization requires deterministic and derived bindings')
    await expect(prepareFoundationReviewSummary({ ...value.input, snapshot: { ...value.input.snapshot, deterministic: undefined, tasks } })).rejects.toThrow('semantic finalization requires deterministic and derived bindings')
    ;(tasks[0] as any).admittedResult = { checkId: tasks[0]!.checkId, packetIdentity: tasks[0]!.packetDigest, outcome: 'UNDECIDABLE', reason: 'uncertain' }
    await expect(prepareFoundationReviewSummary({ ...value.input, snapshot: { ...value.input.snapshot, tasks } })).rejects.toThrow('semantic confirmation remained undecidable')
  })
})
