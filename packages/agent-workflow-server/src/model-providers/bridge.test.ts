import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { startProviderBridge } from './bridge'
import { parseSse } from './response-stream'

test('only marked local compaction rejects raw tool text before history replacement and preserves usage', async () => {
  let calls = 0
  const receipts: unknown[] = [], metadata = JSON.stringify({ request_kind: 'compaction', compaction: { implementation: 'local' } })
  const text = '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="exec_command">discarded command'
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    calls++
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: {
      id: 'bad-summary', status: 'completed', output: [{ type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text }] }], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } })
  } })
  const bridge = await startProviderBridge({ OPENAI_API_KEY: 'fixture', OPENAI_BASE_URL: upstream.url.origin,
    BEEGAME_MODEL: 'fixture' }, { onUsage(value) { receipts.push(value) }, resolveOutboundTarget: async value => ({
      url: new URL(value), addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4),
    }) })
  try {
    for (const location of ['header', 'body', 'ordinary']) {
      const response = await fetch(bridge.baseUrl + '/responses', { method: 'POST', headers: {
        authorization: 'Bearer ' + bridge.apiKey, ...(location === 'header' ? { 'x-codex-turn-metadata': metadata } : {}),
      }, body: JSON.stringify({ stream: true, max_output_tokens: 100, input: 'Synthetic',
        ...(location === 'body' ? { client_metadata: { 'x-codex-turn-metadata': metadata } } : {}) }) })
      const events = await Array.fromAsync(parseSse(response))
      if (location === 'ordinary') expect(events[0]!.response.output[0].content[0].text).toBe(text)
      else expect(events).toMatchObject([{ type: 'response.incomplete', response: {
        output: [], incomplete_details: { reason: 'invalid_compaction_summary' },
      } }])
    }
    expect(calls).toBe(3)
    expect(receipts).toEqual(Array(3).fill({ input_tokens: 10, output_tokens: 2,
      cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 12 }))
  } finally { await bridge.close(); upstream.stop(true) }
})

test('bridge distinguishes local conversion rejection, upstream HTTP rejection and transport failure without retries', async () => {
  let requests = 0
  const receipts: unknown[] = []
  let partialStream = false
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 });
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
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 });
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
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 });upstreamRequests++;return new Response('Unexpected',{status:500})}})
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
    const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET' && /\/models(?:\/|$)/.test(new URL(request.url).pathname)) return new Response(null, { status: 404 });
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
        cache_creation_tokens: 0, total_tokens: 0, incomplete: true }]
        : [{ input_tokens: 10, output_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 12 }])
    } finally { await bridge.close(); upstream.stop(true) }
  }
}, 10000)

const budgetCompletions: Record<string, unknown[]> = {
  responses: [{ type: 'response.completed', response: { id: 'budget-fixture', usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } } }],
  'chat-completions': [{ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }],
  'anthropic-messages': [
    { type: 'message_start', message: { id: 'budget-fixture', usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }, { type: 'message_stop' },
  ],
  gemini: [{ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 } }],
}

