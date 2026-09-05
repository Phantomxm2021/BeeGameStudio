import { describe, expect, test, setSystemTime } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  retryFoundationReviewTasks,
  stopFoundationReviewTask,
  type FoundationReviewLifecycleTask,
} from './stages/foundation-review/lifecycle'
import type { DispatchRecord } from './types'

const BASELINE = '2d2cb26f1acdbb18a3a83b8687b3094093805a80'
const transitionPath = 'packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts'

function baselinePredicates(): {
  isEligibleFoundationRetryTask: (task: unknown, taskId?: string) => boolean
  isUserStoppedFoundationRetryTask: (task: unknown, taskId?: string) => boolean
} {
  const source = execFileSync('git', ['show', `${BASELINE}:${transitionPath}`], { encoding: 'utf8' })
  const start = source.indexOf('const FOUNDATION_MODEL_CONFIGURATION_FAILURES')
  const end = source.indexOf('\nfunction isActionableDocumentRevisionRetryTask', start)
  if (start < 0 || end < 0) throw new Error('baseline retry policy was not found')
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end))
  return new Function(js + ';return { isEligibleFoundationRetryTask, isUserStoppedFoundationRetryTask }')()
}

const baseline = baselinePredicates()
const digest = 'a'.repeat(64)
const usage = { input_tokens: 1, cache_read_tokens: 2, cache_creation_tokens: 3, completion_tokens: 4, total_tokens: 10 }

function dispatch(status: DispatchRecord['status'] = 'running'): DispatchRecord {
  return {
    dispatchId: 'dispatch-task',
    workerType: 'foundation-semantic-reviewer',
    phase: 'DOCUMENT_REVIEW',
    taskId: 'task',
    revision: 'revision',
    status,
    startedAt: '2026-09-05T00:00:00.000Z',
  }
}

function task(overrides: Record<string, unknown> = {}): FoundationReviewLifecycleTask {
  return {
    taskId: 'task',
    kind: 'semantic',
    revision: 'revision',
    checkId: 'check',
    packetDigest: digest,
    modelTier: 'fast',
    status: 'needs_action',
    attempt: 0,
    failureReason: 'foundation semantic fast model is not configured',
    ...overrides,
  } as FoundationReviewLifecycleTask
}

