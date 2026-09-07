import { expect, test } from 'bun:test'
import { getLatestRuntimeUsage, type ReviewUsageEvent } from '../native-usage'

const result = (inputTokens: number, outputTokens: number): ReviewUsageEvent => ({ type: 'result', payload: { modelUsage: { model: { inputTokens, outputTokens } } } })
const stream = (usage: Record<string, number>): ReviewUsageEvent => ({ type: 'usage', payload: { usage } })

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
