import { expect, test } from 'bun:test'
import { startProviderBridge } from './bridge'

test('bridge distinguishes local conversion rejection, upstream HTTP rejection and transport failure without retries', async () => {
  let requests = 0
  const receipts: unknown[] = []
  let partialStream = false
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    requests++
    if (partialStream) return new Response('data: ' + JSON.stringify({
      choices: [{ delta: { content: 'Synthetic partial response' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    return new Response('PRIVATE_PROVIDER_BODY', { status: 429 })
  } })
  const bridge = await startProviderBridge({ BEEGAME_MODEL_TYPE: 'openai', BEEGAME_API_PROTOCOL: 'chat-completions',
    OPENAI_API_KEY: 'synthetic-only', OPENAI_BASE_URL: upstream.url.toString().replace(/\/$/, ''), BEEGAME_MODEL: 'fixture' }, {
    onUsage(usage) { receipts.push(usage) }, resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })
  const send = (body: string) => fetch(bridge.baseUrl+'/responses', { method: 'POST',
    headers: { Authorization: 'Bearer '+bridge.apiKey }, body, signal: AbortSignal.timeout(3000) })
  try {
    // Both failures happen before any network request; neither is an upstream outage.
    for (const body of ['{PRIVATE_INPUT', JSON.stringify({ input: 'PRIVATE_INPUT', tools: [{ type: 'web_search' }] })]) {
      const response = await send(body), result = await response.json() as any
      expect(response.status).toBe(400)
      expect(result.error.type).toBe('invalid_request_error')
      expect(result.error.message).toBe('BGS could not parse or convert the model request for the selected provider protocol')
      expect(JSON.stringify(result)).not.toContain('PRIVATE_INPUT')
      expect(requests).toBe(0)
      expect(receipts).toEqual([])
    }
    const body = JSON.stringify({ input: 'Synthetic', stream: true, model: 'fixture' })
    const rejected = await send(body), result = await rejected.json() as any
    expect(rejected.status).toBe(429)
    expect(result.error.type).toBe('provider_error')
    expect(result.error.message).toContain('HTTP 429')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_BODY')
    expect(requests).toBe(1)
    expect(receipts).toEqual([{ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
      cache_creation_tokens: 0, total_tokens: 0, incomplete: true }])
    partialStream = true
    const partial = await send(JSON.stringify({ input: 'Synthetic', stream: false, model: 'fixture' }))
    expect(partial.status).toBe(502)
    expect(receipts).toHaveLength(2) // stream already reported; catch must not add a second receipt
    expect(receipts[1]).toMatchObject({ input_tokens: 10, output_tokens: 2, total_tokens: 12, incomplete: true })
    expect(requests).toBe(2)
    upstream.stop(true)
    const disconnected = await send(body), failure = await disconnected.json() as any
    expect(disconnected.status).toBe(502)
    expect(failure.error.type).toBe('provider_error')
    expect(failure.error.message).toContain('provider transport failed')
    expect(requests).toBe(2)
    expect(receipts).toHaveLength(3)
  } finally { await bridge.close(); upstream.stop(true) }
}, 10000)

test.each(['chat-completions', 'responses'])('%s cancellation before headers records unknown usage once and drains', async protocol => {
  const receipts: unknown[] = []
  let started!: () => void
  const received = new Promise<void>(resolve => { started = resolve })
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    started()
    return new Promise<Response>(() => {})
  } })
  const bridge = await startProviderBridge({ BEEGAME_MODEL_TYPE: 'openai', BEEGAME_API_PROTOCOL: protocol,
    OPENAI_API_KEY: 'synthetic-only', OPENAI_BASE_URL: upstream.url.toString().replace(/\/$/, ''), BEEGAME_MODEL: 'fixture' }, {
    onUsage(usage) { receipts.push(usage) }, resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })
  try {
    const pending = fetch(bridge.baseUrl+'/responses', { method: 'POST',
      headers: { Authorization: 'Bearer '+bridge.apiKey }, body: JSON.stringify({ input: 'Offline fixture', stream: true }),
      signal: AbortSignal.timeout(3000) }).catch(() => undefined)
    await received
    await bridge.close()
    await pending
    expect(receipts).toEqual([{ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
      cache_creation_tokens: 0, total_tokens: 0, incomplete: true }])
  } finally { await bridge.close(); upstream.stop(true) }
}, 5000)

