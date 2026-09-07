import { expect, test } from 'bun:test'
import { getLatestRuntimeUsage as reviewerOracle, type ReviewUsageEvent } from '../../../foundation-reviewer/private/native-usage'
import { captureRevisionUsageEvent, getLatestRevisionRuntimeUsage, type RevisionUsageEvent } from '../native-usage'

const result = (inputTokens: number, outputTokens: number): RevisionUsageEvent => ({
  type: 'result',
  usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: inputTokens + outputTokens },
})
const stream = (usage: Partial<RevisionUsageEvent['usage']>): RevisionUsageEvent => ({
  type: 'usage',
  usage: (() => {
    const prompt = usage.prompt_tokens ?? 0
    const completion = usage.completion_tokens ?? 0
    const cacheRead = usage.cache_read_tokens ?? 0
    const cacheCreation = usage.cache_creation_tokens ?? 0
    return { prompt_tokens: prompt, completion_tokens: completion, cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreation, total_tokens: prompt + completion + cacheRead + cacheCreation }
  })(),
})

test('partial streaming counters compose by maximum, not repeated summation', () => {
  const events = [stream({ prompt_tokens: 9, cache_read_tokens: 2 }), stream({ completion_tokens: 4 }), stream({ completion_tokens: 4 }), stream({ completion_tokens: 7 })]
  expect(getLatestRevisionRuntimeUsage(events)).toEqual({ prompt_tokens: 9, completion_tokens: 7, cache_read_tokens: 2, cache_creation_tokens: 0, total_tokens: 18 })
})

test('cumulative terminal replaces prior streaming and repeated terminal does not double-charge', () => {
  const events = [stream({ prompt_tokens: 9, completion_tokens: 7 }), result(9, 7), result(9, 7), result(13, 10)]
  expect(getLatestRevisionRuntimeUsage(events).total_tokens).toBe(23)
})

test('counter reset starts a new accounting epoch and keeps prior usage', () => {
  expect(getLatestRevisionRuntimeUsage([result(9, 7), result(13, 10), result(2, 1), result(5, 3)]).total_tokens).toBe(31)
})

test('in-flight stream after cumulative result is added exactly once', () => {
  expect(getLatestRevisionRuntimeUsage([result(9, 7), stream({ prompt_tokens: 3 }), stream({ completion_tokens: 2 }), stream({ completion_tokens: 2 })]).total_tokens).toBe(21)
})

test('capture keeps zero observations distinct from no usage and strips message content', () => {
  const zero = captureRevisionUsageEvent({
    type: 'stream_event',
    event: { type: 'message_delta', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, secret: 'discard' }, message: { content: 'do not retain' } },
    credentials: 'discard',
  })
  expect(zero).toEqual({ type: 'usage', usage: { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 } })
  expect(captureRevisionUsageEvent({ type: 'stream_event', event: { type: 'message_start' } })).toBeUndefined()
  expect(captureRevisionUsageEvent({ type: 'stream_event', event: { type: 'message_delta', usage: { total_tokens: 0 } } })).toBeUndefined()
})

test('capture aggregates model snapshots and accepts only finite non-negative counters', () => {
  const event = captureRevisionUsageEvent({
    type: 'result',
    modelUsage: {
      first: { inputTokens: 7, outputTokens: 3, cacheReadInputTokens: 2, cacheCreationInputTokens: 1, model: 'discard' },
      second: { inputTokens: -4, outputTokens: -2, cacheReadInputTokens: 2 },
    },
    result: 'markdown must not survive capture',
  })
  expect(event).toEqual({ type: 'result', usage: { prompt_tokens: 7, completion_tokens: 3, cache_read_tokens: 4, cache_creation_tokens: 1, total_tokens: 15 } })
  expect(captureRevisionUsageEvent({ type: 'result', modelUsage: { model: { inputTokens: 0, outputTokens: 0 } } })).toBeUndefined()
  expect(captureRevisionUsageEvent({ type: 'result', modelUsage: {}, usage: { input_tokens: 4, output_tokens: 2 } })).toEqual({
    type: 'usage', usage: { prompt_tokens: 4, completion_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 6 },
  })
  expect(captureRevisionUsageEvent({ type: 'result', modelUsage: { model: { inputTokens: 0, outputTokens: 0 } }, usage: { input_tokens: 4, output_tokens: 2 } })).toEqual({
    type: 'usage', usage: { prompt_tokens: 4, completion_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 6 },
  })
})

