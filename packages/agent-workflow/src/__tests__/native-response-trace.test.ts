import { expect, test } from 'bun:test'
import { createNativeResponseTraceLog, projectResponseMessage, createResponseRedactor } from '../native-response-trace'

test('response projection excludes prompts, hidden reasoning and signatures', () => {
  expect(projectResponseMessage({ type: 'user', message: { content: [{ type: 'text', text: 'PRIVATE_PROMPT' }] } })).toBeUndefined()
  expect(projectResponseMessage({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'PRIVATE_THINKING' } } }))
    .toEqual({ type: 'reasoning_activity', bytes: 16 })
  const projected = projectResponseMessage({ type: 'assistant', message: { id: 'm', content: [
    { type: 'thinking', thinking: 'PRIVATE_THINKING', signature: 'PRIVATE_SIGNATURE' },
    { type: 'text', text: 'Public answer' }, { type: 'tool_use', id: 'write', name: 'Write', input: { file_path: 'docs/ASSET_PLAN.md', content: '# Assets' } },
  ] } })
  expect(JSON.stringify(projected)).not.toContain('PRIVATE_')
  expect(projected?.message.content).toHaveLength(2)
})

test('interleaved parent/child responses preserve partial asset body and scoped usage on close', async () => {
  const events: any[] = [], usages: any[] = []
  const trace = createNativeResponseTraceLog(async (event, data) => { events.push({ event, data }) },
    { OPENAI_API_KEY: 'secret-token-123456' }, async usage => { usages.push(usage) })
  const send = (queryId: string, event: any) => trace.accept({ queryId, agentId: queryId, parentToolUseId: 'delegate-asset', kind: 'message',
    message: { type: 'stream_event', event } })
  for (const id of ['parent', 'asset']) {
    await send(id, { type: 'message_start', message: { id: id + '-m', usage: { input_tokens: 10 } } })
    await send(id, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'Write', id: 'write-' + id, input: {} } })
  }
  await send('asset', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":"docs/ASSET_PLAN.md","content":"# Asset Inventory' } })
  await trace.flush()
  expect(events.some(e => e.event === 'response.content_snapshot' && e.data.agentId === 'asset' && e.data.content.includes('# Asset Inventory'))).toBe(true)
  await send('asset', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '\\nkey: secret-token-' } })
  await trace.flush()
  expect(JSON.stringify(events)).not.toContain('secret-token-')
  await send('asset', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '123456\\napi_key' } })
  await trace.flush()
  await send('asset', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '=other-secret' } })
  await send('asset', { type: 'message_delta', usage: { output_tokens: 32 }, delta: { stop_reason: null } })
  await trace.close()
  const raw = JSON.stringify(events)
  expect(raw).not.toContain('secret-token-123456')
  expect(raw).not.toContain('other-secret')
  expect(events.some(e => e.event === 'response.content_snapshot' && e.data.interrupted && e.data.receivedBytes > 0)).toBe(true)
  expect(events.filter(e => e.event === 'response.query_end')).toHaveLength(2)
  expect(usages.at(-1).nativeTraceAgentId).toBe('asset')
  expect(usages.at(-1).event.usage.output_tokens).toBe(32)
})

test('credentials are removed from nested tool arguments and bearer headers', () => {
  const redact = createResponseRedactor({ ANTHROPIC_AUTH_TOKEN: 'full-known-token' })
  const result = JSON.stringify(redact({ input: { password: 'unknown-password', nested: { api_key: 'unknown-key' },
    command: 'curl -H "Authorization: Bearer full-known-token"', content: 'ordinary design text' } }))
  expect(result).not.toContain('unknown-password')
  expect(result).not.toContain('unknown-key')
  expect(result).not.toContain('full-known-token')
  expect(result).toContain('ordinary design text')
})