test.each(Object.keys(budgetCompletions))('%s fills model-advertised budgets, preserves explicit values and isolates changed models', async protocol => {
  const bodies: any[] = [], reads: string[] = [], limits = { first: 12345, second: 34567 }
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') {
      const path = new URL(request.url).pathname
      reads.push(path)
      if (protocol === 'gemini') {
        expect(request.headers.get('x-goog-api-key')).toBe('synthetic-only')
        const name = path.endsWith('/second') ? 'second' : 'first'
        return Response.json({ name: 'models/' + name, outputTokenLimit: limits[name] })
      }
      if (protocol === 'anthropic-messages') {
        expect(request.headers.get('x-api-key')).toBe('synthetic-only')
        expect(request.headers.get('anthropic-version')).toBe('2023-06-01')
        const id = path.endsWith('/second') ? 'second' : 'first'
        return Response.json({ id, max_tokens: limits[id] })
      }
      expect(request.headers.get('authorization')).toBe('Bearer synthetic-only')
      return Response.json({ data: Object.entries(limits).map(([id, output]) => ({ id, limit: { output } })) })
    }
    bodies.push(await request.json())
    return new Response(budgetCompletions[protocol]!.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
      { headers: { 'content-type': 'text/event-stream' } })
  } })
  const prefix = protocol === 'anthropic-messages' ? 'ANTHROPIC' : protocol === 'gemini' ? 'GEMINI' : 'OPENAI'
  const bridge = await startProviderBridge({ BEEGAME_MODEL_TYPE: prefix.toLowerCase(), BEEGAME_API_PROTOCOL: protocol,
    [prefix + '_BASE_URL']: upstream.url.origin + '/v1', [prefix + '_API_KEY']: 'synthetic-only', BEEGAME_MODEL: 'first' }, {
    onUsage() {}, resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })
  const send = async (body: object) => {
    const response = await fetch(bridge.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + bridge.apiKey },
      body: JSON.stringify({ input: 'Synthetic', stream: true, ...body }) })
    expect(await response.text()).toContain('response.completed')
  }
  try {
    // A caller budget needs no discovery, even when it differs from registry metadata.
    await send({ model: 'first', max_output_tokens: 17 })
    expect(reads).toEqual([])
    await send({ model: 'first' })
    await send({ model: 'first', max_output_tokens: null })
    await send({ model: 'second' })
    await send({ model: 'first', max_output_tokens: 0 })
    const sent = (body: any) => protocol === 'responses' ? body.max_output_tokens
      : protocol === 'gemini' ? body.generationConfig.maxOutputTokens : body.max_tokens
    expect(bodies.map(sent)).toEqual([17, 12345, 12345, 34567, 0])
    expect(reads).toEqual(protocol === 'gemini' || protocol === 'anthropic-messages'
      ? ['/v1/models/first', '/v1/models/second'] : ['/v1/models'])
    expect(JSON.stringify(bodies)).not.toContain('synthetic-only')
  } finally { await bridge.close(); upstream.stop(true) }
})

test.each(['missing', 'wrong-model', 'context-only', 'invalid-limit', 'bad-json', 'http-error'])('unavailable budget %s preserves provider semantics without retry or borrowing limits', async scenario => {
  let reads = 0
  const bodies: any[] = []
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') {
      reads++
      if (scenario === 'http-error') return new Response('PRIVATE_CATALOG', { status: 404 })
      if (scenario === 'bad-json') return new Response('{PRIVATE_CATALOG')
      return Response.json({ data: scenario === 'missing' ? [] : [{ id: scenario === 'wrong-model' ? 'other' : 'selected',
        ...(scenario === 'context-only' ? { context_window: 999999 } : { limit: { output: scenario === 'invalid-limit' ? -1 : 22222 } }) }] })
    }
    bodies.push(await request.json())
    return new Response('data: ' + JSON.stringify(budgetCompletions.responses![0]) + '\n\n')
  } })
  const bridge = await startProviderBridge({ OPENAI_API_KEY: 'synthetic-only', OPENAI_BASE_URL: upstream.url.origin, BEEGAME_MODEL: 'selected' }, {
    onUsage() {}, resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })
  try {
    for (let i = 0; i < 2; i++) {
      const response = await fetch(bridge.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + bridge.apiKey },
        body: JSON.stringify({ model: 'selected', input: 'Synthetic', stream: true }) })
      expect(await response.text()).toContain('response.completed')
    }
    expect(reads).toBe(1)
    expect(bodies).toHaveLength(2)
    expect(bodies.every(body => !Object.hasOwn(body, 'max_output_tokens'))).toBe(true)
  } finally { await bridge.close(); upstream.stop(true) }
})

