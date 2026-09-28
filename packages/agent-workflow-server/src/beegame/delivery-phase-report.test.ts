import { expect, test } from 'bun:test'
import { summarizeDeliveryEvents } from './delivery-phase-report'

const at = (second: number) => new Date(1_700_000_000_000 + second * 1000).toISOString()
const event = (second: number, type: string, payload: Record<string, unknown> = {}, turnId?: string) =>
  ({ createdAt: at(second), type, payload, ...(turnId ? { turnId } : {}) })
const usage = (inputTokens: number, outputTokens: number, cacheReadInputTokens = 0) => ({
  modelUsage: { model: { inputTokens, outputTokens, cacheReadInputTokens,
    cacheCreationInputTokens: 0, costUSD: inputTokens / 1000 } },
})

test('attributes completed turns and cumulative model deltas to the phase at turn start', () => {
  const report = summarizeDeliveryEvents([
    event(0, 'system.status', { subtype: 'delivery_phase', phase: 'author' }),
    event(1, 'turn.started', {}, 'turn-1'),
    event(4, 'tool.started', {}, 'turn-1'),
    event(6, 'result', usage(100, 40, 200), 'turn-1'),
    event(7, 'result', usage(120, 50, 250), 'turn-1'),
    event(8, 'turn.completed', {}, 'turn-1'),
    event(10, 'system.status', { subtype: 'delivery_phase', phase: 'review' }),
    event(11, 'turn.started', {}, 'turn-2'),
    event(12, 'tool.started', {}, 'turn-2'),
    event(13, 'tool.failed', { toolName: 'Bash' }, 'turn-2'),
    event(14, 'result', usage(180, 75, 330), 'turn-2'),
    event(15, 'turn.completed', {}, 'turn-2'),
    event(16, 'system.status', { subtype: 'delivery_phase', phase: 'resources' }),
  ])
  expect(report.phases.map(phase => phase.phase)).toEqual(['author', 'review', 'resources'])
  expect(report.phases[0]).toMatchObject({
    wallMs: 10_000, activeTurnMs: 7_000, completedTurns: 1, toolStarts: 1,
    usage: { inputTokens: 120, cacheReadInputTokens: 250, outputTokens: 50 },
  })
  expect(report.phases[1]).toMatchObject({
    wallMs: 6_000, activeTurnMs: 4_000, completedTurns: 1,
    toolStarts: 1, toolFailures: 1,
    toolFailuresByName: { Bash: 1 },
    usage: { inputTokens: 60, cacheReadInputTokens: 80, outputTokens: 25 },
  })
  expect(report.phases[2]?.completedTurns).toBe(0)
})

test('counter reset starts a new usage epoch and stopped work ends active time', () => {
  const report = summarizeDeliveryEvents([
    event(0, 'system.status', { subtype: 'delivery_phase', phase: 'author' }),
    event(1, 'turn.started', {}, 'turn-1'),
    event(2, 'result', usage(100, 20), 'turn-1'),
    event(3, 'turn.completed', {}, 'turn-1'),
    event(4, 'turn.started', {}, 'turn-2'),
    event(5, 'result', usage(30, 5), 'turn-2'),
    event(6, 'session.stopped'),
  ])
  expect(report.phases[0]).toMatchObject({
    completedTurns: 1, stoppedTurns: 1, incompleteTurns: 0, activeTurnMs: 4_000,
    usage: { inputTokens: 130, outputTokens: 25 },
  })
})

test('unknown usage remains explicitly unaccounted rather than estimated from streaming frames', () => {
  const report = summarizeDeliveryEvents([
    event(0, 'system.status', { subtype: 'delivery_phase', phase: 'author' }),
    event(1, 'turn.started', {}, 'turn-1'),
    event(2, 'usage', { event: { type: 'message_delta', usage: { input_tokens: 900 } } }, 'turn-1'),
    event(3, 'turn.completed', {}, 'turn-1'),
  ])
  expect(report.phases[0]?.turnsWithoutModelUsage).toBe(1)
  expect(report.phases[0]?.usage.inputTokens).toBe(0)
  expect(report.limits.some(limit => limit.includes('totals are incomplete'))).toBe(true)
})

test('a stopped turn without result uses the latest streamed usage per model message once', () => {
  const report = summarizeDeliveryEvents([
    event(0, 'system.status', { subtype: 'delivery_phase', phase: 'implementation' }),
    event(1, 'turn.started', {}, 'turn-1'),
    event(2, 'usage', { type: 'stream_event', event: {
      type: 'message_start', message: { id: 'message-1', usage: {
        input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 300,
      } },
    } }, 'turn-1'),
    event(3, 'usage', { type: 'stream_event', event: {
      type: 'message_delta', usage: {
        input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 300,
      },
    } }, 'turn-1'),
    event(4, 'usage', { type: 'stream_event', event: {
      type: 'message_start', message: { id: 'message-2', usage: {
        input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 400,
      } },
    } }, 'turn-1'),
    event(5, 'session.stopped'),
  ])
  expect(report.phases[0]).toMatchObject({
    stoppedTurns: 1, incompleteTurns: 0, turnsUsingStreamFallback: 1, turnsWithoutModelUsage: 0,
    upstreamCostUsdIsComplete: false,
    usage: { inputTokens: 220, outputTokens: 41, cacheReadInputTokens: 700 },
  })
})

