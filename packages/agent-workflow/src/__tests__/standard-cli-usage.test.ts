import { expect, test } from 'bun:test'
import { StandardCliUsage } from '../standard-cli-usage'
test('public SDK deltas and final block snapshots are deduplicated, including concurrent child lanes', () => {
  const usage = new StandardCliUsage()
  expect(usage.observe({ type: 'stream_event', event: { type: 'message_start', message: { id: 'one', usage: { input_tokens: 10, output_tokens: 1 } } } })?.total_tokens).toBe(11)
  expect(usage.observe({ type: 'stream_event', parent_tool_use_id: 'child', event: { type: 'message_start', message: { id: 'two', usage: { input_tokens: 20 } } } })?.total_tokens).toBe(31)
  expect(usage.observe({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 4 } } })?.total_tokens).toBe(34)
  expect(usage.observe({ type: 'assistant', message: { id: 'one', usage: { input_tokens: 10, output_tokens: 4 } } })).toBeUndefined()
  expect(usage.observe({ type: 'stream_event', parent_tool_use_id: 'child', event: { type: 'message_delta', usage: { output_tokens: 3 } } })?.total_tokens).toBe(37)
  expect(usage.observe({ type: 'result', modelUsage: { model: { inputTokens: 35, outputTokens: 10 } } })?.total_tokens).toBe(45)
  expect(usage.observe({ type: 'assistant', isReplay: true, message: { id: 'old', usage: { input_tokens: 999 } } })).toBeUndefined()
})
test('interrupted completed work stays observed without fabricating missing provider usage or another request', () => {
  const usage = new StandardCliUsage()
  expect(usage.observe({ type: 'assistant', message: { id: 'child-complete', usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 80 } } })?.total_tokens).toBe(96)
  expect(usage.observe({ type: 'result', subtype: 'error', is_error: true })).toBeUndefined()
  expect(usage.observe({ type: 'assistant', message: { id: 'invalid', usage: { input_tokens: -1, output_tokens: NaN } } })).toBeUndefined()
})