test('compaction stays unchanged and output metadata cannot leak between connections', async () => {
  const bodies: Array<{ path: string; body: any }> = [], reads: string[] = []
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (request.method === 'GET') {
      reads.push(path)
      return Response.json({ data: [{ id: 'same-model', max_output_tokens: path.startsWith('/first/') ? 11111 : 33333 }] })
    }
    bodies.push({ path, body: await request.json() })
    return Response.json({ output: [] })
  } })
  const bridges = await Promise.all(['first', 'second'].map(name => startProviderBridge({ OPENAI_API_KEY: 'synthetic-' + name,
    OPENAI_BASE_URL: upstream.url.origin + '/' + name, BEEGAME_MODEL: 'same-model' }, {
    onUsage() {}, resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })))
  const compact = { model: 'same-model', input: 'Synthetic', max_output_tokens: null }
  try {
    for (const bridge of bridges) {
      const response = await fetch(bridge.baseUrl + '/responses/compact', { method: 'POST',
        headers: { authorization: 'Bearer ' + bridge.apiKey }, body: JSON.stringify(compact) })
      await response.text()
    }
    const metadata=JSON.stringify({request_kind:'compaction',compaction:{implementation:'local'}})
    for(const bridge of bridges) for(const location of ['header','body']) {
      const local={model:'same-model',input:'Synthetic',...(location==='body'?{client_metadata:{'x-codex-turn-metadata':metadata}}:{})}
      const response=await fetch(bridge.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+bridge.apiKey,
        ...(location==='header'?{'x-codex-turn-metadata':metadata}:{})},body:JSON.stringify(local)})
      await response.text()
    }
    expect(reads).toEqual([])
    expect(bodies.slice(2,6).every(row=>row.body.max_output_tokens===undefined)).toBe(true)
    for (const bridge of bridges) {
      const response = await fetch(bridge.baseUrl + '/responses', { method: 'POST',
        headers: { authorization: 'Bearer ' + bridge.apiKey }, body: JSON.stringify({ model: 'same-model', input: 'Synthetic' }) })
      await response.text()
    }
    expect(bodies.slice(0, 2).map(value => value.body)).toEqual([compact, compact])
    expect(bodies.slice(6).map(value => value.body.max_output_tokens)).toEqual([11111, 33333])
    expect(reads).toEqual(['/first/models', '/second/models'])
  } finally { await Promise.all(bridges.map(bridge => bridge.close())); upstream.stop(true) }
})

test('shutdown cancels a pending metadata lookup without generation or usage', async () => {
  let received!: () => void, generations = 0
  const pendingMetadata = new Promise<void>(resolve => { received = resolve })
  const receipts: unknown[] = []
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (request.method === 'GET') { received(); return new Promise<Response>(() => {}) }
    generations++
    return new Response('Unexpected')
  } })
  const bridge = await startProviderBridge({ OPENAI_API_KEY: 'synthetic-only', OPENAI_BASE_URL: upstream.url.origin, BEEGAME_MODEL: 'fixture' }, {
    onUsage(value) { receipts.push(value) }, resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })
  try {
    const response = fetch(bridge.baseUrl + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + bridge.apiKey },
      body: JSON.stringify({ input: 'Synthetic' }) }).catch(() => undefined)
    await pendingMetadata
    await bridge.close()
    await response
    expect(generations).toBe(0)
    expect(receipts).toEqual([])
  } finally { await bridge.close(); upstream.stop(true) }
}, 3000)

