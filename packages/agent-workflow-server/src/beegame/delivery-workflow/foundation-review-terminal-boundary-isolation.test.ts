import { afterEach, describe, expect, setSystemTime, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import * as artifacts from './foundation-audit-artifacts'
import * as extraction from './foundation-fact-extraction'
import * as facts from './foundation-fact-store'
import * as stateTools from './foundation-audit-state'
import * as semantic from './foundation-semantic-audit'
import * as semanticRuntime from './foundation-semantic-runtime'
import * as factRuntime from './foundation-fact-runtime'
import * as checks from './foundation-audit-check-definitions'
import * as policy from './foundation-revision-round-policy'
import * as merge from './foundation-final-issue-merge'
import * as terminalEvidence from './task-terminal-evidence'
import * as review from './stages/foundation-review/public'
import * as boundary from './foundation-review-boundary'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun, type DispatchRecord } from './types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../../__tests__/complete-game-document-fixture'

const root = resolve(import.meta.dir, '../../../../..')
const controllerPath = 'packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts'
const baseline = execFileSync('git', ['show', 'a35320472:' + controllerPath], { cwd: root, encoding: 'utf8' })
const current = () => readFileSync(join(root, controllerPath), 'utf8')
const paths: string[] = []
const revision = 'terminal-boundary-equivalence'
const now = '2026-09-05T00:00:02.000Z'
const start = '2026-09-05T00:00:00.000Z'
const usage = { input_tokens: 2, cache_read_tokens: 1, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 6 }
const zero = { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }

afterEach(async () => {
  setSystemTime()
  await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function dispatch(taskId: string, workerType: DispatchRecord['workerType']): DispatchRecord {
  return { dispatchId: taskId + ':dispatch', workerType, phase: 'DOCUMENT_REVIEW', revision, taskId,
    status: 'completed', startedAt: start, finishedAt: '2026-09-05T00:00:01.000Z', usage: { ...usage },
    terminalEvidencePath: 'evidence/' + taskId, startingUsage: { ...zero } }
}

async function fixture() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'review-terminal-boundary-'))
  paths.push(workspacePath)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    await mkdir(dirname(join(workspacePath, path)), { recursive: true })
    await writeFile(join(workspacePath, path), renderTestCompleteGameDocument(path, completeTestSubmission(path)))
  }
  const staged = await artifacts.deriveFoundationAuditArtifacts({ workspacePath, revision,
    checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })) })
  const factStore = facts.createFoundationFactStore([])
  const derived = await artifacts.publishFoundationDerivedArtifacts({ workspacePath, revision, documentDigests: staged.documentDigests,
    sectionIndex: staged.sectionIndex, factStore, normalizedFactDigest: facts.digestFactStore(factStore), manifest: staged.manifest as never })
  const prefix = await artifacts.publishDeterministicFoundationReview({ workspacePath, revision, documentDigests: staged.documentDigests,
    sectionIndex: staged.sectionIndex, factStore, issues: [] })
  const state = stateTools.createFoundationAuditState({ revision, documentDigests: staged.documentDigests, manifest: staged.manifest })
  state.status = 'semantic_review'
  state.phaseStartedAt = start
  state.semantic = { aggregateUsage: { ...zero } }
  const derivedPath = '.beegame/audit/foundation/' + revision + '/derived/'
  state.derived = {
    manifestPath: derivedPath + 'manifest.json', manifestDigest: derived.digests.manifest,
    markerPath: derivedPath + 'COMMITTED.json', markerDigest: derived.digests.marker,
    factStorePath: derivedPath + 'fact-store.json', factStoreDigest: derived.digests.factStore,
    sectionIndexPath: derivedPath + 'section-index.json', sectionIndexDigest: derived.digests.sectionIndex,
  }
  const reviewPath = '.beegame/audit/foundation/' + revision + '/staging/review/' + prefix.reviewDigest + '/'
  state.deterministic = {
    reviewDigest: prefix.reviewDigest, issueRegistryPath: reviewPath + 'issue-registry.json', issueRegistryDigest: prefix.digests.issueRegistry,
    manifestPath: reviewPath + 'manifest.json', manifestDigest: prefix.digests.manifest, markerPath: reviewPath + 'COMMITTED.json',
    markerDigest: prefix.digests.marker, catalogVersion: prefix.catalogVersion, contractGraphDigest: prefix.contractGraphDigest,
    sectionIndexDigest: prefix.sectionIndexDigest, factStoreDigest: prefix.factStoreDigest,
  }
  const packets = []
  for (const [index, check] of semantic.FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.entries()) {
    const packet = await review.buildSemanticPacketFor({ workspacePath, revision, checkId: check.checkId, sectionIndex: staged.sectionIndex,
      factStore, deterministicReviewDigest: prefix.reviewDigest, deterministicIssuePrefix: [], documentDigests: staged.documentDigests })
    packets.push(packet)
    const taskId = 'semantic-' + index
    state.tasks.push({ taskId, kind: 'semantic', revision, checkId: check.checkId, packetDigest: packet.identity, modelTier: check.modelTier,
      status: 'completed', attempt: 1, dispatch: dispatch(taskId, 'foundation-semantic-reviewer'), terminalDigest: 'digest-' + index,
      usage: { ...usage }, durationMs: 1000, admittedResult: { checkId: check.checkId, packetIdentity: packet.identity, outcome: 'PASS' } })
  }
  const run = { runId: 'run', ownerId: 'owner', projectId: 'project', phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW',
    status: 'running', revision: { document: revision, workspace: 'workspace-revision' }, foundationAuditState: state,
    resourceProductionState: { sentinel: ['untouched'] }, foundationDraftState: { sentinel: ['private'] } } as unknown as DeliveryRun
  return { workspacePath, run, packets }
}

