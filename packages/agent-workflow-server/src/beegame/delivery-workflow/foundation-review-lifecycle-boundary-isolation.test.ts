import { afterEach, describe, expect, setSystemTime, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as review from './stages/foundation-review/public'
import * as boundary from './foundation-review-boundary'
import * as factRuntime from './foundation-fact-runtime'
import * as semanticRuntime from './foundation-semantic-runtime'
import { foundationRuntimeTasks } from './foundation-audit-state'
import { projectTaskTerminalEvidence } from './task-terminal-evidence'
import { parseDispatchRecord } from './schema'
import { reviewerLifecycleBaseline } from './foundation-review-lifecycle-oracle'
import type { DeliveryRun, DispatchRecord } from './types'

const usage = { input_tokens: 2, cache_read_tokens: 1, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 6 }
const zero = { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }
const revision = 'review-lifecycle-boundary'
const startedAt = '2026-09-05T00:00:00.000Z'
const stoppedAt = '2026-09-05T00:00:02.000Z'
const current = (file: string) => readFileSync(join(import.meta.dir, file), 'utf8')
const normalize = (value: unknown) => JSON.parse(JSON.stringify(value))
afterEach(() => setSystemTime())

function task(index: number, kind: string = 'document-facts'): any {
  const taskId = 'task-' + index
  const dispatch: DispatchRecord = {
    dispatchId: 'dispatch-' + index, workerType: kind === 'document-facts' ? 'foundation-fact-extractor' : 'foundation-semantic-reviewer',
    phase: 'DOCUMENT_REVIEW', revision, taskId, status: 'running', startedAt, usage: { ...usage },
    terminalEvidencePath: 'evidence-' + index, request: {
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/fixture',
      workerType: kind === 'document-facts' ? 'foundation-fact-extractor' : 'foundation-semantic-reviewer',
      phase: 'DOCUMENT_REVIEW', revision, taskId, allowedPaths: [], contract: { preserved: ['nested'] },
    },
  }
  return {
    taskId, kind, revision, packetDigest: 'a'.repeat(64), status: 'running', attempt: 1,
    ...(kind === 'document-facts' ? { factKeyCount: 1, modelTier: 'fast' } : { checkId: 'check-' + index, modelTier: kind === 'confirmation' ? 'strong' : 'fast' }),
    ...(kind === 'confirmation' ? { sourceTaskId: 'source-' + index } : {}),
    dispatch, attemptHistory: [{ ...structuredClone(dispatch), status: 'failed', dispatchId: 'old-' + index }],
  }
}
function fixture(kinds = ['document-facts', 'semantic', 'confirmation']): DeliveryRun {
  return {
    runId: 'run', ownerId: 'owner', projectId: 'project', phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW',
    status: 'running', revision: { document: revision, workspace: 'workspace-revision' },
    foundationDraftState: { completedPaths: [] }, resourceProductionState: { preserve: ['private'] },
    foundationAuditState: { revision, status: 'extracting_facts', phaseStartedAt: startedAt, aggregateUsage: { ...usage },
      semantic: { aggregateUsage: { ...usage }, deepPhaseStartedAt: startedAt, deepAggregateUsage: { ...zero } },
      tasks: kinds.map((kind, index) => task(index, kind)) },
  } as unknown as DeliveryRun
}
function compile(source: string, name: string, deps: Record<string, unknown>) {
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.replace(/^export /m, ''))
  return new Function(...Object.keys(deps), code + ';return ' + name)(...Object.values(deps))
}

async function stopTrace(source: string, run: DeliveryRun, options: { failCommit?: boolean; failTransport?: boolean } = {}) {
  const trace: unknown[] = []
  const deps = {
    ...review, foundationRuntimeTasks, projectTaskTerminalEvidence,
    acquireAndLoad: async () => ({ run: structuredClone(run), lease: 'lease', unlock: async () => { trace.push('unlock') } }),
    // The unchanged global transition is outside this operation's seam.
    transitionDeliveryRun: (run: DeliveryRun) => ({ ...run, status: 'stopped', blockedReason: 'user stopped' }),
    runningAuthorDispatches: () => [],
    stopAuthorState: (state: unknown) => state,
  }
  const fn = compile(source.slice(source.indexOf('export async function stopRun(')), 'stopRun', deps)
  try {
    const result = await fn({
      runId: run.runId, reason: 'user stopped', store: { commit: async (next: unknown, ...args: unknown[]) => {
        trace.push({ commit: next, args }); if (options.failCommit) throw new Error('commit failure'); return next
      } },
      stopDispatch: async (id: string, reason: string) => { trace.push({ stop: id, reason }); if (options.failTransport && id === 'dispatch-0') throw new Error('transport failure') },
    })
    trace.push({ result })
  } catch (error) { trace.push({ error: (error as Error).message }) }
  return normalize(trace)
}

