import { expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { startProviderBridge } from './bridge'

function capture() {
  const rows: Record<string, any>[] = []
  const spy = spyOn(console, 'info').mockImplementation((value: unknown) => {
    if (typeof value === 'string' && value.startsWith('[model-request] '))
      rows.push(JSON.parse(value.slice('[model-request] '.length)))
  })
  return { rows, restore: () => spy.mockRestore() }
}
function gate() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}
async function start(protocol: string, origin: string) {
  const prefix = protocol === 'anthropic-messages' ? 'ANTHROPIC' : protocol === 'gemini' ? 'GEMINI' : 'OPENAI'
  return startProviderBridge({ BEEGAME_MODEL_TYPE: prefix.toLowerCase(), BEEGAME_API_PROTOCOL: protocol,
    [prefix + '_BASE_URL']: origin, [prefix + '_API_KEY']: 'PRIVATE_CREDENTIAL', BEEGAME_MODEL: 'PRIVATE_MODEL' }, {
    sessionId: 'PRIVATE_SESSION', onUsage() {}, resolveOutboundTarget: async value => ({
      url: new URL(value), addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4),
    }),
  })
}
const input = JSON.stringify({ model: 'PRIVATE_MODEL', input: '中文 PRIVATE_PROMPT', stream: true })
function send(bridge: Awaited<ReturnType<typeof start>>, body = input, suffix = '') {
  return fetch(bridge.baseUrl + '/responses' + suffix, { method: 'POST',
    headers: { authorization: 'Bearer ' + bridge.apiKey }, body, signal: AbortSignal.timeout(4000) })
}
const completion: Record<string, unknown[]> = {
  responses: [{ type: 'response.completed', response: { id: 'PRIVATE_RESPONSE',
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } }],
  'chat-completions': [{ choices: [{ index: 0, delta: { content: 'PRIVATE_OUTPUT' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2 } }],
  'anthropic-messages': [
    { type: 'message_start', message: { id: 'PRIVATE_RESPONSE', usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ],
  gemini: [{ candidates: [{ content: { role: 'model', parts: [{ text: 'PRIVATE_OUTPUT' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } }],
}

test.each(Object.keys(completion))('%s timing separates upstream headers from EOF and measures actual UTF-8 dispatch', async protocol => {
  const log = capture(), bodyGate = gate()
  let requestBody = '', requests = 0
  const wire = completion[protocol]!.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('')
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname))
      return Response.json(protocol === 'gemini' ? { outputTokenLimit: 49157 }
        : protocol === 'anthropic-messages' ? { max_tokens: 49157 }
        : { data: [{ id: 'PRIVATE_MODEL', limit: { output: 49157 } }] })
    requests++
    requestBody = await request.text()
    await Bun.sleep(30)
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(new TextEncoder().encode(': PRIVATE_KEEPALIVE\n\n'))
      await bodyGate.wait
      controller.enqueue(new TextEncoder().encode(wire))
      controller.close()
    } }), { headers: { 'content-type': 'text/event-stream', 'x-private': 'PRIVATE_HEADER' } })
  } })
  const bridge = await start(protocol, upstream.url.origin)
  try {
    const response = await send(bridge)
    expect(log.rows.map(row => row.event)).toEqual(['received', 'upstream-started', 'upstream-headers'])
    const dispatched = log.rows[1]!, headers = log.rows[2]!
    expect(dispatched).toMatchObject({ sentMaxOutputTokens: 49157, outputBudgetSource: 'provider-model' })
    expect(dispatched.requestBytes).toBe(Buffer.byteLength(requestBody, 'utf8'))
    expect(dispatched.requestBytes).toBeGreaterThan(requestBody.length)
    expect(headers.upstreamHeadersMs - headers.upstreamStartMs).toBeGreaterThanOrEqual(25)
    expect(dispatched.upstreamStartMs).toBeGreaterThanOrEqual(dispatched.bodyParsedMs)
    expect(headers.httpStatus).toBe(200)
    bodyGate.release()
    const result = await response.text()
    expect(result).toContain('response.completed')
    if (protocol === 'responses') expect(result).toBe(': PRIVATE_KEEPALIVE\n\n' + wire)
    await bridge.close()
    expect(log.rows.map(row => row.event)).toEqual(['received', 'upstream-started', 'upstream-headers', 'finished'])
    expect(log.rows[3]).toMatchObject({ end: 'body-ended', aborted: false, requestBytes: dispatched.requestBytes })
    expect(log.rows[3]!.elapsedMs).toBeGreaterThanOrEqual(headers.upstreamHeadersMs)
    expect(new Set(log.rows.map(row => row.requestId)).size).toBe(1)
    expect(log.rows[0]!.sessionHash).toBe(createHash('sha256').update('PRIVATE_SESSION').digest('hex'))
    expect(Number.isNaN(Date.parse(log.rows[0]!.startedAt))).toBe(false)
    expect(JSON.stringify(log.rows)).not.toContain('PRIVATE')
    expect(JSON.stringify(log.rows)).not.toContain(upstream.url.origin)
    expect(requests).toBe(1)
  } finally { bodyGate.release(); await bridge.close(); upstream.stop(true); log.restore() }
}, 5000)

