import { expect, test } from 'bun:test'
import { startProviderBridge } from './bridge'
import { responseEvents, type ProviderUsage } from './response-stream'
import type { ProviderConfig } from './config'

const environment = { OPENAI_API_KEY: 'synthetic-provider-key', BEEGAME_API_PROTOCOL: 'responses',
  OPENAI_BASE_URL: 'https://unapproved.example.test/v1' }

test('Responses endpoints require runtime outbound approval before opening a bridge', async () => {
  let checked = 0
  await expect(startProviderBridge(environment, {
    onUsage() {}, resolveOutboundTarget: async () => { checked++; return null },
  })).rejects.toThrow('not permitted')
  expect(checked).toBe(1)
})

test('Responses pins DNS, preserves native search and compaction, and rejects redirects', async () => {
  const calls: Array<{ path: string; authorization: string | null; beta: string | null; body: any }> = []
  let redirected = 0, lookups = 0
  const receipts: ProviderUsage[] = []
  const trap = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { redirected++; return new Response('unexpected') } })
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any
    calls.push({ path: new URL(request.url).pathname, authorization: request.headers.get('authorization'),
      beta: request.headers.get('openai-beta'), body })
    if (body.redirect) return new Response(null, { status: 307, headers: { location: trap.url.toString() } })
    const content = 'data: {"type":"response.completed","response":{"usage":{"input_tokens":7,"output_tokens":2}}}\n\n'
    return new Response(body.compressed ? Bun.gzipSync(content) : content,
      { headers: { 'content-type': 'text/event-stream', ...(body.compressed ? { 'content-encoding': 'gzip' } : {}) } })
  } })
  const baseUrl = `http://synthetic-provider.invalid:${upstream.port}/custom/v1`
  const bridge = await startProviderBridge({ ...environment, OPENAI_BASE_URL: baseUrl }, {
    onUsage(usage) { receipts.push(usage) }, resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_hostname, _options, callback) => { lookups++; callback(null, '127.0.0.1', 4) } }),
  })
  const send = (body: unknown, suffix = '') => fetch(bridge.baseUrl + '/responses' + suffix, {
    method: 'POST', headers: { authorization: 'Bearer ' + bridge.apiKey, 'content-type': 'application/json',
      'openai-beta': 'synthetic-native-header' }, body: JSON.stringify(body),
  })
  try {
    expect(bridge.protocol).toBe('responses')
    const body = { input: 'Offline fixture', stream: true, tools: [{ type: 'web_search' }] }
    expect(await (await send(body)).text()).toContain('response.completed')
    expect(calls[0]).toEqual({ path: '/custom/v1/responses', authorization: 'Bearer synthetic-provider-key',
      beta: 'synthetic-native-header', body })
    expect(lookups).toBeGreaterThan(0)
    expect((await send({ input: [] }, '/compact')).status).toBe(200)
    expect(calls[1]?.path).toBe('/custom/v1/responses/compact')
    const compressed = await send({ compressed: true })
    expect(await compressed.text()).toContain('response.completed')
    expect(compressed.headers.has('content-encoding')).toBe(false)
    // Successful native Responses usage stays in native notifications.
    expect(receipts).toHaveLength(0)
    expect((await send({ redirect: true })).status).toBe(502)
    expect(redirected).toBe(0)
    expect(receipts).toEqual([{ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
      cache_creation_tokens: 0, total_tokens: 0, incomplete: true }])
  } finally { await bridge.close(); upstream.stop(true); trap.stop(true) }
})

const anthropic: ProviderConfig = { protocol: 'anthropic-messages', baseUrl: 'https://fixture.invalid',
  apiKey: 'synthetic', auth: 'bearer', model: 'fixture' }
const chunks = [
  { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial output' } },
]
function interruptedStream() {
  let position = 0
  return new Response(new ReadableStream({ pull(controller) {
    if (position < chunks.length)
      controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(chunks[position++]) + '\n\n'))
    else controller.error(Error('synthetic disconnect'))
  } }))
}

test('provider disconnect preserves acknowledged input tokens and marks the receipt incomplete', async () => {
  const receipts: ProviderUsage[] = [], output: any[] = []
  const run = async () => { for await (const event of responseEvents(anthropic, interruptedStream(), [], usage => receipts.push(usage))) output.push(event) }
  await expect(run()).rejects.toThrow('synthetic disconnect')
  expect(output.some(event => event.type === 'response.output_text.delta')).toBe(true)
  expect(receipts).toEqual([{ input_tokens: 100, output_tokens: 0, cache_read_tokens: 0,
    cache_creation_tokens: 0, total_tokens: 100, incomplete: true }])
})

test('consumer cancellation retains known usage once; cancellation before usage is explicitly unknown', async () => {
  for (const beforeUsage of [false, true]) {
    const receipts: ProviderUsage[] = []
    const events = responseEvents(anthropic, interruptedStream(), [], usage => receipts.push(usage))
    for await (const event of events) {
      if (beforeUsage || event.type === 'response.output_text.delta') break
    }
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.incomplete).toBe(true)
    expect(receipts[0]?.total_tokens).toBe(beforeUsage ? 0 : 100)
  }
})

test('complete provider usage is reported once without the incomplete marker', async () => {
  const receipts: ProviderUsage[] = []
  const stream = new Response([...chunks,
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ].map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join(''))
  for await (const _ of responseEvents(anthropic, stream, [], usage => receipts.push(usage))) {}
  expect(receipts).toEqual([{ input_tokens: 100, output_tokens: 8, cache_read_tokens: 0,
    cache_creation_tokens: 0, total_tokens: 108 }])
})