for (const stream of [false, true]) test('Responses normalizes only empty native exec explanations before validation: ' + stream, async () => {
  for (const args of [
    { cmd: 'fixture', justification: '' },
    { cmd: 'fixture', justification: 'Actual explanation' },
    { cmd: 'fixture', justification: '', sandbox_permissions: 'require_escalated' },
  ]) {
    let requests = 0
    const usage: unknown[] = []
    const item = { type: 'function_call', id: 'item', call_id: 'call', name: 'exec_command', arguments: JSON.stringify(args) }
    const receipt = { id: 'receipt', status: 'completed', output: [item, { type: 'reasoning', encrypted_content: 'OPAQUE_UNCHANGED' }],
      usage: { input_tokens: 1000, output_tokens: 2, total_tokens: 1002,
        input_tokens_details: { cached_tokens: 900, cache_write_tokens: 20 } } }
    const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      if (request.method === 'GET') return new Response(null, { status: 404 })
      requests++
      const requestBody = await request.json() as any
      expect(requestBody.tools[0].name).toBe('exec_command')
      if (!stream) return Response.json(receipt)
      const body = [
        { type: 'response.output_item.added', item: { ...item, arguments: '' } },
        { type: 'response.function_call_arguments.delta', item_id: 'item', delta: item.arguments },
        { type: 'response.function_call_arguments.done', item_id: 'item', arguments: item.arguments },
        { type: 'response.output_item.done', item },
        { type: 'response.completed', response: receipt },
      ].map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n'
      const chunks = [': keepalive\n\n', body.slice(0, 2), body.slice(2, 5), body.slice(5)]
      return new Response(new ReadableStream<Uint8Array>({ async pull(controller) {
        if (!chunks.length) { controller.close(); return }
        controller.enqueue(new TextEncoder().encode(chunks.shift()!))
        await Bun.sleep(5)
      } }), { headers: { 'content-type': 'text/event-stream' } })
    } })
    const bridge = await startProviderBridge({ BEEGAME_API_PROTOCOL: 'responses', OPENAI_BASE_URL: upstream.url.origin,
      OPENAI_API_KEY: 'synthetic', BEEGAME_MODEL: 'fixture' }, {
      onUsage: value => usage.push(value), resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
        lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
    })
    try {
      const response = await fetch(bridge.baseUrl + '/responses', { method: 'POST',
        headers: { authorization: 'Bearer ' + bridge.apiKey },
        body: JSON.stringify({ stream, tools: [{ type: 'function', name: 'exec_command', parameters: { type: 'object' } }] }) })
      let returned
      if (stream) {
        const events = (await response.text()).split('\n\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)))
        returned = events.find(event => event.type === 'response.output_item.done').item
        expect(events.find(event => event.type === 'response.completed').response.output[0]).toEqual(returned)
        expect(events.find(event => event.type === 'response.completed').response.output[1].encrypted_content).toBe('OPAQUE_UNCHANGED')
        expect(events.find(event => event.type === 'response.function_call_arguments.done').arguments).toBe(returned.arguments)
      } else {
        const completed = await response.json()
        returned = completed.output[0]
        expect(completed.output[1].encrypted_content).toBe('OPAQUE_UNCHANGED')
      }
      const expected = args.justification === '' && !('sandbox_permissions' in args) ? { cmd: 'fixture' } : args
      expect(JSON.parse(returned.arguments)).toEqual(expected)
      expect(returned.call_id).toBe('call')
      expect(usage).toEqual([{ input_tokens: 80, output_tokens: 2, cache_read_tokens: 900, cache_creation_tokens: 20, total_tokens: 1002 }])
      expect(requests).toBe(1)
    } finally { await bridge.close(); upstream.stop(true) }
  }
})

test('Responses compaction usage shares receipt accounting without adding an output budget', async () => {
  const usage: unknown[] = []
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return new Response(null, { status: 404 })
    const body = await request.json() as any
    expect(body).not.toHaveProperty('max_output_tokens')
    return Response.json({ id: 'compact', object: 'response.compaction', output: [],
      usage: { input_tokens: 100, output_tokens: 2, total_tokens: 102 } })
  } })
  const bridge = await startProviderBridge({ BEEGAME_API_PROTOCOL: 'responses', OPENAI_BASE_URL: upstream.url.origin,
    OPENAI_API_KEY: 'fixture', BEEGAME_MODEL: 'fixture' }, { onUsage: value => usage.push(value),
    resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'], lookup: (_h, _o, callback) => callback(null, '127.0.0.1', 4) }) })
  try {
    const response = await fetch(bridge.baseUrl + '/responses/compact', { method: 'POST',
      headers: { authorization: 'Bearer ' + bridge.apiKey }, body: JSON.stringify({ input: 'compact fixture' }) })
    expect((await response.json()).object).toBe('response.compaction')
    expect(usage).toEqual([{ input_tokens: 100, output_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 102 }])
  } finally { await bridge.close(); upstream.stop(true) }
})