test('a later cumulative result does not charge a stopped turn twice', () => {
  const report = summarizeDeliveryEvents([
    event(0, 'system.status', { subtype: 'delivery_phase', phase: 'author' }),
    event(1, 'turn.started', {}, 'turn-1'),
    event(2, 'result', usage(100, 20), 'turn-1'),
    event(3, 'turn.completed', {}, 'turn-1'),
    event(4, 'turn.started', {}, 'turn-2'),
    event(5, 'usage', { type: 'stream_event', event: {
      type: 'message_start', message: { id: 'stopped-message', usage: {
        input_tokens: 20, output_tokens: 5,
      } },
    } }, 'turn-2'),
    event(6, 'session.stopped', {}, 'turn-2'),
    event(7, 'system.status', { subtype: 'delivery_phase', phase: 'review' }),
    event(8, 'turn.started', {}, 'turn-3'),
    event(9, 'result', usage(150, 35), 'turn-3'),
    event(10, 'turn.completed', {}, 'turn-3'),
  ])
  expect(report.phases[0]?.usage).toMatchObject({ inputTokens: 120, outputTokens: 25 })
  expect(report.phases[1]?.usage).toMatchObject({ inputTokens: 30, outputTokens: 10 })
  expect(report.phases[1]?.upstreamCostUsdIsComplete).toBe(false)
})

test('a restarted counter does not subtract a previous stopped turn from a new epoch', () => {
  const report = summarizeDeliveryEvents([
    event(0, 'system.status', { subtype: 'delivery_phase', phase: 'author' }),
    event(1, 'turn.started', {}, 'turn-1'),
    event(2, 'result', usage(100, 20), 'turn-1'),
    event(3, 'turn.completed', {}, 'turn-1'),
    event(4, 'turn.started', {}, 'turn-2'),
    event(5, 'usage', { type: 'stream_event', event: {
      type: 'message_start', message: { id: 'stopped-message', usage: {
        input_tokens: 20, output_tokens: 5,
      } },
    } }, 'turn-2'),
    event(6, 'session.stopped', {}, 'turn-2'),
    event(7, 'system.status', { subtype: 'delivery_phase', phase: 'review' }),
    event(8, 'turn.started', {}, 'turn-3'),
    event(9, 'result', usage(30, 10), 'turn-3'),
    event(10, 'turn.completed', {}, 'turn-3'),
  ])
  expect(report.phases[0]?.usage).toMatchObject({ inputTokens: 120, outputTokens: 25 })
  expect(report.phases[1]?.usage).toMatchObject({ inputTokens: 30, outputTokens: 10 })
})

test('project-filtered billing events attribute model credits by turn without double counting', () => {
  const events = [
    event(0, 'system.status', { subtype: 'delivery_phase', phase: 'author' }),
    event(1, 'turn.started', {}, 'turn-1'),
    event(2, 'turn.completed', {}, 'turn-1'),
    event(3, 'system.status', { subtype: 'delivery_phase', phase: 'review' }),
    event(4, 'turn.started', {}, 'turn-2'),
    event(5, 'turn.completed', {}, 'turn-2'),
  ]
  const report = summarizeDeliveryEvents(events, [
    { id: 'bill-1', projectId: 'project', turnId: 'turn-1', creditsMicro: 100,
      metadata: { deliveryPhase: 'author' } },
    { id: 'bill-1', projectId: 'project', turnId: 'turn-1', creditsMicro: 100 },
    { id: 'bill-2', projectId: 'project', turnId: 'turn-2', creditsMicro: 50,
      metadata: { deliveryPhase: 'implementation' } },
    { id: 'bill-3', projectId: 'project', creditsMicro: 7 },
  ])
  expect(report.phases.map(phase => phase.modelCreditsMicro)).toEqual([100, 50])
  expect(report.billing).toEqual({
    eventCount: 3, totalModelCreditsMicro: 157,
    unattributedModelCreditsMicro: 7, duplicateEventsSkipped: 1, phaseMismatchCount: 1,
  })
  expect(() => summarizeDeliveryEvents(events, [
    { id: 'a', projectId: 'one', creditsMicro: 1 },
    { id: 'b', projectId: 'two', creditsMicro: 1 },
  ])).toThrow('multiple projects')
})