function retryTrace(source: string, run: DeliveryRun, taskId?: string) {
  const helpers = source.slice(source.indexOf('const FOUNDATION_MODEL_CONFIGURATION_FAILURES'), source.indexOf('function isActionableDocumentRevisionRetryTask('))
  const start = source.includes('        const auditRetry =') ? source.indexOf('        const auditRetry =') : source.indexOf('        let auditRevived = false')
  const end = source.indexOf('    let revisionRevived = false', start)
  const code = helpers + '\nfunction retry(auditState, event) {\n' + source.slice(start, end) + '\nreturn { auditRevived, nextAuditState }\n}'
  return normalize(compile(code, 'retry', { ...boundary })(run.foundationAuditState, { taskId }))
}

class TestDispatchError extends Error {
  constructor(readonly code: string, reason: string) { super(reason); this.name = 'DispatchError' }
}
async function claimTrace(source: string, run: DeliveryRun, kind: string, mode: string) {
  const isFact = kind === 'document-facts'
  const request = {
    taskId: mode === 'missing-task' ? 'missing' : 'task-0',
    workerType: isFact ? 'foundation-fact-extractor' : 'foundation-semantic-reviewer',
    contract: { modelTier: kind === 'confirmation' ? 'strong' : 'fast' },
    ...(mode === 'no-schema' ? {} : { workflowJsonSchema: {} }),
  }
  const record = { ...run.foundationAuditState!.tasks[0]!.dispatch!, dispatchId: 'new-dispatch', startedAt }
  const trace: unknown[] = []
  const first = source.slice(source.indexOf('        let claimedFoundationState:'), source.indexOf('        const active = currentFactTask', source.indexOf('        let claimedFoundationState:')))
  const secondStart = source.indexOf('        const next = revisionTaskRequest && request.taskId && currentRevisionTask')
  const second = source.slice(secondStart, source.indexOf('      } finally {', secondStart))
  const code = 'async function claim(current, request, record, fastModelError) {\n' + first + second + '\nreturn { claimedFoundationState, claimedSemanticState }\n}'
  const deps = {
    ...factRuntime, ...semanticRuntime, ...review, ...boundary, foundationRuntimeTasks,
    factRequest: isFact, semanticRequest: !isFact, revisionFactRequest: mode === 'revision-bypass', revisionTaskRequest: false,
    currentRevisionTask: undefined, currentFoundationPath: undefined, lease: 'lease',
    DispatchError: TestDispatchError,
    options: { store: { commit: async (...args: unknown[]) => { trace.push({ commit: args }); if (mode === 'commit-failure') throw new Error('commit failure') } } },
  }
  try { trace.push({ result: await compile(code, 'claim', deps)(structuredClone(run), request, record, mode === 'model-error' ? 'model probe unavailable' : undefined) }) }
  catch (error) { trace.push({ error: (error as Error).message, code: (error as TestDispatchError).code }) }
  return normalize(trace)
}

