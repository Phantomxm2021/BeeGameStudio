import { describe, expect, test } from 'bun:test'
import {
  admitFoundationFactTerminal,
  claimFoundationFactTasks,
  createFoundationFactTaskCollection,
  type FoundationFactTaskCollection,
} from '../domain/foundation-fact-runtime'

const packet = (taskId: string, packetDigest: string, factKeyCount = 1) => ({
  taskId,
  kind: 'document-facts' as const,
  revision: 'rev-1',
  packetDigest,
  factKeyCount,
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
    expect(first.state.tasks[0]).toMatchObject({
      durationMs: 10,
      dispatch: { status: 'completed', terminalResult: terminal },
    })
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

  test('keeps aggregate usage and old phase age as telemetry only', () => {
    const seeded = createFoundationFactTaskCollection({
      revision: 'rev-1',
      phaseStartedAt: '2020-01-01T00:00:00.000Z',
      packets: Array.from({ length: 6 }, (_, index) => packet(`task-${index}`, `${index}`.repeat(64))),
    })
    const claimed = claimFoundationFactTasks({ ...seeded, aggregateUsage: { input_tokens: 200_000, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 200_000 } }, {
      dispatchIdFor: task => `dispatch:${task.taskId}`,
      now: '2026-08-25T00:00:00.000Z',
      modelReady: true,
    })
    expect(claimed.tasks.filter(task => task.status === 'running')).toHaveLength(4)
  })

  test('does not complete failed terminals and treats provider usage as telemetry', () => {
    const claimed = claimFoundationFactTasks(collection(), { dispatchIdFor: () => 'dispatch-a', now: '2026-08-24T00:00:01.000Z' })
    const base = { taskId: 'task-a', dispatchId: 'dispatch-a', revision: 'rev-1', packetDigest: 'a'.repeat(64), terminal: { workerType: 'foundation-fact-extractor' as const, status: 'failed' as const, runId: 'run-1', dispatchId: 'dispatch-a', revision: 'rev-1', taskId: 'task-a', packetDigest: 'a'.repeat(64), results: [] }, durationMs: 1, now: '2026-08-24T00:00:02.000Z' }
    const failed = admitFoundationFactTerminal(claimed, { ...base, usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 2 } })
    expect(failed.accepted).toBe(false)
    expect(failed.state.tasks[0]).toMatchObject({
      status: 'retryable',
      usage: { total_tokens: 2 },
      durationMs: 1,
      failureReason: 'foundation fact worker did not complete',
      dispatch: {
        status: 'failed',
        finishedAt: base.now,
        terminalResult: base.terminal,
      },
    })
    const highProviderUsage = admitFoundationFactTerminal(claimed, { ...base, terminal: { ...base.terminal, status: 'completed' }, usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 4_897, total_tokens: 4_898 } })
    expect(highProviderUsage.accepted).toBe(true)
    expect(highProviderUsage.state.tasks[0]?.status).toBe('completed')
    const detailed = admitFoundationFactTerminal(claimFoundationFactTasks(collection(), { dispatchIdFor: () => 'dispatch-a', now: '2026-08-24T00:00:01.000Z' }), { ...base, terminal: { ...base.terminal, status: 'completed', results: [{ key: 'game.title', status: 'present', value: 'x'.repeat(10_000) }] }, usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 2 } })
    expect(detailed.accepted).toBe(true)
    expect(detailed.state.tasks[0]?.status).toBe('completed')
    const oldPhase = admitFoundationFactTerminal({ ...claimed, phaseStartedAt: '2020-01-01T00:00:00.000Z', aggregateUsage: { input_tokens: 200_000, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 200_000 } }, { ...base, terminal: { ...base.terminal, status: 'completed' }, usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 2 }, now: '2026-08-25T00:06:00.000Z' })
    expect(oldPhase.state.tasks[0]?.status).toBe('completed')
  })

  test('admits a one-key multi-item typed evidence payload', () => {
    const claimed = claimFoundationFactTasks(createFoundationFactTaskCollection({
      revision: 'rev-1',
      phaseStartedAt: '2026-08-24T00:00:00.000Z',
      packets: [packet('task-a', 'a'.repeat(64), 1)],
    }), { dispatchIdFor: () => 'dispatch-a', now: '2026-08-24T00:00:01.000Z' })
    const terminal = {
      workerType: 'foundation-fact-extractor' as const,
      status: 'completed' as const,
      runId: 'run-1',
      dispatchId: 'dispatch-a',
      revision: 'rev-1',
      taskId: 'task-a',
      packetDigest: 'a'.repeat(64),
      results: [{
        key: 'art.style_constraints',
        status: 'present',
        value: Array.from({ length: 15 }, (_, index) => `constraint-${index}-${'x'.repeat(118)}`),
        evidence: { documentPath: 'docs/Art.md', sectionId: 'style', startLine: 1, endLine: 1, digest: 'a'.repeat(64) },
      }],
    }
    const admitted = admitFoundationFactTerminal(claimed, {
      taskId: 'task-a',
      dispatchId: 'dispatch-a',
      revision: 'rev-1',
      packetDigest: 'a'.repeat(64),
      terminal,
      usage: { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 2 },
      durationMs: 10,
      now: '2026-08-24T00:00:02.000Z',
    })
    expect(admitted.accepted).toBe(true)
    expect(admitted.state.tasks[0]?.status).toBe('completed')
  })

  test('zero-task collection is complete without creating a worker dispatch', () => {
    const state = createFoundationFactTaskCollection({ revision: 'rev-1', phaseStartedAt: '2026-08-24T00:00:00.000Z', packets: [] })
    expect(state.tasks).toEqual([])
    expect(state.status).toBe('facts_staged')
  })

  test('validates assigned fact cardinality without deriving an output budget from it', () => {
    expect(() => createFoundationFactTaskCollection({
      revision: 'rev-1',
      phaseStartedAt: '2026-08-24T00:00:00.000Z',
      packets: [packet('task-a', 'a'.repeat(64), 0)],
    })).toThrow(/positive integer/)
  })

  test('accepts more packets than the catalog owner-section count while preserving packet identity', () => {
    const packets = (count: number) => Array.from({ length: count }, (_, index) => packet(`task-${index}`, `${index.toString(16).padStart(2, '0')}`.repeat(32)))
    expect(createFoundationFactTaskCollection({ revision: 'rev-1', phaseStartedAt: '2026-08-24T00:00:00.000Z', packets: packets(20) }).tasks).toHaveLength(20)
    expect(() => createFoundationFactTaskCollection({ revision: 'rev-1', phaseStartedAt: '2026-08-24T00:00:00.000Z', packets: [packet('task-a', 'a'.repeat(64)), packet('task-b', 'a'.repeat(64))] })).toThrow(/packet digest.*unique/i)
    expect(() => createFoundationFactTaskCollection({ revision: 'rev-1', phaseStartedAt: '2026-08-24T00:00:00.000Z', packets: [packet('task-a', 'a'.repeat(64)), { ...packet('task-b', 'b'.repeat(64)), revision: 'other-revision' }] })).toThrow(/revision.*stale/i)
  })
})
