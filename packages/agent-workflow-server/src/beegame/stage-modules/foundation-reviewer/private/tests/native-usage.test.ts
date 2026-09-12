import { expect, test } from 'bun:test'
import { getLatestRuntimeUsage, type ReviewUsageEvent } from '../native-usage'

const result = (inputTokens: number, outputTokens: number): ReviewUsageEvent => ({ type: 'result', payload: { modelUsage: { model: { inputTokens, outputTokens } } } })
const stream = (usage: Record<string, number>): ReviewUsageEvent => ({ type: 'usage', payload: { usage } })

test('per-message counters sum across turns and deduplicate replayed assistant snapshots', () => {
  const frame = (messageId: string, usage: Record<string, number>): ReviewUsageEvent => ({ ...stream(usage), messageId })
  const events = [frame('a', { input_tokens: 100, output_tokens: 1 }), frame('a', { output_tokens: 20 }),
    frame('a', { input_tokens: 100, output_tokens: 20 }), frame('b', { input_tokens: 150, output_tokens: 1 }),
    frame('b', { output_tokens: 30 }), frame('b', { input_tokens: 150, output_tokens: 30 })]
  expect(getLatestRuntimeUsage(events)).toMatchObject({ prompt_tokens: 250, completion_tokens: 50, total_tokens: 300 })
  expect(getLatestRuntimeUsage([...events, result(250, 50), result(250, 50)]).total_tokens).toBe(300)
  expect(getLatestRuntimeUsage([...events, result(250, 50), frame('c', { input_tokens: 5, output_tokens: 3 })]).total_tokens).toBe(308)
})

test('equal counters from different messages are not treated as replay', () => {
  expect(getLatestRuntimeUsage([{ ...stream({ input_tokens: 10, output_tokens: 5 }), messageId: 'a' },
    { ...stream({ input_tokens: 10, output_tokens: 5 }), messageId: 'b' }]).total_tokens).toBe(30)
})

test('partial streaming counters compose by maximum, not repeated summation', () => {
  const events = [stream({ input_tokens: 9, cache_read_input_tokens: 2 }), stream({ output_tokens: 4 }), stream({ output_tokens: 4 }), stream({ output_tokens: 7 })]
  expect(getLatestRuntimeUsage(events)).toEqual({ prompt_tokens: 9, completion_tokens: 7, cache_read_tokens: 2, cache_creation_tokens: 0, total_tokens: 18 })
})

test('cumulative terminal replaces prior streaming and repeated terminal does not double-charge', () => {
  const events = [stream({ input_tokens: 9, output_tokens: 7 }), result(9, 7), result(9, 7), result(13, 10)]
  expect(getLatestRuntimeUsage(events).total_tokens).toBe(23)
})

test('counter reset starts a new accounting epoch and keeps prior usage', () => {
  expect(getLatestRuntimeUsage([result(9, 7), result(13, 10), result(2, 1), result(5, 3)]).total_tokens).toBe(31)
})

test('in-flight stream after cumulative result is added exactly once', () => {
  expect(getLatestRuntimeUsage([result(9, 7), stream({ input_tokens: 3 }), stream({ output_tokens: 2 }), stream({ output_tokens: 2 })]).total_tokens).toBe(21)
})

test('invalid counters are normalized and cache tokens remain accounted', () => {
  const value = getLatestRuntimeUsage([{ type: 'result', payload: { modelUsage: { a: { inputTokens: '7', outputTokens: Infinity, cacheReadInputTokens: 2, cacheCreationInputTokens: 3 }, b: { inputTokens: 1, outputTokens: 2 } } } }])
  expect(value).toEqual({ prompt_tokens: 8, completion_tokens: 2, cache_read_tokens: 2, cache_creation_tokens: 3, total_tokens: 15 })
  expect(getLatestRuntimeUsage([]).total_tokens).toBe(0)
})