type Operation = 'summary' | 'semantic' | 'facts'
type CaseInput = { run: DeliveryRun; workspacePath: string; record?: DispatchRecord; result?: any; request?: any; controls?: {
  failCommit?: boolean; failFinalize?: boolean; lockedStatus?: string; staleDispatch?: boolean; committedStatus?: string;
}}
const dependencies = { ...artifacts, ...extraction, ...facts, ...stateTools, ...semantic, ...semanticRuntime, ...factRuntime,
  ...checks, ...policy, ...merge, ...terminalEvidence, ...review, ...boundary, CANONICAL_FOUNDATION_DOCUMENTS, readFile, join }

function sourceFor(source: string, operation: Operation) {
  if (operation === 'summary') return source.slice(source.indexOf('  async function finalizeFoundationSemanticReview('), source.indexOf('\n  async function handleTerminalUnlocked('))
  const marker = operation === 'semantic' ? "    if (foundationSemanticTask && result.workerType === 'foundation-semantic-reviewer')" : "    if (foundationFactTask && result.workerType === 'foundation-fact-extractor')"
  const end = operation === 'semantic' ? "    if (foundationFactTask && result.workerType === 'foundation-fact-extractor')" : '    let next: DeliveryRun'
  return 'async function operation(run, record, result, request, foundationSemanticTask, foundationFactTask) {\n' +
    source.slice(source.indexOf(marker), source.indexOf(end, source.indexOf(marker))) + '\n}'
}
async function tree(path: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {}
  async function visit(prefix: string) {
    for (const item of await readdir(join(path, prefix), { withFileTypes: true })) {
      const name = join(prefix, item.name)
      if (item.isDirectory()) await visit(name)
      else entries[name] = await readFile(join(path, name), 'utf8')
    }
  }
  await visit('')
  return entries
}
async function capture(source: string, operation: Operation, input: CaseInput) {
  let durable = structuredClone(input.run)
  const trace: unknown[] = []
  const controls = input.controls ?? {}
  const store = {
    mutationLock: async (runId: string) => { trace.push({ lock: runId }); return 'lease' },
    load: async (lease?: string) => {
      trace.push({ load: lease ?? null })
      const next = structuredClone(durable)
      if (lease && controls.lockedStatus) next.foundationAuditState!.status = controls.lockedStatus as never
      if (lease && controls.staleDispatch) next.foundationAuditState!.tasks[0]!.dispatch!.dispatchId = 'stale'
      return next
    },
    commit: async (next: DeliveryRun, event: unknown) => {
      trace.push({ commit: structuredClone(next), event: structuredClone(event), filesAtCommit: await tree(input.workspacePath) })
      if (controls.failCommit) throw new Error('injected commit failure')
      durable = structuredClone(next)
      if (controls.committedStatus) durable.foundationAuditState!.status = controls.committedStatus as never
      return structuredClone(durable)
    },
    unlock: async () => { trace.push('unlock') },
  }
  const deps = { ...dependencies, store, input: { workspacePath: input.workspacePath },
    resumeUnlocked: async (run: DeliveryRun) => { trace.push({ resume: structuredClone(run) }) },
    finalizeFoundationSemanticReview: async (run: DeliveryRun) => { trace.push({ finalizeSemantic: structuredClone(run) }) },
    finalizeFoundationFacts: async (run: DeliveryRun) => { trace.push({ finalizeFacts: structuredClone(run) }); if (controls.failFinalize) throw new Error('injected finalize failure') },
    failFoundationContinuation: async (run: DeliveryRun, error: Error) => { trace.push({ failContinuation: structuredClone(run), error: error.message }) },
  }
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(sourceFor(source, operation))
  const fn = new Function(...Object.keys(deps), code + '; return ' + (operation === 'summary' ? 'finalizeFoundationSemanticReview' : 'operation'))(...Object.values(deps))
  try {
    await fn(input.run, input.record, input.result, input.request, input.run.foundationAuditState!.tasks[0], input.run.foundationAuditState!.tasks[0])
  } catch (error) { trace.push({ error: (error as Error).message, name: (error as Error).name }) }
  return JSON.parse(JSON.stringify({ trace, durable, files: await tree(input.workspacePath) }))
}

