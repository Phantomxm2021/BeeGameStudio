import { expect, test } from 'bun:test'
import { createNativeResponseTraceLog, projectResponseMessage, createResponseRedactor } from '../native-response-trace'

test('native task observation preserves progress without projecting private provider fields', () => {
  expect(projectResponseMessage({ type: 'system', subtype: 'task_progress', task_id: 'task-1', tool_use_id: 'agent-1',
    description: 'Read manifest', usage: { tool_uses: 45, total_tokens: 123, duration_ms: 60000, private: 'secret' },
    prompt: 'private', arbitrary: 'secret' })).toEqual({ type: 'system', subtype: 'task_progress',
      task_id: 'task-1', tool_use_id: 'agent-1', description: 'Read manifest',
      usage: { tool_uses: 45, total_tokens: 123, duration_ms: 60000 } })
})

test('response projection excludes prompts, hidden reasoning and signatures', () => {
  expect(projectResponseMessage({ type: 'user', message: { content: [{ type: 'text', text: 'PRIVATE_PROMPT' }] } })).toBeUndefined()
  expect(projectResponseMessage({ type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'thinking_delta', thinking: 'EXPLICIT_THINKING' } } }))
    .toEqual({ type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'thinking_delta', thinking: 'EXPLICIT_THINKING' } } })
  const projected = projectResponseMessage({ type: 'assistant', message: { id: 'm', content: [
    { type: 'thinking', thinking: 'PRIVATE_THINKING', signature: 'PRIVATE_SIGNATURE' },
    { type: 'text', text: 'Public answer' }, { type: 'tool_use', id: 'write', name: 'Write', input: { file_path: 'docs/ASSET_PLAN.md', content: '# Assets' } },
  ] } })
  expect(JSON.stringify(projected)).not.toContain('PRIVATE_')
  expect(projected?.message.content).toHaveLength(2)
})

test('thinking checkpoints retain message/block boundaries and source time across model loops', async () => {
  const events: any[] = []
  const trace = createNativeResponseTraceLog(async (event, data) => { events.push({ event, data }) }, {})
  const send = (event: any, occurredAt = '2026-09-20T00:00:00.000Z') => trace.accept({
    queryId: 'query', agentId: 'root', kind: 'message', occurredAt, message: { type: 'stream_event', event },
  })
  for (const id of ['message-1', 'message-2']) {
    await send({ type: 'message_start', message: { id } })
    await send({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } })
    await send({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: id } })
    await send({ type: 'content_block_stop', index: 0 }, '2026-09-20T00:00:02.130Z')
  }
  const snapshots = events.filter(e => e.event === 'response.content_snapshot')
  expect(snapshots.map(e => [e.data.messageId, e.data.index, e.data.content])).toEqual([
    ['message-1', 0, 'message-1'], ['message-2', 0, 'message-2'],
  ])
  expect(snapshots[0].data.startedAt).toBe('2026-09-20T00:00:00.000Z')
  expect(events.filter(e => e.event === 'response.content_end')[0].data.occurredAt).toBe('2026-09-20T00:00:02.130Z')
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

test('Chat checkpoints do not silently truncate an interrupted block at the old diagnostic cap', async () => {
  let snapshot = ''
  const trace = createNativeResponseTraceLog(async (event, data: any) => {
    if (event === 'response.content_snapshot') snapshot = data.content
  }, {})
  const send = (event: any) => trace.accept({ queryId: 'q', agentId: 'root', kind: 'message', message: { type: 'stream_event', event } })
  await send({ type: 'message_start', message: { id: 'm' } })
  await send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  const text = 'a'.repeat(8 * 1024 * 1024) + 'END_OF_VISIBLE_CONTENT'
  await send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  await trace.close()
  expect(snapshot.length).toBe(text.length)
  expect(snapshot.endsWith('END_OF_VISIBLE_CONTENT')).toBe(true)
})
