import { describe, expect, test } from 'bun:test'
import {
  admitFoundationFactTerminal,
  claimFoundationFactTasks,
  createFoundationFactTaskCollection,
  type FoundationFactTaskCollection,
} from './foundation-fact-runtime'
import { selectFoundationFactFastRuntime, selectFoundationSemanticRuntime } from '../session-manager'

const packet = (taskId: string, packetDigest: string) => ({
  taskId,
  kind: 'document-facts' as const,
  revision: 'rev-1',
  packetDigest,
  modelTier: 'fast' as const,
  status: 'pending' as const,
  attempt: 0,
})

function collection(): FoundationFactTaskCollection {
  return createFoundationFactTaskCollection({
    revision: 'rev-1',
    phaseStartedAt: '2026-08-24T00:00:00.000Z',
    packets: [packet('task-a', 'a'.repeat(64)), packet('task-b', 'b'.repeat(64))],
  })
}

describe('foundation fact runtime', () => {
  test('claims at most four pending tasks and attaches its own dispatch atomically', () => {
    const state = createFoundationFactTaskCollection({
      revision: 'rev-1',
      phaseStartedAt: '2026-08-24T00:00:00.000Z',
      packets: Array.from({ length: 8 }, (_, index) =>
        packet(`task-${index}`, `${index}`.repeat(64)),
      ),
    })
    const claimed = claimFoundationFactTasks(state, {
      dispatchIdFor: task => `dispatch-${task.taskId}`,
      now: '2026-08-24T00:00:01.000Z',
    })
    expect(claimed.tasks.filter(task => task.status === 'running')).toHaveLength(4)
    expect(claimed.tasks.filter(task => task.dispatch)).toHaveLength(4)
    expect(claimed.tasks.every(task => task.status !== 'running' || task.attempt === 1)).toBe(true)
    const second = claimFoundationFactTasks(claimed, {
      dispatchIdFor: task => `dispatch-${task.taskId}`,
      now: '2026-08-24T00:00:02.000Z',
    })
    expect(second.tasks.filter(task => task.status === 'running')).toHaveLength(4)
  })

  test('terminal admission is replay-idempotent and rejects conflicting replay', () => {
    const claimed = claimFoundationFactTasks(collection(), {
      dispatchIdFor: () => 'dispatch-a',
      now: '2026-08-24T00:00:01.000Z',
    })
    const terminal = {
      workerType: 'foundation-fact-extractor' as const,
      status: 'completed' as const,
      runId: 'run-1',
      dispatchId: 'dispatch-a',
      revision: 'rev-1',
      taskId: 'task-a',
      packetDigest: 'a'.repeat(64),
      results: [],
    }
    const first = admitFoundationFactTerminal(claimed, {
      taskId: 'task-a',
      dispatchId: 'dispatch-a',
      revision: 'rev-1',
      packetDigest: 'a'.repeat(64),
      terminal,
      usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 2, total_tokens: 3 },
      durationMs: 10,
      now: '2026-08-24T00:00:02.000Z',
    })
    expect(first.state.tasks[0]?.status).toBe('completed')
    expect(first.state.tasks[0]?.terminalDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(first.state.tasks[0]?.usage?.total_tokens).toBe(3)
    const replay = admitFoundationFactTerminal(first.state, {
      taskId: 'task-a',
      dispatchId: 'dispatch-a',
      revision: 'rev-1',
      packetDigest: 'a'.repeat(64),
      terminal,
      usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 2, total_tokens: 3 },
      durationMs: 10,
      now: '2026-08-24T00:00:03.000Z',
    })
    expect(replay.idempotent).toBe(true)
    expect(() => admitFoundationFactTerminal(first.state, {
      taskId: 'task-a',
      dispatchId: 'dispatch-a',
      revision: 'rev-1',
      packetDigest: 'a'.repeat(64),
      terminal: { ...terminal, status: 'failed' },
      usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 2, total_tokens: 3 },
      durationMs: 10,
      now: '2026-08-24T00:00:03.000Z',
    })).toThrow(/conflicting foundation fact terminal replay/)
  })

  test('does not complete failed terminals and fails safely on measured caps/deadline', () => {
    const claimed = claimFoundationFactTasks(collection(), { dispatchIdFor: () => 'dispatch-a', now: '2026-08-24T00:00:01.000Z' })
    const base = { taskId: 'task-a', dispatchId: 'dispatch-a', revision: 'rev-1', packetDigest: 'a'.repeat(64), terminal: { workerType: 'foundation-fact-extractor' as const, status: 'failed' as const, runId: 'run-1', dispatchId: 'dispatch-a', revision: 'rev-1', taskId: 'task-a', packetDigest: 'a'.repeat(64), results: [] }, durationMs: 1, now: '2026-08-24T00:00:02.000Z' }
    const failed = admitFoundationFactTerminal(claimed, { ...base, usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 2 } })
    expect(failed.accepted).toBe(false)
    expect(failed.state.tasks[0]?.status).toBe('retryable')
    const capped = admitFoundationFactTerminal(claimed, { ...base, terminal: { ...base.terminal, status: 'completed' }, usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 513, total_tokens: 514 } })
    expect(capped.accepted).toBe(false)
    expect(capped.state.tasks[0]?.failureReason).toContain('output token cap')
    const expired = admitFoundationFactTerminal(claimed, { ...base, terminal: { ...base.terminal, status: 'completed' }, usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 2 }, now: '2026-08-24T00:06:00.000Z' })
    expect(expired.state.tasks[0]?.failureReason).toContain('deadline')
  })

  test('zero-task collection is complete without creating a worker dispatch', () => {
    const state = createFoundationFactTaskCollection({ revision: 'rev-1', phaseStartedAt: '2026-08-24T00:00:00.000Z', packets: [] })
    expect(state.tasks).toEqual([])
    expect(state.status).toBe('facts_staged')
  })

  test('fast tier routes to the configured provider model and fails closed when absent', () => {
    expect(selectFoundationFactFastRuntime({ modelType: 'anthropic', env: {} }, { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'fast-model', ANTHROPIC_DEFAULT_SONNET_MODEL: 'balanced-model' })).toMatchObject({ ANTHROPIC_DEFAULT_HAIKU_MODEL: 'fast-model', ANTHROPIC_DEFAULT_SONNET_MODEL: 'fast-model' })
    expect(() => selectFoundationFactFastRuntime(undefined, {})).toThrow(/fast model is not configured/)
  })

  test('semantic fast, balanced and strong tiers route to explicit provider models and fail closed', () => {
    const env = { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'fast-model', ANTHROPIC_DEFAULT_SONNET_MODEL: 'balanced-model', ANTHROPIC_DEFAULT_OPUS_MODEL: 'strong-model' }
    expect(selectFoundationSemanticRuntime({ modelType: 'anthropic', env: {} }, env, 'fast').ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('fast-model')
    expect(selectFoundationSemanticRuntime({ modelType: 'anthropic', env: {} }, env, 'balanced').ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('balanced-model')
    expect(selectFoundationSemanticRuntime({ modelType: 'anthropic', env: {} }, env, 'strong').ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('strong-model')
    expect(() => selectFoundationSemanticRuntime({ modelType: 'anthropic', env: {} }, {}, 'balanced')).toThrow(/balanced.*configured/i)
  })
})