test('timing preserves missing phases on local/transport errors and records HTTP rejection without retries', async () => {
  const log = capture()
  let requests = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    requests++
    return new Response('PRIVATE_ERROR', { status: 429 })
  } })
  const bridge = await start('chat-completions', upstream.url.origin)
  try {
    for (const body of ['{PRIVATE_INPUT', JSON.stringify({ input: 'PRIVATE_INPUT', tools: [{ type: 'web_search' }] })]) {
      const response = await send(bridge, body)
      expect(response.status).toBe(400)
      await response.text()
      expect(log.rows.map(row => row.event)).toEqual(['received', 'finished'])
      expect(log.rows[1]).toMatchObject({ end: 'request-error', aborted: true })
      expect(log.rows[1]).not.toHaveProperty('upstreamStartMs')
      expect(log.rows[1]).not.toHaveProperty('requestBytes')
      expect(JSON.stringify(log.rows)).not.toContain('PRIVATE')
      log.rows.length = 0
    }
    expect(requests).toBe(0)
    const rejected = await send(bridge)
    expect(rejected.status).toBe(429)
    await rejected.text()
    expect(log.rows.map(row => row.event)).toEqual(['received', 'upstream-started', 'upstream-headers', 'finished'])
    expect(log.rows[3]).toMatchObject({ end: 'request-error', httpStatus: 429 })
    expect(requests).toBe(1)
    log.rows.length = 0
    upstream.stop(true)
    const disconnected = await send(bridge)
    expect(disconnected.status).toBe(502)
    await disconnected.text()
    expect(log.rows.map(row => row.event)).toEqual(['received', 'upstream-started', 'finished'])
    expect(log.rows[2]).not.toHaveProperty('upstreamHeadersMs')
    expect(log.rows[2]).not.toHaveProperty('httpStatus')
    expect(requests).toBe(1)
  } finally { await bridge.close(); upstream.stop(true); log.restore() }
}, 5000)

test.each(['chat-completions', 'responses'])('%s shutdown before headers closes one diagnostic record', async protocol => {
  const log = capture(), received = gate()
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    received.release()
    return new Promise<Response>(() => {})
  } })
  const bridge = await start(protocol, upstream.url.origin)
  try {
    const pending = send(bridge).catch(() => undefined)
    await received.wait
    await bridge.close()
    await pending
    expect(log.rows.map(row => row.event)).toEqual(['received', 'upstream-started', 'finished'])
    expect(log.rows[2]).toMatchObject({ aborted: true, end: 'request-error' })
    expect(log.rows[2]).not.toHaveProperty('upstreamHeadersMs')
  } finally { await bridge.close(); upstream.stop(true); log.restore() }
}, 5000)

test('Responses compact and bodyless replies keep transport semantics and operation identity', async () => {
  const log = capture()
  let path = '', calls = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 })
    path = new URL(request.url).pathname
    return ++calls === 1 ? Response.json({ output: 'PRIVATE_COMPACT' }) : new Response(null, { status: 204 })
  } })
  const bridge = await start('responses', upstream.url.origin)
  try {
    const compact = await send(bridge, JSON.stringify({ input: 'PRIVATE_INPUT' }), '/compact')
    expect(await compact.json()).toEqual({ output: 'PRIVATE_COMPACT' })
    expect(path).toBe('/responses/compact')
    expect(log.rows).toHaveLength(4)
    expect(log.rows.every(row => row.operation === 'compact')).toBe(true)
    log.rows.length = 0
    const local=await fetch(bridge.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+bridge.apiKey,
      'x-codex-turn-metadata':JSON.stringify({request_kind:'compaction'})},body:input})
    expect(local.status).toBe(200)
    expect(await local.text()).toContain('invalid_compaction_summary')
    expect(log.rows.at(-1)).toMatchObject({operation:'local-compaction',end:'body-ended'})
    log.rows.length=0
    const empty = await send(bridge)
    expect(empty.status).toBe(204)
    expect(await empty.text()).toBe('')
    await bridge.close()
    expect(log.rows).toHaveLength(4)
    expect(log.rows[3]).toMatchObject({ operation: 'responses', end: 'no-body', httpStatus: 204 })
    expect(JSON.stringify(log.rows)).not.toContain('PRIVATE')
  } finally { await bridge.close(); upstream.stop(true); log.restore() }
})
