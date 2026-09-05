import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { originalReviewSchedulingBlock, reviewSchedulingAdapter, originalReviewDispatch, reviewDispatchAdapter, approvedController } from './foundation-review-isolation-oracle'
import { projectFoundationReviewScheduling } from './foundation-review-boundary'
import { resumeFoundationReview, buildSemanticPacketFor, requireSectionAuditIssues, mayIgnoreDuplicateFoundationReviewDispatch } from './stages/foundation-review/public'
import { DispatchError } from './dispatch'
import { FOUNDATION_SEMANTIC_MAX_RUNNING, foundationSemanticTasksComplete } from './foundation-semantic-runtime'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from './foundation-semantic-audit'
import { foundationRuntimeTasks } from './foundation-audit-state'
import { loadCommittedFoundationDerivedArtifacts, loadDeterministicFoundationReview, deriveFoundationAuditArtifacts, publishFoundationDerivedArtifacts, publishDeterministicFoundationReview } from './foundation-audit-artifacts'
import { createFoundationFactStore, digestFactStore } from './foundation-fact-store'
import { FOUNDATION_FACT_CATALOG } from './foundation-fact-definitions'
import { buildFoundationFactStructuredOutputJsonSchema, foundationSemanticReviewerStructuredOutputJsonSchema } from './worker-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun, type WorkerDispatchRequest, type DispatchRecord } from './types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../../__tests__/complete-game-document-fixture'

const dependencies = { readFile, join, foundationRuntimeTasks, loadCommittedFoundationDerivedArtifacts, loadDeterministicFoundationReview, buildSemanticPacketFor, requireSectionAuditIssues, FOUNDATION_SEMANTIC_MAX_RUNNING, foundationSemanticTasksComplete, foundationSemanticReviewerStructuredOutputJsonSchema, buildFoundationFactStructuredOutputJsonSchema, projectFoundationReviewScheduling, resumeFoundationReview }
type Controls = { inFlight?: string[]; fail?: string }
async function capture(block: string, run: DeliveryRun, workspacePath: string, controls: Controls = {}) {
  const events: unknown[] = []
  const action = (name: string) => async () => {
    events.push(name)
    if (controls.fail === name) throw new Error(name + ' failed')
  }
  const dispatch = async (request: WorkerDispatchRequest) => { events.push({ dispatch: request }) }
  const replayTerminal = async (record: DispatchRecord) => { events.push({ replay: record }) }
  const runtime = {
    run, input: { workspacePath }, terminalAdmissionInFlight: new Set(controls.inFlight ?? []),
    dispatcher: { replayTerminal }, handleTerminalUnlocked: () => undefined,
    dispatchFoundationAuditTask: dispatch,
    completeDeterministicFoundationAudit: action('deterministic'),
    finalizeFoundationFacts: action('facts'),
    finalizeFoundationSemanticReview: action('semantic'),
    failFoundationContinuation: async (_run: DeliveryRun, error: Error) => { events.push({ continuationFailure: error.message }) },
  }
  const args = { ...dependencies, ...runtime }
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync('async function schedule() {\n' + block + '\n}')
  try {
    await new Function(...Object.keys(args), js + ';return schedule')(...Object.values(args))()
    return { events }
  } catch (error) { return { events, error: (error as Error).message } }
}