test('wire and model aliases match the Reviewer oracle on the original raw messages', () => {
  const messages: Record<string, unknown>[] = [
    { type: 'stream_event', event: { type: 'message_delta', usage: { prompt_tokens: 9, completion_tokens: 7, cache_read_tokens: 2, cache_creation_tokens: 1 } } },
    { type: 'result', modelUsage: { model: { input_tokens: 9, output_tokens: 7, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 } } },
    { type: 'result', modelUsage: { model: { inputTokens: 2, outputTokens: 1, cacheReadInputTokens: 1, cacheCreationInputTokens: 1 } } },
    { type: 'result', modelUsage: { model: { inputTokens: 5, outputTokens: 3, cacheReadInputTokens: 1, cacheCreationInputTokens: 0 } } },
    { type: 'stream_event', event: { type: 'message_delta', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 } } },
  ]
  for (let count = 1; count <= messages.length; count += 1) {
    const prefix = messages.slice(0, count)
    const captured = prefix.flatMap(message => {
      const event = captureRevisionUsageEvent(message)
      return event ? [event] : []
    })
    const oracleEvents: ReviewUsageEvent[] = prefix.map((message, index) => ({
      type: index === 0 || index === 4 ? 'usage' : 'result',
      payload: message,
    }))
    expect(getLatestRevisionRuntimeUsage(captured)).toEqual(reviewerOracle(oracleEvents))
  }
})

test('non-result modelUsage is ignored, negative fields zero safely, and overflow is rejected', () => {
  expect(captureRevisionUsageEvent({ type: 'assistant', modelUsage: { model: { inputTokens: 99 } }, usage: { input_tokens: 3, output_tokens: 2 } })).toEqual({
    type: 'usage', usage: { prompt_tokens: 3, completion_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 5 },
  })
  expect(captureRevisionUsageEvent({ type: 'stream_event', event: { usage: { input_tokens: -4, output_tokens: 6 } } })).toEqual({
    type: 'usage', usage: { prompt_tokens: 0, completion_tokens: 6, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 6 },
  })
  expect(captureRevisionUsageEvent({ type: 'result', modelUsage: { a: { inputTokens: Number.MAX_VALUE }, b: { inputTokens: Number.MAX_VALUE } } })).toBeUndefined()
  expect(captureRevisionUsageEvent({ type: 'result', modelUsage: { overflow: { inputTokens: Number.MAX_VALUE, outputTokens: Number.MAX_VALUE }, valid: { inputTokens: 1 } } })).toBeUndefined()
})

test('reducer validates exact captured events and rejects forged totals or epoch overflow', () => {
  expect(() => getLatestRevisionRuntimeUsage([{ type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 2 } }])).toThrow(/inconsistent/i)
  expect(() => getLatestRevisionRuntimeUsage([{ type: 'usage', usage: { prompt_tokens: -1, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 } }])).toThrow(/invalid counters/i)
  expect(() => getLatestRevisionRuntimeUsage([{ type: 'result', usage: { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 } }])).toThrow(/empty result/i)
  expect(() => getLatestRevisionRuntimeUsage([{ type: 'result', usage: { prompt_tokens: Number.MAX_VALUE, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: Number.MAX_VALUE } }, { type: 'result', usage: { prompt_tokens: 0, completion_tokens: Number.MAX_VALUE, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: Number.MAX_VALUE } }])).toThrow(/overflow/i)
})

test('unsafe or unrecognized messages cannot enter the persisted event shape', () => {
  let reads = 0
  expect(captureRevisionUsageEvent({ get type() { reads++; return 'result' } })).toBeUndefined()
  expect(reads).toBe(0)
  expect(captureRevisionUsageEvent({ type: 'stream_event', event: { type: 'message_delta', usage: { input_tokens: '7', output_tokens: null, unrelated: { secret: true } } } })).toBeUndefined()
  expect(captureRevisionUsageEvent(null)).toBeUndefined()
  expect(captureRevisionUsageEvent({ type: 'result', modelUsage: { model: { inputTokens: Number.POSITIVE_INFINITY } } })).toBeUndefined()
})