// Synthetic image bytes exercise transport size and mapping, not image decoding.
test.each(Object.keys(budgetCompletions))('%s forwards image history above the former 64 MiB bridge cap without truncation', async protocol => {
  const encoded = 'A'.repeat(Math.ceil(65 * 1024 * 1024 / 30 / 4) * 4)
  const imageUrl = 'data:image/png;base64,' + encoded
  const body = JSON.stringify({model:'fixture',stream:true,max_output_tokens:128,
    input:[{role:'user',content:Array.from({length:30},()=>({type:'input_image',image_url:imageUrl}))}]})
  expect(Buffer.byteLength(body)).toBeGreaterThan(64 * 1024 * 1024)
  const hash = (value:string) => createHash('sha256').update(value).digest('hex')
  const expectedHash = hash(encoded), receipts:unknown[] = []
  let requests = 0, received: {bytes:number;hash:string}[] = []
  const upstream = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    if(request.method==='GET')return new Response(null,{status:404})
    requests++
    const value = await request.json() as any
    const parts = protocol==='responses' ? value.input[0].content
      : protocol==='gemini' ? value.contents[0].parts : value.messages[0].content
    const images:string[] = parts.map((part:any)=>protocol==='responses' ? part.image_url.slice(imageUrl.indexOf(',')+1)
      : protocol==='chat-completions' ? part.image_url.url.slice(imageUrl.indexOf(',')+1)
      : protocol==='gemini' ? part.inlineData.data : part.source.data)
    received = images.map(value=>({bytes:value.length,hash:hash(value)}))
    return new Response(budgetCompletions[protocol]!.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),
      {headers:{'content-type':'text/event-stream'}})
  }})
  const prefix = protocol==='anthropic-messages' ? 'ANTHROPIC' : protocol==='gemini' ? 'GEMINI' : 'OPENAI'
  const bridge = await startProviderBridge({BEEGAME_MODEL_TYPE:prefix.toLowerCase(),BEEGAME_API_PROTOCOL:protocol,
    [prefix+'_BASE_URL']:upstream.url.origin,[prefix+'_API_KEY']:'synthetic-only',BEEGAME_MODEL:'fixture'}, {
    onUsage(value){receipts.push(value)},resolveOutboundTarget:async value=>({url:new URL(value),addresses:['127.0.0.1'],
      lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}),
  })
  try {
    const response = await fetch(bridge.baseUrl+'/responses',{method:'POST',
      headers:{authorization:'Bearer '+bridge.apiKey},body,signal:AbortSignal.timeout(15000)})
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('response.completed')
    expect(received).toEqual(Array.from({length:30},()=>({bytes:encoded.length,hash:expectedHash})))
    expect(requests).toBe(1)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({input_tokens:3,output_tokens:1,total_tokens:4})
    for(const headers of [new Headers({authorization:'Bearer wrong-capability'}),
      new Headers({authorization:'Bearer '+bridge.apiKey,origin:'https://example.invalid'})]) {
      const denied = await fetch(bridge.baseUrl+'/responses',{method:'POST',headers,body:'{}'})
      expect(denied.status).toBe(404)
      await denied.text()
    }
    expect(requests).toBe(1)
    expect(receipts).toHaveLength(1)
  }finally{await bridge.close();upstream.stop(true)}
},20000)

test('a real upstream Responses 413 retains its status and body without bridge retries',async()=>{
  let requests=0
  const rejection={error:{type:'invalid_request_error',code:'request_too_large',message:'Synthetic upstream request limit'}}
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){requests++;return Response.json(rejection,{status:413})}})
  const bridge=await startProviderBridge({BEEGAME_API_PROTOCOL:'responses',OPENAI_BASE_URL:upstream.url.origin,
    OPENAI_API_KEY:'synthetic-only',BEEGAME_MODEL:'fixture'}, {
    onUsage(){},resolveOutboundTarget:async value=>({url:new URL(value),addresses:['127.0.0.1'],
      lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4)}),
  })
  try{
    const response=await fetch(bridge.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+bridge.apiKey},
      body:JSON.stringify({model:'fixture',input:'Synthetic',max_output_tokens:128})})
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual(rejection)
    expect(requests).toBe(1)
  }finally{await bridge.close();upstream.stop(true)}
})
