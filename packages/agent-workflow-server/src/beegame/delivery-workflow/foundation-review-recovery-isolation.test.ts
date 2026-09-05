import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { foundationRuntimeTasks, isFoundationRevisionPhase } from './foundation-audit-state'
import { projectFoundationReviewReplay } from './foundation-review-boundary'
import { replayFoundationReviewTerminals, foundationReviewContinuationFailure, foundationReviewFailureNeedsAction } from './stages/foundation-review/public'
import type { DeliveryRun } from './types'
import { reviewerLifecycleBaseline, restoreReviewerLifecycleSource } from './foundation-review-lifecycle-oracle'

const root = resolve(import.meta.dir, '../../../../..')
const directory = 'packages/agent-workflow-server/src/beegame/delivery-workflow/'
const baselineSource = (file: string) => execFileSync('git', ['show', '2d2cb26f1:' + directory + file], { cwd: root, encoding: 'utf8' })
const baseline = baselineSource('controller.ts')
const current = () => readFileSync(join(root, directory, 'controller.ts'), 'utf8')
function replayBlock(source: string) {
  const start = source.indexOf("    if (\n      run.phase === 'DOCUMENT_REVIEW' &&\n      run.foundationAuditState &&", source.indexOf('  async function resumeUnlocked('))
  const end = source.indexOf("    if (run.phase === 'FOUNDATION_REVISION'", start)
  if (start < 0 || end < start) throw new Error('replay source markers missing')
  return source.slice(start, end)
}
function runFixture(): DeliveryRun {
  const tasks = ['running', 'retryable', 'needs_action', 'completed', 'pending'].map((status, index) => ({
    taskId: 'task-' + index, kind: index % 2 ? 'semantic' : 'document-facts', status,
    dispatch: { dispatchId: 'dispatch-' + index, status: 'completed', terminalResult: { index } },
  }))
  return { runId: 'run', phase: 'DOCUMENT_REVIEW', status: 'running', foundationAuditState: { status: 'semantic_review', tasks } } as unknown as DeliveryRun
}
async function replayTrace(source: string, run: DeliveryRun, options: { inFlight?: string[]; failAt?: string; changeDuringReplay?: boolean } = {}) {
  const trace: unknown[] = []
  const deps = {
    foundationRuntimeTasks, isFoundationRevisionPhase, projectFoundationReviewReplay, replayFoundationReviewTerminals,
    terminalAdmissionInFlight: new Set(options.inFlight ?? []),
    handleTerminalUnlocked: () => undefined,
    dispatcher: { replayTerminal: async (record: unknown) => {
      trace.push(structuredClone(record))
      if (options.changeDuringReplay) run.foundationAuditState!.tasks = []
      if ((record as { dispatchId: string }).dispatchId === options.failAt) throw new Error('replay failed')
    } },
  }
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync('async function replay(run) {\n' + replayBlock(source) + "\nreturn 'fallthrough'\n}")
  const fn = new Function(...Object.keys(deps), code + ';return replay')(...Object.values(deps))
  try { trace.push({ result: await fn(run) }) } catch (error) { trace.push({ error: (error as Error).message }) }
  return trace
}
function failureSource(source: string) {
  return source.slice(source.indexOf('  async function failFoundationContinuation('), source.indexOf('\n  async function handleTerminal('))
}
async function failureTrace(source: string, error: unknown, options: { missing?: boolean; changedId?: boolean; failCommit?: boolean } = {}) {
  const trace: unknown[] = []
  const run = { ...runFixture(), resourceProductionState: { preserve: ['private'] } } as unknown as DeliveryRun
  const deps = {
    foundationReviewContinuationFailure,
    store: {
      mutationLock: async (runId: string) => { trace.push({ lock: runId }); return 'lease' },
      load: async (lease: string) => { trace.push({ load: lease }); return options.missing ? undefined : { ...run, runId: options.changedId ? 'another-run' : run.runId } },
      commit: async (...args: unknown[]) => { trace.push({ commit: args }); if (options.failCommit) throw new Error('commit failed') },
      unlock: async (lease: string) => { trace.push({ unlock: lease }) },
    },
  }
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(failureSource(source))
  const fn = new Function(...Object.keys(deps), code + ';return failFoundationContinuation')(...Object.values(deps))
  try { await fn(run, error) } catch (error) { trace.push({ error: (error as Error).message }) }
  return trace
}