const roots: string[] = []
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }) })
const revision = 'scheduler-equivalence'
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'review-scheduler-equivalence-'))
  roots.push(path)
  for (const document of CANONICAL_FOUNDATION_DOCUMENTS) {
    await mkdir(dirname(join(path, document)), { recursive: true })
    await writeFile(join(path, document), renderTestCompleteGameDocument(document, completeTestSubmission(document)))
  }
  const artifacts = await deriveFoundationAuditArtifacts({ workspacePath: path, revision, checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })) })
  const factStore = createFoundationFactStore([])
  await publishFoundationDerivedArtifacts({ workspacePath: path, revision, documentDigests: artifacts.documentDigests, sectionIndex: artifacts.sectionIndex, factStore, normalizedFactDigest: digestFactStore(factStore), manifest: artifacts.manifest as unknown as Record<string, unknown> })
  const prefix = await publishDeterministicFoundationReview({ workspacePath: path, revision, documentDigests: artifacts.documentDigests, sectionIndex: artifacts.sectionIndex, factStore, issues: [] })
  const semanticTasks = await Promise.all(FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(async (check, index) => {
    const packet = await buildSemanticPacketFor({ workspacePath: path, revision, checkId: check.checkId, sectionIndex: artifacts.sectionIndex, factStore, deterministicReviewDigest: prefix.reviewDigest, deterministicIssuePrefix: [], documentDigests: artifacts.documentDigests })
    return { taskId: 'semantic-' + index, checkId: check.checkId, packetDigest: packet.identity, modelTier: check.modelTier, kind: 'semantic' as const, revision, status: 'pending' as const, attempt: 0 }
  }))
  const factTasks = Array.from({ length: 6 }, (_, index) => ({ taskId: 'fact-' + index, revision, packetDigest: 'a'.repeat(64), modelTier: 'fast' as const, kind: 'document-facts' as const, status: 'pending' as const, factKeyCount: 1, attempt: 0 }))
  const packetsDir = join(path, '.beegame/audit/foundation/' + revision + '/staging/packets')
  await mkdir(packetsDir, { recursive: true })
  for (const task of factTasks) await writeFile(join(packetsDir, task.taskId + '.json'), JSON.stringify({ keys: [FOUNDATION_FACT_CATALOG[0]!.key] }))
  return { path, prefix, semanticTasks, factTasks }
}
function runFor(status: string, tasks: unknown[] = [], reviewDigest?: string): DeliveryRun {
  return {
    runId: 'run', ownerId: 'owner', projectId: 'project', phase: 'DOCUMENT_REVIEW', status: 'running',
    foundationAuditState: { revision, status, tasks, phaseStartedAt: '2026-09-05T00:00:00Z', deterministic: reviewDigest ? { reviewDigest } : undefined },
  } as unknown as DeliveryRun
}
const usage = { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 2 }
const dispatchFor = (taskId: string, status = 'running') => ({ dispatchId: 'dispatch-' + taskId, workerType: 'foundation-semantic-reviewer', phase: 'DOCUMENT_REVIEW', taskId, revision, status, startedAt: '2026-09-05T00:00:00Z' })
async function equivalent(run: DeliveryRun, path: string, controls?: Controls) {
  const beforeRun = structuredClone(run)
  const expected = await capture(originalReviewSchedulingBlock, run, path, controls)
  const actual = await capture(reviewSchedulingAdapter, run, path, controls)
  expect(actual).toEqual(expected)
  expect(run).toEqual(beforeRun)
  return actual
}