async function equivalent(operation: Operation, configure: (value: Awaited<ReturnType<typeof fixture>>) => Promise<CaseInput> | CaseInput) {
  setSystemTime(new Date(now))
  const before = await fixture()
  const after = await fixture()
  const left = await capture(baseline, operation, await configure(before))
  const right = await capture(current(), operation, await configure(after))
  expect(right).toEqual(left)
  return right
}

function semanticInput(value: Awaited<ReturnType<typeof fixture>>): CaseInput {
  const task = value.run.foundationAuditState!.tasks[0]!
  const record = structuredClone(task.dispatch!)
  task.status = 'running'
  task.dispatch!.status = 'running'
  delete task.terminalDigest
  delete task.usage
  delete task.durationMs
  delete (task as any).admittedResult
  const result = { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: record.dispatchId,
    taskId: task.taskId, revision, packetDigest: task.packetDigest, outcome: 'PASS' }
  return { ...value, record, result }
}
async function factInput(value: Awaited<ReturnType<typeof fixture>>): Promise<CaseInput> {
  const state = value.run.foundationAuditState!
  const staged = await artifacts.loadFoundationAuditArtifacts({ workspacePath: value.workspacePath, revision })
  const documents = new Map(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(value.workspacePath, path), 'utf8')] as const)))
  const extracted = extraction.extractNormalizedFoundationFacts({ documents, sectionIndex: staged!.sectionIndex })
  const packet = extraction.buildFoundationFactPackets({ revision, documents, sectionIndex: staged!.sectionIndex, unresolvedKeys: extracted.unresolvedKeys })[0]!
  const record = dispatch('fact-0', 'foundation-fact-extractor')
  state.status = 'extracting_facts'
  state.aggregateUsage = { ...usage }
  state.tasks = [{ taskId: 'fact-0', kind: 'document-facts', revision, packetDigest: packet.packetDigest, factKeyCount: packet.keys.length,
    modelTier: 'fast', status: 'running', attempt: 1, dispatch: { ...record, status: 'running' }, attemptHistory: [{ ...record, dispatchId: 'previous' }] }]
  return { ...value, record, request: { contract: { packet } }, result: { workerType: 'foundation-fact-extractor', status: 'completed',
    runId: 'run', dispatchId: record.dispatchId, taskId: 'fact-0', revision, packetDigest: packet.packetDigest,
    results: packet.keys.map(key => ({ key, status: 'absent' })) } }
}