describe('Reviewer lifecycle isolation', () => {
  test('matches the trusted baseline retry predicates across the retry matrix', () => {
    const cases: FoundationReviewLifecycleTask[] = [
      task(),
      task({ kind: 'document-facts', factKeyCount: 1, modelTier: 'fast' }),
      task({ kind: 'confirmation', sourceTaskId: 'source', modelTier: 'strong' }),
      task({ status: 'retryable', dispatch: { ...dispatch('interrupted'), failureReason: 'user stopped workflow' }, failureReason: 'user stopped workflow' }),
      task({ status: 'retryable', dispatch: { ...dispatch('interrupted'), failureReason: 'operator stopped workflow' }, failureReason: 'operator stopped workflow' }),
      task({ status: 'running' }),
      task({ attempt: 1 }),
      task({ failureReason: 'foundation semantic model is not configured', dispatch: dispatch() }),
      task({ terminalDigest: digest }),
      task({ usage }),
      task({ durationMs: 0 }),
      task({ receiptPath: '.beegame/audit/receipt.json' }),
      task({ receiptDigest: digest }),
      task({ resultPath: '.beegame/audit/result.json' }),
      task({ resultDigest: digest }),
      task({ receipt: { terminalDigest: digest } }),
      task({ result: { outcome: 'PASS' } }),
      task({ admittedResult: { outcome: 'PASS' } }),
      task({ failureReason: 'foundation model is not configured' }),
      task({ taskId: 'other' }),
    ]
    for (const candidate of cases) {
      const expected = baseline.isEligibleFoundationRetryTask(candidate, undefined) ||
        baseline.isUserStoppedFoundationRetryTask(candidate, undefined)
      const actual = retryFoundationReviewTasks({ tasks: [candidate] })
      expect(actual.revived).toBe(expected)
      expect(actual.tasks[0]!.status).toBe(expected ? 'pending' : candidate.status)
    }
    expect(retryFoundationReviewTasks({ tasks: [task()], taskId: 'other' }).revived).toBe(false)
    expect(retryFoundationReviewTasks({ tasks: [task()], taskId: 'task' }).revived).toBe(true)
  })

  test('retains optional evidence while whitelisting and cloning the task projection', () => {
    const source = task({
      status: 'retryable',
      failureReason: 'user stopped workflow',
      dispatch: { ...dispatch('interrupted'), request: { nested: { keep: true } } },
      attemptHistory: [{ ...dispatch('failed'), terminalResult: { nested: { keep: true } } }],
      receiptPath: '.beegame/audit/receipt.json',
      receiptDigest: digest,
      resultPath: '.beegame/audit/result.json',
      resultDigest: digest,
      receipt: { nested: { keep: true } },
      result: { nested: { keep: true } },
      admittedResult: { issues: [{ nested: { keep: true } }] },
      privateField: { mustNotCrossBoundary: true },
    }) as FoundationReviewLifecycleTask & { privateField: unknown }
    const before = structuredClone(source)
    const projected = retryFoundationReviewTasks({ tasks: [source] }).tasks[0]!
    expect(projected).not.toHaveProperty('privateField')
    ;(projected.dispatch!.request as unknown as { nested: unknown }).nested = { changed: true }
    projected.attemptHistory![0]!.terminalResult!.nested = { changed: true }
    ;(projected.receipt as { nested: unknown }).nested = { changed: true }
    expect(source).toEqual(before)
    expect(source).toMatchObject({
      receiptPath: source.receiptPath,
      receiptDigest: source.receiptDigest,
      resultPath: source.resultPath,
      resultDigest: source.resultDigest,
      receipt: { nested: { keep: true } },
      result: { nested: { keep: true } },
      admittedResult: { issues: [{ nested: { keep: true } }] },
    })
  })

  test('rejects non-Reviewer task kinds instead of allowing projection to revive them', () => {
    expect(() => retryFoundationReviewTasks({ tasks: [task({ kind: 'impacted-facts' }) as never] })).toThrow(
      'only accepts reviewer task kinds',
    )
  })

  test('stops one active task with the original terminal evidence and callback order', () => {
    setSystemTime(new Date('2026-09-05T01:02:03.000Z'))
    try {
      const source = task({
        status: 'completed',
        attempt: 0,
        dispatch: { ...dispatch(), request: { nested: { keep: true } } },
        attemptHistory: [{ ...dispatch('failed'), terminalResult: { nested: { keep: true } } }],
        receiptPath: '.beegame/audit/receipt.json',
        receiptDigest: digest,
        admittedResult: { outcome: 'PASS', nested: { keep: true } },
        privateField: true,
      }) as FoundationReviewLifecycleTask & { privateField: unknown }
      const before = structuredClone(source)
      const calls: string[] = []
      const stopped = stopFoundationReviewTask({
        task: source,
        reason: 'user stopped workflow',
        interruptDispatch: record => {
          calls.push(`${record.status}:${source.dispatch?.status}`)
          return { ...record, status: 'interrupted', finishedAt: new Date().toISOString(), failureReason: 'user stopped workflow' }
        },
      })
      expect(calls).toEqual(['running:running'])
      expect(stopped).toMatchObject({
        status: 'retryable',
        attempt: 0,
        failureReason: 'user stopped workflow',
        dispatch: { status: 'interrupted', failureReason: 'user stopped workflow', finishedAt: '2026-09-05T01:02:03.000Z' },
        durationMs: 3723000,
        receiptPath: source.receiptPath,
        receiptDigest: source.receiptDigest,
        admittedResult: source.admittedResult,
      })
      expect(stopped).not.toHaveProperty('privateField')
      expect(source).toEqual(before)
      ;(stopped.dispatch as DispatchRecord).failureReason = 'mutated'
      stopped.attemptHistory![0]!.terminalResult!.nested = { changed: true }
      expect(source).toEqual(before)
    } finally {
      setSystemTime()
    }
  })

  test('does not interrupt a task whose dispatch is not running', () => {
    const source = task({ status: 'retryable', dispatch: dispatch('interrupted') })
    let calls = 0
    const result = stopFoundationReviewTask({
      task: source,
      reason: 'operator stopped workflow',
      interruptDispatch: () => { calls += 1; return dispatch('interrupted') },
    })
    expect(calls).toBe(0)
    expect(result).toEqual(source)
    expect(result).not.toBe(source)
  })

  test('lifecycle module is independent of global envelopes and revision internals', () => {
    const source = readFileSync(new URL('./stages/foundation-review/lifecycle.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('DeliveryRun')
    expect(source).not.toContain('FoundationAuditState')
    expect(source).not.toContain('foundation-revision')
    expect(source).not.toContain('transition')
    expect(source).not.toContain('recovery')
  })
})