test('local catalog shares bridge capability and lifecycle without upstream requests or usage', async () => {
  let upstreamRequests=0
  const usage:unknown[]=[]
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){upstreamRequests++;return new Response('Unexpected',{status:500})}})
  const modelCatalog=JSON.stringify({models:[{slug:'fixture',context_window:272000}]})
  const bridge=await startProviderBridge({BEEGAME_API_PROTOCOL:'responses',OPENAI_BASE_URL:upstream.url.origin,
    OPENAI_API_KEY:'upstream-secret',BEEGAME_MODEL:'fixture'}, {modelCatalog,onUsage:value=>{usage.push(value)},
    resolveOutboundTarget:async value=>({url:new URL(value),addresses:['127.0.0.1'],lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)})})
  try {
    expect(new URL(bridge.modelCatalogUrl!).origin).toBe(new URL(bridge.baseUrl).origin)
    const authorization='Bearer '+bridge.apiKey
    const response=await fetch(bridge.modelCatalogUrl!,{headers:{authorization}})
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(modelCatalog)
    const rejectedRequests: RequestInit[] = [{}, {headers:{authorization:'Bearer upstream-secret'}},
      {headers:{authorization,origin:'http://example.invalid'}}, {method:'POST',headers:{authorization}}]
    for (const init of rejectedRequests)
      expect((await fetch(bridge.modelCatalogUrl!,init)).status).toBe(404)
    expect(upstreamRequests).toBe(0)
    expect(usage).toEqual([])
    await bridge.close()
    await expect(fetch(bridge.modelCatalogUrl!,{headers:{authorization},signal:AbortSignal.timeout(1000)})).rejects.toThrow()
  } finally {await bridge.close();upstream.stop(true)}
})

test('Responses receipt observation preserves raw bytes and distinguishes terminal usage from text or malformed data', async () => {
  const usage = { input_tokens: 10, output_tokens: 2, total_tokens: 12 }
  const complete = { type: 'response.completed', response: { id: 'synthetic', usage } }
  for (const [event, unknown] of [
    [complete, false],
    [{ type: 'response.incomplete', response: { id: 'synthetic', usage, incomplete_details: { reason: 'max_output_tokens' } } }, false],
    [{ type: 'response.output_text.delta', delta: '你好 ' + JSON.stringify(complete) }, true],
    [{ ...complete, response: { id: 'synthetic' } }, true],
    [{ ...complete, response: { id: 'synthetic', usage: { ...usage, input_tokens: '10' } } }, true],
    [{ ...complete, response: { id: 'synthetic', usage: { ...usage, input_tokens_details: { cached_tokens: 9, cache_write_tokens: 2 } } } }, true],
    [{ type: 'response.failed', response: { id: 'synthetic', usage } }, true],
    [{ type: 'response.incomplete', response: { id: 'synthetic', usage, incomplete_details: { reason: 'content_filter' } } }, true],
    [null, true],
    ['invalid-json', true],
  ] as const) {
    const body = ': keepalive\r\nevent: response\r\ndata: ' +
      (typeof event === 'string' ? '{invalid-json' : JSON.stringify(event)) + '\r\n\r\n'
    const bytes = new TextEncoder().encode(body), receipts: unknown[] = []
    const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
      let position = 0
      return new Response(new ReadableStream<Uint8Array>({ async pull(controller) {
        if (position === bytes.length) { controller.close(); return }
        controller.enqueue(bytes.slice(position, ++position))
        await Bun.sleep(1)
      } }), { headers: { 'content-type': 'text/event-stream' } })
    } })
    const bridge = await startProviderBridge({ BEEGAME_API_PROTOCOL: 'responses',
      OPENAI_BASE_URL: upstream.url.origin, OPENAI_API_KEY: 'synthetic-only', BEEGAME_MODEL: 'fixture' }, {
      onUsage: value => { receipts.push(value) }, resolveOutboundTarget: async value => ({
        url: new URL(value), addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4),
      }),
    })
    try {
      const response = await fetch(bridge.baseUrl + '/responses', { method: 'POST',
        headers: { authorization: 'Bearer ' + bridge.apiKey }, body: JSON.stringify({ input: 'Synthetic', stream: true }) })
      expect(await response.text()).toBe(body)
      await bridge.close()
      expect(receipts).toEqual(unknown ? [{ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
        cache_creation_tokens: 0, total_tokens: 0, incomplete: true }] : [])
    } finally { await bridge.close(); upstream.stop(true) }
  }
}, 10000)