describe('Reviewer scheduling isolation and equivalence', () => {
  for (const status of ['facts_staged', 'derived_committed', 'deterministic_ready']) {
    test('preserves continuation and error routing: ' + status, async () => {
      const expectedAction = status === 'facts_staged' ? 'facts' : 'deterministic'
      expect((await equivalent(runFor(status), '/unused')).events).toEqual([expectedAction])
      expect((await equivalent(runFor(status), '/unused', { fail: expectedAction })).events).toEqual([expectedAction, { continuationFailure: expectedAction + ' failed' }])
    })
  }
  test('leaves checklist/non-scheduled statuses untouched and rejects another phase', async () => {
    for (const status of ['audit_ready', 'revision_ready', 'planning']) expect((await equivalent(runFor(status), '/unused')).events).toEqual([])
    const run = runFor('extracting_facts')
    run.phase = 'FOUNDATION_REVISION'
    expect(() => projectFoundationReviewScheduling(run, '/unused')).toThrow('requires DOCUMENT_REVIEW')
  })
  test('projects an owned task snapshot without revision authority or nested reference leaks', () => {
    const task = { taskId: 'task', kind: 'semantic', revision, checkId: 'check', packetDigest: 'a'.repeat(64), modelTier: 'fast', status: 'pending', attempt: 0, usage, dispatch: { ...dispatchFor('task'), terminalResult: { privatePayload: true } }, authority: { forbidden: true }, admittedResult: { forbidden: true } }
    const run = runFor('semantic_review', [task])
    Object.assign(run.foundationAuditState!, { authority: { forbidden: true }, revisionBundles: [{ forbidden: true }], semantic: { aggregateUsage: usage } })
    const frozen = structuredClone(run)
    const context = projectFoundationReviewScheduling(run, '/unused')!
    expect(context).not.toHaveProperty('authority')
    expect(context).not.toHaveProperty('revisionBundles')
    expect(context.tasks[0]).not.toHaveProperty('authority')
    expect(context.tasks[0]).not.toHaveProperty('admittedResult')
    expect(context.tasks[0]!.dispatch).not.toHaveProperty('terminalResult')
    context.tasks[0]!.usage!.total_tokens = 50
    context.tasks[0]!.dispatch!.status = 'completed'
    context.semantic!.aggregateUsage!.total_tokens = 99
    expect(run).toEqual(frozen)
  })
  test('facts preserve queue order, retry eligibility and four-slot cap', async () => {
    const fixture = await workspace()
    for (const running of [0, 2, 4]) {
      const tasks = fixture.factTasks.map((task, index) => ({ ...task, status: index < running ? 'running' : index === running ? 'retryable' : 'pending' }))
      const result = await equivalent(runFor('extracting_facts', tasks), fixture.path)
      expect(result.events.length).toBe(4 - running)
    }
  })
  test('missing and malformed fact packets fail identically', async () => {
    const fixture = await workspace()
    const run = runFor('extracting_facts', fixture.factTasks)
    const packetPath = join(fixture.path, '.beegame/audit/foundation/' + revision + '/staging/packets/fact-0.json')
    await rm(packetPath)
    expect((await equivalent(run, fixture.path)).error).toContain('ENOENT')
    await writeFile(packetPath, '{')
    expect((await equivalent(run, fixture.path)).error).toBeDefined()
  })
  test('semantic dispatch preserves packets, tiers, retries, confirmation and slot count', async () => {
    const fixture = await workspace()
    for (const running of [0, 2, 4]) {
      const tasks = fixture.semanticTasks.map((task, index) => ({ ...task, status: index < running ? 'running' : index === running ? 'retryable' : 'pending' }))
      const result = await equivalent(runFor('semantic_review', tasks, fixture.prefix.reviewDigest), fixture.path)
      expect(result.events.length).toBe(4 - running)
    }
    const source = fixture.semanticTasks[0]!
    const confirmation = { ...source, taskId: 'confirmation', kind: 'confirmation', modelTier: 'strong', sourceTaskId: source.taskId }
    const result = await equivalent(runFor('semantic_review', [confirmation], fixture.prefix.reviewDigest), fixture.path)
    expect(result.events).toHaveLength(1)
  })
  test('semantic replay precedes dispatch and respects in-flight terminal admission', async () => {
    const fixture = await workspace()
    const tasks = fixture.semanticTasks.map((task, index) => ({ ...task, status: 'running', dispatch: { ...dispatchFor(task.taskId), ...(index < 2 ? { terminalResult: { outcome: 'PASS' } } : {}) } }))
    const result = await equivalent(runFor('semantic_review', tasks, fixture.prefix.reviewDigest), fixture.path, { inFlight: ['dispatch-semantic-0'] })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toHaveProperty('replay.dispatchId', 'dispatch-semantic-1')
  })
  test('complete semantic evidence signals finalization; semantic errors remain uncaught here', async () => {
    const fixture = await workspace()
    const tasks = fixture.semanticTasks.map(task => ({ ...task, status: 'completed', terminalDigest: 'b'.repeat(64), usage, durationMs: 1, dispatch: dispatchFor(task.taskId, 'completed') }))
    const run = runFor('semantic_review', tasks, fixture.prefix.reviewDigest)
    expect((await equivalent(run, fixture.path)).events).toEqual(['semantic'])
    expect((await equivalent(run, fixture.path, { fail: 'semantic' })).error).toBe('semantic failed')
    tasks[0]!.terminalDigest = ''
    expect((await equivalent(runFor('semantic_review', tasks, fixture.prefix.reviewDigest), fixture.path)).events).toEqual([])
  })
  test('stale packet binding and changed committed source still fail closed', async () => {
    const fixture = await workspace()
    const run = runFor('semantic_review', fixture.semanticTasks, fixture.prefix.reviewDigest)
    const stale = structuredClone(run)
    stale.foundationAuditState!.tasks[0]!.packetDigest = '0'.repeat(64)
    expect((await equivalent(stale, fixture.path)).error).toBe('semantic retry packet differs from immutable task packet')
    await writeFile(join(fixture.path, CANONICAL_FOUNDATION_DOCUMENTS[0]), '# changed')
    expect((await equivalent(run, fixture.path)).error).toBeDefined()
  })
  test('private scheduler and packet builder do not depend on the controller or revision business', () => {
    for (const file of ['scheduler.ts', 'context.ts', 'packets.ts']) {
      const source = readFileSync(join(import.meta.dir, 'stages/foundation-review', file), 'utf8')
      for (const forbidden of ['DeliveryRun', 'foundationAuditState', 'foundation-revision-', 'foundation-authoring-', "from '../../controller'"]) expect(source).not.toContain(forbidden)
    }
  })
  test('packet and section-issue validation are relocated without business edits', () => {
    const issueHelper = approvedController.slice(approvedController.indexOf('function requireSectionAuditIssues('), approvedController.indexOf('\nclass FoundationFactAttemptError'))
    const packetHelpers = approvedController.slice(approvedController.indexOf('function sectionBytes('), approvedController.indexOf('\nexport function createDeliveryWorkflowController'))
    const source = readFileSync(join(import.meta.dir, 'stages/foundation-review/packets.ts'), 'utf8')
    expect(source).toContain(issueHelper.replace('function requireSectionAuditIssues', 'export function requireSectionAuditIssues'))
    expect(source).toContain(packetHelpers.replace('async function buildSemanticPacketFor', 'export async function buildSemanticPacketFor').replaceAll("import('./", "import('../../"))
  })
})