describe('Reviewer full controller boundary equivalence', () => {
  test('summary PASS commits then unlocks then hands off to Checklist; preserves unrelated state', async () => {
    const result = await equivalent('summary', value => value)
    expect(result.trace.at(-1).resume.documentStep).toBe('CHECKLIST_DRAFTING')
    expect(result.trace.at(-2)).toBe('unlock')
  })
  test('summary ISSUES publishes identical authority and starts revision', async () => {
    const result = await equivalent('summary', value => {
      const task = value.run.foundationAuditState!.tasks[0] as any
      const packet = value.packets[0]!
      const sectionKey = packet.sections[0]!.sectionKey
      task.admittedResult = semantic.admitFoundationSemanticResult(packet, { checkId: task.checkId, packetIdentity: packet.identity,
        outcome: 'ISSUES', issues: [{ problem: 'incoherent rule', expected: 'consistent rule', actual: 'contradiction', sourceSectionKey: sectionKey,
          remediation: { kind: 'patch', sectionKeys: [sectionKey] } }] })
      return value
    })
    expect(result.trace.at(-1).resume.phase).toBe('FOUNDATION_REVISION')
    expect(result.trace.at(-1).resume.foundationAuditState.tasks).toEqual([])
  })
  test('summary honors confirmation override and both result ledger digests', async () => {
    await equivalent('summary', value => {
      const task = value.run.foundationAuditState!.tasks[0] as any
      const confirmation = { ...structuredClone(task), kind: 'confirmation', taskId: task.taskId + ':confirmation', sourceTaskId: task.taskId, modelTier: 'strong' }
      task.admittedResult = { checkId: task.checkId, packetIdentity: task.packetDigest, outcome: 'UNDECIDABLE', reason: 'needs confirmation' }
      value.run.foundationAuditState!.tasks.push(confirmation)
      return value
    })
  })
  for (const mode of ['audit_ready', 'facts_staged', 'missing-result', 'undecidable', 'commit-failure']) {
    test('summary exact no-op/error boundary: ' + mode, async () => {
      await equivalent('summary', value => {
        if (mode === 'missing-result') delete (value.run.foundationAuditState!.tasks[0] as any).admittedResult
        if (mode === 'undecidable') (value.run.foundationAuditState!.tasks[0] as any).admittedResult.outcome = 'UNDECIDABLE'
        return { ...value, controls: mode === 'commit-failure' ? { failCommit: true } : ['audit_ready', 'facts_staged'].includes(mode) ? { lockedStatus: mode } : {} }
      })
    })
  }
  for (const mode of ['pass', 'undecidable', 'confirmation-undecidable', 'blocked-sibling', 'retryable', 'needs-action', 'unmeasured', 'conflict', 'replay', 'stale', 'commit-failure', 'postcommit-planning']) {
    test('semantic terminal exact state/event/continuation boundary: ' + mode, async () => {
      const result = await equivalent('semantic', value => {
        const input = semanticInput(value)
        const task = input.run.foundationAuditState!.tasks[0] as any
        if (mode === 'undecidable') Object.assign(input.result, { outcome: 'UNDECIDABLE', reason: 'needs more evidence' })
        if (mode === 'confirmation-undecidable') {
          Object.assign(task, { kind: 'confirmation', modelTier: 'strong', sourceTaskId: 'source-task' })
          input.run.foundationAuditState!.semantic!.deepPhaseStartedAt = start
          input.run.foundationAuditState!.semantic!.deepAggregateUsage = { ...zero }
          Object.assign(input.result, { outcome: 'UNDECIDABLE', reason: 'still undecidable' })
        }
        if (mode === 'blocked-sibling') input.run.foundationAuditState!.tasks[1]!.status = 'needs_action'
        if (mode === 'retryable' || mode === 'needs-action') {
          input.result.status = 'failed'
          input.record!.status = 'failed'
          task.attempt = mode === 'retryable' ? 1 : 2
        }
        if (mode === 'unmeasured') delete input.record!.usage
        input.record!.terminalResult = structuredClone(input.result)
        if (mode === 'replay' || mode === 'conflict') {
          task.status = 'completed'
          task.terminalDigest = mode === 'replay' ? semanticRuntime.digestFoundationSemanticTerminal(input.result) : 'conflicting'
          task.admittedResult = { checkId: task.checkId, packetIdentity: task.packetDigest, outcome: 'PASS' }
        }
        input.controls = mode === 'stale' ? { staleDispatch: true } : mode === 'commit-failure' ? { failCommit: true } : mode === 'postcommit-planning' ? { committedStatus: 'planning' } : {}
        return input
      })
      if (mode === 'pass') expect(result.trace.at(-1).finalizeSemantic).toBeTruthy()
      if (mode === 'undecidable') expect(result.durable.foundationAuditState.tasks).toHaveLength(11)
      if (mode === 'confirmation-undecidable' || mode === 'blocked-sibling') expect(result.durable.status).toBe('needs_action')
      if (mode === 'retryable' || mode === 'needs-action') expect(result.durable.foundationAuditState.tasks[0].status).toBe(mode === 'retryable' ? 'retryable' : 'needs_action')
    })
  }
  for (const mode of ['complete', 'pending-sibling', 'retryable', 'needs-action', 'replay', 'conflict', 'missing-packet', 'invalid-result', 'stale', 'commit-failure', 'finalize-failure', 'artifact-revision']) {
    test('fact terminal exact receipt/event/continuation boundary: ' + mode, async () => {
      const result = await equivalent('facts', async value => {
        const input = await factInput(value)
        const task = input.run.foundationAuditState!.tasks[0]!
        if (mode === 'pending-sibling') input.run.foundationAuditState!.tasks.push({ ...structuredClone(task), taskId: 'sibling', status: 'pending' })
        if (mode === 'retryable' || mode === 'needs-action') {
          input.result.status = 'failed'
          input.record!.status = 'failed'
          task.attempt = mode === 'retryable' ? 1 : 2
        }
        if (mode === 'replay' || mode === 'conflict') {
          task.status = 'completed'
          task.terminalDigest = mode === 'replay' ? factRuntime.digestFoundationFactTerminal(input.result) : 'conflict'
          input.run.foundationAuditState!.status = 'facts_staged'
          delete input.request
        }
        if (mode === 'missing-packet') delete input.request
        if (mode === 'invalid-result') input.result.results = []
        if (mode === 'artifact-revision') input.run.revision.document = 'different-envelope-revision'
        input.controls = mode === 'stale' ? { staleDispatch: true } : mode === 'commit-failure' ? { failCommit: true } : mode === 'finalize-failure' ? { failFinalize: true } : {}
        return input
      })
      if (mode === 'complete') expect(result.trace.at(-1).finalizeFacts).toBeTruthy()
      if (mode === 'finalize-failure') expect(result.trace.at(-1).failContinuation).toBeTruthy()
      if (mode === 'retryable' || mode === 'needs-action') expect(result.durable.foundationAuditState.tasks[0].status).toBe(mode === 'retryable' ? 'retryable' : 'needs_action')
    })
  }
})