describe('Reviewer recovery orchestration equivalence', () => {
  test('only the approved adapters change across all four shared lifecycle files', () => {
    for (const file of ['controller.ts', 'dispatch.ts', 'transition.ts', 'recovery.ts'] as const) {
      expect(restoreReviewerLifecycleSource(file, readFileSync(join(root, directory, file), 'utf8'))).toBe(reviewerLifecycleBaseline(file))
    }
  })
  test('replays every unfinished terminal in original order, before scheduling', async () => {
    const before = await replayTrace(baseline, runFixture())
    expect(await replayTrace(current(), runFixture())).toEqual(before)
    expect(before.slice(0, -1).map(item => (item as any).dispatchId)).toEqual(['dispatch-0', 'dispatch-1', 'dispatch-2', 'dispatch-4'])
  })
  test('preserves in-flight exclusion, no-op phases, failed replay, and captured dispatch identities', async () => {
    for (const options of [{ inFlight: ['dispatch-0', 'dispatch-2'] }, { failAt: 'dispatch-1' }, { changeDuringReplay: true }]) {
      expect(await replayTrace(current(), runFixture(), options)).toEqual(await replayTrace(baseline, runFixture(), options))
    }
    for (const phase of ['DOCUMENT_DRAFTING', 'DOCUMENT_REVIEW', 'FOUNDATION_REVISION', 'IMPLEMENTATION']) {
      for (const status of ['index_staged', 'extracting_facts', 'facts_staged', 'derived_committed', 'semantic_review', 'audit_ready', 'planning', 'revising', 'revision_ready']) {
        const run = runFixture()
        run.phase = phase as never
        run.foundationAuditState!.status = status as never
        expect(await replayTrace(current(), structuredClone(run))).toEqual(await replayTrace(baseline, structuredClone(run)))
      }
    }
    const run = runFixture()
    run.foundationAuditState = undefined
    expect(await replayTrace(current(), run)).toEqual(await replayTrace(baseline, run))
  })
  test('replay snapshot excludes private state and keeps pre-await filtering semantics', async () => {
    const unusedPorts = {
      isTerminalAdmissionInFlight: () => { throw new Error('unexpected check') },
      replayTerminal: async () => { throw new Error('unexpected replay') },
    }
    expect(replayFoundationReviewTerminals(undefined, unusedPorts)).toBeUndefined()
    expect(replayFoundationReviewTerminals({ tasks: [] }, unusedPorts)).toBeUndefined()
    const run = runFixture()
    const snapshot = projectFoundationReviewReplay(run)!
    expect(Object.keys(snapshot)).toEqual(['tasks'])
    expect(Object.keys(snapshot.tasks[0]!).sort()).toEqual(['dispatchId', 'hasTerminalResult', 'status'])
    const replayed: string[] = []
    const inFlight = new Set<string>()
    const operation = replayFoundationReviewTerminals(snapshot, {
      isTerminalAdmissionInFlight: id => inFlight.has(id),
      replayTerminal: async id => {
        replayed.push(id)
        inFlight.add('dispatch-1')
        Object.assign(snapshot.tasks[1]!, { dispatchId: 'changed', status: 'completed' })
      },
    })
    await operation
    expect(replayed).toEqual(['dispatch-0', 'dispatch-1', 'dispatch-2', 'dispatch-4'])
    expect(run.foundationAuditState!.tasks[1]!.dispatch!.dispatchId).toBe('dispatch-1')
  })
  test('continuation failure matches complete lock/commit/unlock/error trace', async () => {
    for (const error of [new Error('derived marker missing'), 'unavailable', { reason: 'opaque' }, undefined]) {
      for (const options of [{}, { missing: true }, { changedId: true }, { failCommit: true }]) {
        expect(await failureTrace(current(), error, options)).toEqual(await failureTrace(baseline, error, options))
      }
    }
  })
  test('failure policy keeps fact/semantic/confirmation thresholds and leaves Revision untouched', () => {
    const before = baselineSource('dispatch.ts')
    const after = readFileSync(join(root, directory, 'dispatch.ts'), 'utf8')
    const helper = before.slice(before.indexOf('  function isTerminalFoundationFactFailure('), before.indexOf('\n  async function completeFoundationFactDispatch('))
    const statement = (source: string) => source.slice(source.indexOf('        const stage3Task ='), source.indexOf('\n        return {', source.indexOf('        const stage3Task =')))
    const oracle = new Function('task', 'reason', new Bun.Transpiler({ loader: 'ts' }).transformSync(helper) + statement(before) + '\nreturn needsAction')
    const actual = new Function('task', 'reason', 'foundationReviewFailureNeedsAction', statement(after) + '\nreturn needsAction')
    for (const kind of ['document-facts', 'semantic', 'confirmation', 'document-revision', 'impacted-facts', 'semantic-recheck']) {
      for (const attempt of [0, 1, 2, 3]) {
        for (const reason of ['provider unavailable', 'FAST MODEL unavailable', 'model config invalid', 'attempt cap reached', 'model not configured', 'user stopped']) {
          expect(actual({ kind, attempt }, reason, foundationReviewFailureNeedsAction)).toBe(oracle({ kind, attempt }, reason))
        }
      }
    }
  })
})