describe('Reviewer lifecycle shared adapter equivalence', () => {
  test('full stopRun preserves commit-before-unlock-before-transport and all failure paths', async () => {
    setSystemTime(new Date(stoppedAt))
    for (const mode of ['normal', 'completed-task-running-dispatch', 'non-running-dispatch', 'zero-attempt', 'revision-task', 'commit-failure', 'transport-failure']) {
      const run = fixture()
      if (mode === 'completed-task-running-dispatch') run.foundationAuditState!.tasks[0]!.status = 'completed'
      if (mode === 'non-running-dispatch') run.foundationAuditState!.tasks[0]!.dispatch!.status = 'completed'
      if (mode === 'zero-attempt') run.foundationAuditState!.tasks[0]!.attempt = 0
      if (mode === 'revision-task') Object.assign(run.foundationAuditState!.tasks[0]!, { kind: 'impacted-facts', round: 3, customRevisionEvidence: { preserve: true } })
      const options = { failCommit: mode === 'commit-failure', failTransport: mode === 'transport-failure' }
      const actual = await stopTrace(current('recovery.ts'), run, options)
      expect(actual).toEqual(await stopTrace(reviewerLifecycleBaseline('recovery.ts'), run, options))
      if (mode === 'normal') {
        expect(actual[1]).toBe('unlock')
        expect(actual[2].stop).toBe('dispatch-0')
        expect(actual[0].commit.foundationAuditState.tasks.map((task: any) => task.attempt)).toEqual([0, 0, 0])
      }
    }
  })
  test('global retry map changes only eligible Reviewer statuses and preserves every other field', () => {
    for (const mode of ['all', 'selected', 'missing', 'model-config', 'stale-evidence', 'revision-task']) {
      const run = fixture()
      for (const task of run.foundationAuditState!.tasks) {
        task.status = 'retryable'; task.dispatch!.status = 'interrupted'; task.failureReason = 'operator stopped'
      }
      if (mode === 'model-config' || mode === 'stale-evidence') {
        const target = run.foundationAuditState!.tasks[0]!
        target.status = 'needs_action'; target.attempt = 0; target.dispatch = undefined
        target.failureReason = 'foundation fact fast model is not configured'
        if (mode === 'stale-evidence') Object.assign(target, { resultPath: '' })
      }
      if (mode === 'revision-task') Object.assign(run.foundationAuditState!.tasks[0]!, { kind: 'impacted-facts', round: 1 })
      const id = mode === 'selected' ? 'task-0' : mode === 'missing' ? 'missing' : undefined
      expect(retryTrace(current('transition.ts'), run, id)).toEqual(retryTrace(reviewerLifecycleBaseline('transition.ts'), run, id))
    }
  })
  test('single-dispatch stop preserves the baseline observable task evidence', async () => {
    setSystemTime(new Date(stoppedAt))
    for (const kind of ['document-facts', 'semantic', 'confirmation', 'impacted-facts']) {
      const value = task(0, kind)
      function projected(source: string) {
        const start = source.indexOf("      const stopped = await mutateFoundationReviewTask(dispatchId, 'dispatch.interrupted'")
        const end = source.indexOf('\n      releaseDispatch(', start)
        const operation = source.slice(start, end) + '\nreturn stopped'
        return compile('async function stop() {\n' + operation + '\n}', 'stop', {
          ...review, parseDispatchRecord, dispatchId: value.dispatch.dispatchId, reason: 'user stopped', now: () => stoppedAt,
          mutateFoundationReviewTask: async (_id: string, _type: string, mutate: Function) => {
            const changed = mutate({ task: structuredClone(value), record: structuredClone(value.dispatch) })
            return { ...changed, task: projectTaskTerminalEvidence(changed.task, changed.record) }
          },
        })()
      }
      expect(await projected(current('dispatch.ts'))).toEqual(await projected(reviewerLifecycleBaseline('dispatch.ts')))
    }
  })
  for (const kind of ['document-facts', 'semantic', 'confirmation']) {
    test('claim adapter preserves blocked commits and final dispatch state for ' + kind, async () => {
      for (const mode of ['claimed', 'no-schema', 'model-error', 'missing-task', 'capacity', 'attempt-limit', 'deep-empty', 'commit-failure', 'revision-bypass']) {
        const run = fixture(Array(5).fill(kind))
        run.foundationAuditState!.status = kind === 'document-facts' ? 'extracting_facts' : 'semantic_review'
        for (const task of run.foundationAuditState!.tasks) { task.status = 'pending'; task.attempt = 0 }
        if (mode === 'capacity') for (const task of run.foundationAuditState!.tasks.slice(1)) { task.status = 'running'; task.attempt = 1 }
        if (mode === 'attempt-limit') run.foundationAuditState!.tasks[0]!.attempt = kind === 'confirmation' ? 1 : 2
        if (mode === 'deep-empty') run.foundationAuditState!.semantic!.deepPhaseStartedAt = ''
        const actual = await claimTrace(current('dispatch.ts'), run, kind, mode)
        expect(actual).toEqual(await claimTrace(reviewerLifecycleBaseline('dispatch.ts'), run, kind, mode))
        if (mode === 'claimed') expect(actual[0].commit[1].type).toBe('dispatch.started')
        if (mode === 'model-error' || mode === 'attempt-limit' || mode === 'capacity') expect(actual.at(-1).code).toBe('blocked')
      }
    })
  }
})