describe('Reviewer projection and implementation boundaries', () => {
  test('whitelists review fields and isolates nested terminal evidence from caller state', async () => {
    const value = await fixture()
    const state = value.run.foundationAuditState! as any
    state.authority = { sentinel: ['revision-private'] }
    state.tasks[0].revisionPrivate = { sentinel: ['private'] }
    const original = structuredClone(value.run)
    const summary = boundary.projectFoundationReviewSummary(value.run, value.workspacePath)
    const terminal = boundary.projectFoundationSemanticTerminal(value.run)
    expect(Object.keys(summary.snapshot).sort()).toEqual(['derived', 'deterministic', 'revision', 'tasks'])
    expect(Object.keys(terminal).sort()).toEqual(['aggregateUsage', 'deterministicReviewDigest', 'phaseStartedAt', 'revision', 'tasks'])
    expect('revisionPrivate' in terminal.tasks[0]!).toBe(false)
    Object.assign(summary.snapshot.tasks[0]!.admittedResult!, { outcome: 'UNDECIDABLE' })
    terminal.tasks[0]!.dispatch!.usage!.total_tokens = 999
    terminal.aggregateUsage.total_tokens = 999
    expect(value.run).toEqual(original)
    const input = await factInput(value)
    const factOriginal = structuredClone(value.run)
    const projected = boundary.projectFoundationFactTerminal(value.run, value.workspacePath, 'fact-0', input.record!, input.result, input.request.contract.packet)
    expect(Object.keys(projected.snapshot).sort()).toEqual(['aggregateUsage', 'artifactRevision', 'documentDigests', 'manifestPath', 'phase', 'phaseStartedAt', 'revision', 'sectionIndexDigest', 'sectionIndexPath', 'status', 'tasks'])
    projected.snapshot.tasks[0]!.attemptHistory![0]!.usage!.total_tokens = 999
    projected.record.usage!.total_tokens = 999
    expect(value.run).toEqual(factOriginal)
    expect(input.record!.usage!.total_tokens).toBe(6)
  })
  test('private business has no global run/store/controller or sibling-stage dependency', () => {
    for (const name of ['summary', 'semantic-terminal', 'fact-terminal']) {
      const source = readFileSync(join(import.meta.dir, 'stages/foundation-review/' + name + '.ts'), 'utf8')
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      expect(code).not.toMatch(/\b(?:DeliveryRun|FoundationAuditState|mutationLock|resumeUnlocked)\b/)
      expect(code).not.toMatch(/from ['"][^'"]*(?:controller|foundation-authoring|foundation-revision\/|game-ir)[^'"]*['"]/)
      expect(code).not.toContain('store.commit')
    }
  })
})