describe('Reviewer duplicate-dispatch admission equivalence', () => {
  test('preserves duplicate suppression, capacity and every identity check', async () => {
    const taskId = 'task'
    let cases = 0
    for (const kind of ['document-facts', 'semantic', 'confirmation']) {
      for (const status of ['pending', 'retryable', 'running', 'completed']) {
        for (const running of [0, 4]) {
          for (const mismatch of ['none', 'revision', 'packet', 'kind', 'worker', 'dispatch-status', 'missing-task', 'missing-run', 'non-duplicate']) {
            const workerType = kind === 'document-facts' ? 'foundation-fact-extractor' : 'foundation-semantic-reviewer'
            const task = { taskId, kind: mismatch === 'kind' ? 'impacted-facts' : kind, revision: mismatch === 'revision' ? 'stale' : revision, packetDigest: mismatch === 'packet' ? 'stale' : 'a'.repeat(64), status,
              dispatch: { ...dispatchFor(taskId, mismatch === 'dispatch-status' ? 'completed' : 'running'), workerType: mismatch === 'worker' ? 'document-author' : workerType },
            }
            const siblings = Array.from({ length: running }, (_, index) => ({ taskId: 'sibling-' + index, kind: 'document-facts', status: 'running' }))
            const run = runFor('semantic_review', mismatch === 'missing-task' ? siblings : [task, ...siblings])
            const request = { workerType, taskId, revision, contract: { packetDigest: 'a'.repeat(64) } }
            const error = new DispatchError(mismatch === 'non-duplicate' ? 'blocked' : 'duplicate', 'test duplicate')
            const outcomes = []
            for (const source of [originalReviewDispatch, reviewDispatchAdapter]) {
              let reads = 0
              const args = { DispatchError, foundationRuntimeTasks, mayIgnoreDuplicateFoundationReviewDispatch,
                dispatcher: { dispatch: async () => { throw error } },
                store: { load: async () => { reads++; return mismatch === 'missing-run' ? undefined : run } },
              }
              const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
              const fn = new Function(...Object.keys(args), js + ';return dispatchFoundationAuditTask')(...Object.values(args))
              try { await fn(request); outcomes.push({ suppressed: true, reads }) }
              catch (caught) { expect(caught).toBe(error); outcomes.push({ suppressed: false, reads }) }
            }
            expect(outcomes[1]).toEqual(outcomes[0])
            cases++
          }
        }
      }
    }
    expect(cases).toBe(216)
  })
})
