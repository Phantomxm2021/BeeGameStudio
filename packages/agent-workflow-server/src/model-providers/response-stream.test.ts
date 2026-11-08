import { expect, test } from 'bun:test'
import { nativeRequest } from './requests'
import { requestProvider } from './request'
import { checkedLocalCompaction, nativeResponses, parseSse, responseEvents } from './response-stream'
import type { ProviderConfig } from './config'
import { normalizeNativeFunctionHistory } from './messages'

const config: ProviderConfig = { protocol: 'chat-completions', baseUrl: 'https://fixture.invalid/v1',
  model: 'fixture', apiKey: 'synthetic', auth: 'bearer' }
const sse = (chunks: unknown[]) => new Response(chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join(''))

test.each([false, true])('local compaction validates the replacement before forwarding it (stream=%s)', async streaming => {
  const message = (text: string) => ({ type: 'message', role: 'assistant',
    content: [{ type: 'output_text', text }] })
  for (const output of [[], [message('  ')], [message('<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="exec_command">')],
    [{ type: 'function_call', name: 'exec_command', arguments: '{}' }]]) {
    const receipt = { id: 'compact', status: 'completed', output, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }
    const response = await checkedLocalCompaction(streaming
      ? sse([{ type: 'response.output_text.delta', delta: 'Do not install this partial text' },
        { type: 'response.completed', response: receipt }]) : Response.json(receipt), streaming)
    const value = streaming ? (await Array.fromAsync(parseSse(response))).at(-1)!.response : await response.json()
    expect(value).toMatchObject({ status: 'incomplete', output: [],
      incomplete_details: { reason: 'invalid_compaction_summary' }, usage: receipt.usage })
  }
  const receipt = { id: 'valid', status: 'completed', output: [message('Artwork integrated. Earlier log contained <｜｜DSML｜｜ calls>; no regeneration remains.') ] }
  const events = [{ type: 'response.created', response: { id: 'valid' } }, { type: 'response.completed', response: receipt }]
  const accepted = await checkedLocalCompaction(streaming ? sse(events) : Response.json(receipt), streaming)
  if (streaming) expect(await Array.fromAsync(parseSse(accepted))).toEqual(events)
  else expect(await accepted.json()).toEqual(receipt)
})

test('local compaction keeps item-only summaries and existing failures, but rejects missing terminal events', async () => {
  const item = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Saved progress.' }] }
  const events = [{ type: 'response.output_item.done', item }, { type: 'response.completed', response: { id: 'done', output: [] } }]
  expect(await Array.fromAsync(parseSse(await checkedLocalCompaction(sse(events), true)))).toEqual(events)
  for (const type of ['response.incomplete', 'response.failed']) {
    const failure = [{ type, response: { id: 'upstream', status: type.slice(9), incomplete_details: { reason: 'max_output_tokens' } } }]
    expect(await Array.fromAsync(parseSse(await checkedLocalCompaction(sse(failure), true)))).toEqual(failure)
  }
  for (const source of [sse([{ type: 'response.created', response: { id: 'unfinished' } }]), new Response('data: {broken\n\n')]) {
    expect((await Array.fromAsync(parseSse(await checkedLocalCompaction(source, true)))).at(-1)).toMatchObject(
      { type: 'response.incomplete', response: { incomplete_details: { reason: 'invalid_compaction_summary' } } },
    )
  }
})

test('cancelling local compaction cancels its pending upstream read', async () => {
  let cancelled = false
  const upstream = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true } }))
  const guarded = await checkedLocalCompaction(upstream, true)
  await guarded.body!.cancel()
  expect(cancelled).toBe(true)
})

test('local compaction forwards real activity before completion without releasing unvalidated text', async () => {
  let upstream!: ReadableStreamDefaultController<Uint8Array>
  const source = new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller } }))
  const reader = (await checkedLocalCompaction(source, true)).body!.getReader()
  const send = (event: unknown) => upstream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n'))
  const next = () => Promise.race([reader.read(), Bun.sleep(300).then(() => { throw Error('Compaction activity was withheld') })])
  try {
    send({ type: 'response.created', response: { id: 'compacting', status: 'in_progress', output: [] } })
    expect(new TextDecoder().decode((await next()).value)).toContain('response.created')
    for (const type of ['response.in_progress', 'response.reasoning_text.delta', 'response.output_text.delta']) {
      send({ type, delta: 'PRIVATE_UNVALIDATED_TEXT', response: { id: 'compacting', status: 'in_progress', output: [] } })
      const chunk = new TextDecoder().decode((await next()).value)
      expect(chunk).toContain('response.in_progress')
      expect(chunk).not.toContain('PRIVATE_UNVALIDATED_TEXT')
    }
    send({ type: 'response.completed', response: { id: 'compacting', status: 'completed', output: [] } })
    expect(new TextDecoder().decode((await next()).value)).toContain('invalid_compaction_summary')
    expect((await reader.read()).done).toBe(true)
  } finally { await reader.cancel() }
})

test.each(['chat-completions', 'anthropic-messages', 'gemini'] as const)('%s local summaries use the same validation after protocol conversion', async protocol => {
  for (const text of ['Saved progress; continue remaining work.', '<｜｜DSML｜｜ calls>unparsed command']) {
    let calls = 0
    const values = protocol === 'chat-completions'
      ? [{ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }]
      : protocol === 'anthropic-messages'
        ? [{ type: 'message_start', message: { id: 'fixture', usage: { input_tokens: 10, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }, { type: 'message_stop' }]
        : [{ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } }]
    const converted = await requestProvider({ ...config, protocol }, { input: 'Offline', stream: false },
      (async () => { calls++; return sse(values) }) as unknown as typeof fetch, AbortSignal.timeout(2000))
    const result = await (await checkedLocalCompaction(converted, false)).json()
    expect(result.status).toBe(text.startsWith('<') ? 'incomplete' : 'completed')
    expect(calls).toBe(1)
  }
})

test.each([
  ['chat-completions', [{ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING' } }] }]],
  ['anthropic-messages', [
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'PRIVATE_REASONING' } },
  ]],
  ['gemini', [{ candidates: [{ content: { parts: [{ thought: true, text: 'PRIVATE_REASONING' }] } }] }]],
] as const)('%s forwards activity before text exists without exposing private reasoning', async (protocol, chunks) => {
  let upstream!: ReadableStreamDefaultController<Uint8Array>
  const response = await requestProvider({ ...config, protocol }, { input: 'Offline', stream: true },
    (async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller } }))) as unknown as typeof fetch,
    AbortSignal.timeout(2000))
  const events = parseSse(response)
  try {
    expect((await events.next()).value?.type).toBe('response.created')
    for (const chunk of chunks) {
      upstream.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(chunk) + '\n\n'))
      const next = await Promise.race([events.next(), Bun.sleep(300).then(() => { throw Error('Upstream activity was swallowed') })])
      expect(next.value?.type).toBe('response.in_progress')
      expect(JSON.stringify(next.value)).not.toContain('PRIVATE_REASONING')
      expect(next.value?.response).toMatchObject({ status: 'in_progress', output: [] })
    }
  } finally {
    upstream.close()
    await events.return(undefined)
  }
})

test('a silent or disconnected upstream produces no artificial activity or success', async () => {
  let upstream!: ReadableStreamDefaultController<Uint8Array>
  const receipts: unknown[] = []
  const response = await requestProvider(config, { input: 'Offline', stream: true },
    (async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller } }))) as unknown as typeof fetch,
    AbortSignal.timeout(2000), usage => receipts.push(usage))
  const events = parseSse(response)
  expect((await events.next()).value?.type).toBe('response.created')
  const pending = events.next()
  expect(await Promise.race([pending.then(() => 'unexpected activity'), Bun.sleep(25).then(() => 'silent')])).toBe('silent')
  upstream.error(Error('Synthetic disconnect'))
  expect((await pending).value?.type).toBe('response.failed')
  expect((await events.next()).done).toBe(true)
  expect(receipts).toHaveLength(1)
  expect(receipts[0]).toMatchObject({ total_tokens: 0, incomplete: true })
})

test('cancellation after upstream progress retains acknowledged usage once', async () => {
  const receipts: unknown[] = []
  const events = responseEvents(config, sse([{ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING' } }],
    usage: { prompt_tokens: 10, completion_tokens: 2 } }]), [], usage => receipts.push(usage))
  expect((await events.next()).value?.type).toBe('response.created')
  expect((await events.next()).value?.type).toBe('response.in_progress')
  await events.return(undefined)
  expect(receipts).toEqual([{ input_tokens: 10, output_tokens: 2, cache_read_tokens: 0,
    cache_creation_tokens: 0, total_tokens: 12, incomplete: true }])
})

test('SSE accepts LF, CRLF and CR even when every UTF-8 byte is a separate chunk', async () => {
  for (const separator of ['\n', '\r\n', '\r']) {
    const bytes = new TextEncoder().encode('\uFEFF: heartbeat' + separator + 'event: message' + separator +
      'data: {"text":"你好"}' + separator + separator + 'data: [DONE]' + separator + separator)
    let position = 0, cancelled = false
    const response = new Response(new ReadableStream({ pull(controller) {
      if (position < bytes.length) controller.enqueue(bytes.slice(position, ++position))
      else controller.close()
    }, cancel() { cancelled = true } }, { highWaterMark: 0 }))
    const events = []
    for await (const event of parseSse(response)) events.push(event)
    expect(events).toEqual([{ text: '你好' }])
    expect(cancelled).toBe(true)
  }
})

test('SSE still rejects malformed JSON and unfinished events', async () => {
  for (const text of ['data: {bad}\n\n', 'data: {"partial":true}\n']) {
    const read = async () => { for await (const _ of parseSse(new Response(text))) {} }
    await expect(read()).rejects.toThrow(text.includes('{bad}') ? 'invalid JSON event' : 'inside an event')
  }
})

test('SSE rejects a no-newline event before it can grow without a bound', async () => {
  const bytes = new Uint8Array(64 * 1024 * 1024 + 1)
  bytes.set(new TextEncoder().encode('data:'))
  bytes.fill(120, 5)
  const read = async () => {
    for await (const _ of parseSse(new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close() },
    })))) { /* consume */ }
  }
  await expect(read()).rejects.toThrow('event exceeds the size limit')
})

test('Anthropic message_stop finishes and cancels the reader without reading a failing transport tail', async () => {
  let cancelled = false, position = 0
  const chunks = [
    { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Completed' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ]
  const response = new Response(new ReadableStream({ pull(controller) {
    if (position < chunks.length)
      controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(chunks[position++]) + '\n\n'))
    else throw Error('transport tail must not be read')
  }, cancel() { cancelled = true } }, { highWaterMark: 0 }))
  const events = [], receipts: unknown[] = []
  for await (const event of responseEvents({ ...config, protocol: 'anthropic-messages' }, response, [], usage => receipts.push(usage)))
    events.push(event)
  expect(events.at(-1)?.type).toBe('response.completed')
  expect(receipts).toEqual([{ input_tokens: 10, output_tokens: 2, cache_read_tokens: 0,
    cache_creation_tokens: 0, total_tokens: 12 }])
  expect(cancelled).toBe(true)
})

test('Anthropic partial terminal usage stays marked incomplete through the response and callback', async () => {
  const response = sse([
    { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Partial' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} },
    { type: 'message_stop' },
  ])
  const events: any[] = [], receipts: unknown[] = []
  for await (const event of responseEvents({ ...config, protocol: 'anthropic-messages' }, response, [], usage => receipts.push(usage)))
    events.push(event)
  expect(events.at(-1)).toMatchObject({
    type: 'response.completed',
    response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 0, incomplete: true } },
  })
  expect(receipts).toEqual([{ input_tokens: 10, output_tokens: 0, cache_read_tokens: 0,
    cache_creation_tokens: 0, total_tokens: 10, incomplete: true }])
})

test('ordinary function argument errors reach the native tool handler and survive continuation', async () => {
  const tools = [{ type: 'function', name: 'probe', parameters: { type: 'object' } }]
  const argumentsText = '{"value":'
  const response = await requestProvider(config, { input: 'Offline', tools, stream: true },
    (async () => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'bad-arguments',
      function: { name: 'probe', arguments: argumentsText } }] }, finish_reason: 'tool_calls' }] }])) as unknown as typeof fetch,
    AbortSignal.timeout(2000))
  const events = []
  for await (const event of parseSse(response)) events.push(event)
  const result = events.find(event => event.type === 'response.completed')?.response
  expect(result).toBeDefined()
  expect(result.output[0]).toMatchObject({ type: 'function_call', name: 'probe',
    call_id: 'bad-arguments', arguments: argumentsText })
  const continuation = nativeRequest(config, { model: 'fixture', tools, input: [...result.output,
    { type: 'function_call_output', call_id: 'bad-arguments', output: 'failed to parse function arguments' }] })
  expect((continuation.body as any).messages).toMatchObject([
    { role: 'assistant', tool_calls: [{ function: { name: 'probe', arguments: argumentsText } }] },
    { role: 'tool', tool_call_id: 'bad-arguments', content: 'failed to parse function arguments' },
  ])
})

for (const stream of [false, true]) test('refusal-only replies retain user-visible text; stream=' + stream, async () => {
  const response = await requestProvider(config, { input: 'Offline', stream }, (async () => sse([
    { choices: [{ delta: { content: null, refusal: 'Cannot ' } }] },
    { choices: [{ delta: { refusal: 'help with this.' }, finish_reason: 'stop' }] },
  ])) as unknown as typeof fetch, AbortSignal.timeout(2000))
  let result: any
  if (stream) {
    for await (const event of parseSse(response)) if (event.type === 'response.completed') result = event.response
  } else result = await response.json()
  expect(result.status).toBe('completed')
  expect(result.output[0].content[0].text).toBe('Cannot help with this.')
})

test.each([
  ['chat-completions', 'content_filter', 'content_filter'],
  ['chat-completions', 'length', 'max_output_tokens'],
  ['anthropic-messages', 'max_tokens', 'max_output_tokens'],
  ['gemini', 'SAFETY', 'content_filter'],
  ['gemini', 'MAX_TOKENS', 'max_output_tokens'],
  ['gemini', 'MALFORMED_FUNCTION_CALL', 'provider_stop'],
] as const)('%s retains the reason for an incomplete response: %s', async (protocol, finish, reason) => {
  const chunks = protocol === 'chat-completions'
    ? [{ choices: [{ delta: {}, finish_reason: finish }] }]
    : protocol === 'anthropic-messages'
      ? [{ type: 'message_delta', delta: { stop_reason: finish } }, { type: 'message_stop' }]
      : [{ candidates: [{ finishReason: finish }] }]
  const events = []
  for await (const event of responseEvents({ ...config, protocol }, sse(chunks), [])) events.push(event)
  expect(events.at(-1)).toMatchObject({ type: 'response.incomplete',
    response: { status: 'incomplete', incomplete_details: { reason } } })
})


test.each(['heartbeat', 'split-event', 'empty-chunk'] as const)(
  'native Responses keeps reading after a non-emitting chunk: %s', async first => {
    const encoder = new TextEncoder(), receipts: unknown[] = []
    const created = 'data: ' + JSON.stringify({ type: 'response.created', response: { id: 'native-fixture' } }) + '\n\n'
    const completed = 'data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'native-fixture',
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } }) + '\n\ndata: [DONE]\n\n'
    const chunks = first === 'heartbeat' ? [': keepalive\n\n', created, completed]
      : first === 'split-event' ? ['da', created.slice(2, -1), created.slice(-1), completed]
      : ['', created, completed]
    const response = await requestProvider({ ...config, protocol: 'responses' }, {
      stream: true, tools: [{ type: 'function', name: 'exec_command', parameters: { type: 'object' } }],
    }, (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }), { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch,
      AbortSignal.timeout(2000), usage => receipts.push(usage))
    const reader = response.body!.getReader()
    try {
      const observed = await Promise.race([
        reader.read(), Bun.sleep(300).then(() => { throw Error('Responses forwarding stopped after a non-emitting chunk') }),
      ])
      expect(new TextDecoder().decode(observed.value)).toContain('response.created')
      let remaining = ''
      while (true) {
        const next = await reader.read()
        if (next.done) break
        remaining += new TextDecoder().decode(next.value)
      }
      expect(remaining).toContain('response.completed')
      expect(remaining).toContain('[DONE]')
      expect(receipts).toEqual([{ input_tokens: 10, output_tokens: 2, cache_read_tokens: 0,
        cache_creation_tokens: 0, total_tokens: 12 }])
    } finally { await reader.cancel(); reader.releaseLock() }
  })

test.each([false,true])('bodyless successful compaction rejects the summary in a readable protocol envelope (stream=%s)',async streaming=>{
  for(const status of [204,205]) {
    const response=await checkedLocalCompaction(new Response(null,{status}),streaming)
    expect(response.status).toBe(200)
    const value=streaming ? (await Array.fromAsync(parseSse(response))).at(-1)!.response : await response.json()
    expect(value).toMatchObject({status:'incomplete',output:[],incomplete_details:{reason:'invalid_compaction_summary'}})
  }
})


test.each([false, true])('Responses restores only uniquely declared qualified function names (stream=%s)', async stream => {
  const namespace = 'mcp__bgs_90c60304_a523_4dcd_b916_f15c254ffb28'
  const tools = [
    {type:'web_search'}, // Native hosted tools need no protocol conversion.
    {type:'namespace',name:namespace,tools:[{type:'function',name:'browser_navigate'}]},
    {type:'namespace',name:'functions',tools:[{type:'function',name:'exec_command'}]},
    {type:'namespace',name:'collision',tools:[{type:'function',name:'literal'}]},
    {type:'function',name:'collision.literal'},
    {type:'namespace',name:'a.b',tools:[{type:'function',name:'c'}]},
    {type:'namespace',name:'a',tools:[{type:'function',name:'b.c'}]},
  ]
  const args = JSON.stringify({url:'http://fixture.invalid/game'})
  const calls = [
    {id:'flat',type:'function_call',name:namespace+'.browser_navigate',arguments:args,call_id:'call-flat',status:'completed',provider_field:'retained'},
    {id:'canonical',type:'function_call',namespace,name:'browser_navigate',arguments:args,call_id:'call-canonical'},
    {id:'wrong',type:'function_call',namespace:'other',name:namespace+'.browser_navigate',arguments:args,call_id:'call-wrong'},
    {id:'unknown',type:'function_call',name:namespace+'.not_declared',arguments:args,call_id:'call-unknown'},
    {id:'collision',type:'function_call',name:'collision.literal',arguments:'{}',call_id:'call-collision'},
    {id:'ambiguous',type:'function_call',name:'a.b.c',arguments:'{}',call_id:'call-ambiguous'},
    {id:'exec',type:'function_call',name:'functions.exec_command',arguments:'{"cmd":"pwd","justification":""}',call_id:'call-exec'},
    {id:'message',type:'message',role:'assistant',content:[{type:'output_text',text:namespace+'.browser_navigate is text, not a call.'}]},
    {id:'opaque',type:'reasoning',encrypted_content:'OPAQUE_HISTORY_UNCHANGED'},
  ]
  const expected = structuredClone(calls).map(call => {
    if (call.id === 'flat') return {...call,namespace,name:'browser_navigate'}
    if (call.id === 'exec') return {...call,namespace:'functions',name:'exec_command',arguments:'{"cmd":"pwd"}'}
    return call
  })
  const response = {id:'namespace-fixture',status:'completed',output:calls,usage:{input_tokens:10,output_tokens:2,total_tokens:12}}
  const events = [
    {type:'response.created',response:{id:response.id,status:'in_progress',output:[]}},
    ...calls.filter(item=>item.type==='function_call').flatMap((item,output_index)=>[
      {type:'response.output_item.added',output_index,item:{...item,arguments:''}},
      {type:'response.function_call_arguments.delta',item_id:item.id,delta:item.arguments},
      {type:'response.function_call_arguments.done',item_id:item.id,arguments:item.arguments},
      {type:'response.output_item.done',output_index,item},
    ]),
    {type:'response.completed',response},
  ]
  const receipts:unknown[] = []
  const converted = await nativeResponses(stream ? sse(events) : Response.json(response), {stream,tools}, receipt=>receipts.push(receipt))
  let result:any
  if(stream) {
    const forwarded = await Array.fromAsync(parseSse(converted))
    result = forwarded.at(-1)!.response
    const added = forwarded.find(event=>event.type==='response.output_item.added' && event.item.id==='flat')!.item
    expect(added).toMatchObject({name:'browser_navigate',namespace,arguments:'',call_id:'call-flat',provider_field:'retained'})
    const done = forwarded.find(event=>event.type==='response.output_item.done' && event.item.id==='flat')!.item
    expect(done).toEqual(expected[0])
    expect(forwarded.find(event=>event.type==='response.function_call_arguments.delta')!.delta).toBe(args)
    expect(forwarded.find(event=>event.type==='response.function_call_arguments.done' && event.item_id==='exec')!.arguments).toBe('{"cmd":"pwd"}')
  } else result = await converted.json()
  expect(result).toEqual({...response,output:expected})
  expect(receipts).toEqual([{input_tokens:10,output_tokens:2,cache_read_tokens:0,cache_creation_tokens:0,total_tokens:12}])
})

test.each([false, true])('Responses restores a declared MCP identity without exec_command in tools (stream=%s)', async stream => {
  const call = {id:'call-only',type:'function_call',name:'mcp__browser.browser_navigate',call_id:'navigate',arguments:'{}'}
  const completed = {type:'response.completed',response:{id:'only-mcp',status:'completed',output:[call]}}
  const response = await nativeResponses(stream ? sse([completed]) : Response.json(completed.response), {
    stream,tools:[{type:'namespace',name:'mcp__browser',tools:[{type:'function',name:'browser_navigate'}]}],
  })
  const result = stream ? (await Array.fromAsync(parseSse(response)))[0]!.response : await response.json()
  expect(result.output).toEqual([{...call,name:'browser_navigate',namespace:'mcp__browser'}])
})


test.each([false,true])('Responses normalizes integer write_stdin spelling without coercing invalid arguments (stream=%s)',async stream=>{
  const raw=['{"session_id":24963.0}', '{"session_id":24963,"chars":""}', '{"session_id":24963.5}',
    '{"session_id":"24963.0"}', '{"session_id":2147483648.0}', '{"session_id":24963.0,"untrusted":9007199254740993}']
  const calls=raw.map((arguments_,i)=>({id:'stdin-'+i,type:'function_call',name:'write_stdin',call_id:'stdin-'+i,arguments:arguments_}))
  const completed={type:'response.completed',response:{id:'stdin-fixture',status:'completed',output:calls}}
  const response=await nativeResponses(stream?sse([completed]):Response.json(completed.response),{
    stream,tools:[{type:'function',name:'write_stdin',parameters:{type:'object',properties:{session_id:{type:'integer'}}}}]})
  const result=stream?(await Array.fromAsync(parseSse(response)))[0]!.response:await response.json()
  expect(result.output.map((call:any)=>call.arguments)).toEqual(['{"session_id":24963}',...raw.slice(1)])
})


test.each([false,true])('Responses adapts unique bare tools and completed empty arguments using declarations (stream=%s)',async stream=>{
  const tools=[
    {type:'namespace',name:'mcp__browser',tools:[
      {type:'function',name:'browser_snapshot',parameters:{type:'object',properties:{filename:{type:'string'}},additionalProperties:false}},
      {type:'function',name:'navigate',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}},
      {type:'function',name:'shared',parameters:{type:'object',properties:{}}},
      {type:'function',name:'literal',parameters:{type:'object',properties:{}}},
      {type:'function',name:'constrained',parameters:{type:'object',properties:{},minProperties:1}},
    ]},
    {type:'namespace',name:'other',tools:[{type:'function',name:'shared',parameters:{type:'object',properties:{}}}]},
    {type:'function',name:'literal',parameters:{type:'object',properties:{}}},
  ]
  const calls=[
    {name:'browser_snapshot',arguments:''},
    {name:'navigate',arguments:''},
    {name:'shared',arguments:'{}'},
    {name:'literal',arguments:'{}'},
    {name:'unknown',arguments:''},
    {name:'browser_snapshot',namespace:'wrong',arguments:''},
    {name:'constrained',arguments:''},
    {name:'browser_snapshot',arguments:'{bad'},
  ].map((call,i)=>({id:'bare-'+i,type:'function_call',call_id:'bare-'+i,status:'completed',...call}))
  const completed={type:'response.completed',response:{id:'bare-fixture',status:'completed',output:calls}}
  const events=calls.flatMap((call,output_index)=>[
    {type:'response.output_item.added',output_index,item:{...call,status:'in_progress',arguments:''}},
    {type:'response.function_call_arguments.done',item_id:call.id,arguments:call.arguments},
    {type:'response.output_item.done',output_index,item:call},
  ])
  const response=await nativeResponses(stream?sse([...events,completed]):Response.json(completed.response),{stream,tools})
  const forwarded=stream?await Array.fromAsync(parseSse(response)):[]
  const result=stream?forwarded.at(-1)!.response:await response.json()
  expect(result.output).toEqual(calls.map((call,i)=>i===0?{...call,namespace:'mcp__browser',arguments:'{}'}:
    [1,6].includes(i)?{...call,namespace:'mcp__browser',arguments:'{}'}:i===7?{...call,namespace:'mcp__browser'}:call))
  if(stream){
    expect(forwarded.find(e=>e.type==='response.output_item.added'&&e.item.id==='bare-0')!.item.arguments).toBe('')
    expect(forwarded.find(e=>e.type==='response.function_call_arguments.done'&&e.item_id==='bare-0')!.arguments).toBe('{}')
    expect(forwarded.find(e=>e.type==='response.output_item.done'&&e.item.id==='bare-0')!.item.arguments).toBe('{}')
  }
})

test.each([false,true])('Responses canonicalizes safe exec integer spelling without changing permissions (stream=%s)',async stream=>{
  const raw=['{"cmd":"pwd","yield_time_ms":15000.0,"max_output_tokens":1000.0}',
    '{"cmd":"pwd","yield_time_ms":1.5}', '{"cmd":"pwd","yield_time_ms":"15000.0"}',
    '{"cmd":"pwd","yield_time_ms":9007199254740993}',
    '{"cmd":"pwd","yield_time_ms":15000.0,"sandbox_permissions":"require_escalated","justification":"Explicit permission"}']
  const calls=raw.map((arguments_,i)=>({id:'exec-number-'+i,type:'function_call',name:'exec_command',call_id:'exec-number-'+i,arguments:arguments_}))
  const completed={type:'response.completed',response:{id:'exec-number-fixture',status:'completed',output:calls}}
  const response=await nativeResponses(stream?sse([completed]):Response.json(completed.response),{
    stream,tools:[{type:'function',name:'exec_command',parameters:{type:'object',properties:{cmd:{type:'string'},yield_time_ms:{type:'integer'}},required:['cmd']}}]})
  const result=stream?(await Array.fromAsync(parseSse(response)))[0]!.response:await response.json()
  expect(result.output.map((call:any)=>call.arguments)).toEqual([
    '{"cmd":"pwd","yield_time_ms":15000,"max_output_tokens":1000}',...raw.slice(1,4),
    '{"cmd":"pwd","yield_time_ms":15000,"sandbox_permissions":"require_escalated","justification":"Explicit permission"}'])
})


test('empty object-call history remains replayable without filling required fields or modifying persisted input',()=>{
  const body={tools:[{type:'namespace',name:'mcp__browser',tools:[{type:'function',name:'browser_navigate',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}}]}],input:[
    {type:'reasoning',encrypted_content:'OPAQUE_UNCHANGED'},
    {type:'function_call',id:'bad',call_id:'bad',namespace:'mcp__browser',name:'browser_navigate',arguments:''},
    {type:'function_call_output',call_id:'bad',output:'Invalid input: expected string at url'},
    {type:'function_call',id:'malformed',namespace:'mcp__browser',name:'browser_navigate',arguments:'{bad'},
    {type:'function_call',id:'unknown',name:'unknown',arguments:''},
  ]}
  const saved=structuredClone(body),normalized=normalizeNativeFunctionHistory(body)
  expect(body).toEqual(saved)
  expect(normalized.input[1]).toEqual({...body.input[1],arguments:'{}'})
  expect(normalized.input[2]).toEqual(body.input[2])
  expect(normalized.input[0]).toBe(body.input[0])
  expect(normalized.input[3]).toBe(body.input[3])
  expect(normalized.input[4]).toBe(body.input[4])
  expect(JSON.parse(normalized.input[1].arguments)).not.toHaveProperty('url')
})

// The historical downstream history cannot reconstruct missing upstream bytes.
// These are the reproduced split-event variants, not a claim about that run.
for (const source of ['argument-done', 'deltas', 'terminal'] as const) for (const namespaced of [false, true])
test(`Responses fills empty completions from current ${source} parameters; namespaced=${namespaced}`, async () => {
  const tools = [{type:'function',name:'browser_navigate',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}}]
  const namespace = namespaced ? 'mcp__browser' : undefined
  const definitions = namespaced ? [{type:'namespace',name:namespace,tools}] : tools
  const calls = ['one','two'].map(id=>({type:'function_call',id:'item-'+id,call_id:'call-'+id,name:'browser_navigate',
    ...(namespace?{namespace}:{}),status:'completed',arguments:JSON.stringify({url:'https://fixture.invalid/'+id})}))
  const empty = calls.map(call=>({...call,arguments:''}))
  const events:any[] = [
    ...empty.map((item,output_index)=>({type:'response.output_item.added',output_index,item:{...item,status:'in_progress'}})),
    ...calls.toReversed().flatMap<Record<string, unknown>>(call=>source==='argument-done'
      ? [{type:'response.function_call_arguments.done',item_id:call.id,arguments:call.arguments}]
      : source==='deltas' ? [call.arguments.slice(0,9),call.arguments.slice(9)].map(delta=>({type:'response.function_call_arguments.delta',item_id:call.id,delta})) : []),
    ...empty.map((item,output_index)=>({type:'response.output_item.done',output_index,item})),
    {type:'response.output_item.done',output_index:2,item:{type:'reasoning',encrypted_content:'OPAQUE_UNCHANGED'}},
    {type:'response.completed',response:{id:'split',status:'completed',output:source==='terminal'?calls:empty,
      usage:{input_tokens:5,output_tokens:2,total_tokens:7}}},
  ]
  events.forEach((event,sequence_number)=>{event.sequence_number=sequence_number})
  const before=structuredClone(events), receipts:unknown[]=[]
  const response=await nativeResponses(sse(events),{stream:true,tools:definitions},usage=>receipts.push(usage))
  const forwarded=await Array.fromAsync(parseSse(response))
  expect(forwarded.map(event=>event.sequence_number)).toEqual(events.map(event=>event.sequence_number))
  expect(forwarded.filter(event=>event.type==='response.output_item.done'&&event.item.type==='function_call').map(event=>event.item)).toEqual(calls)
  expect(forwarded.at(-1)!.response.output).toEqual(calls)
  expect(forwarded.find(event=>event.item?.type==='reasoning')!.item.encrypted_content).toBe('OPAQUE_UNCHANGED')
  expect(receipts).toEqual([{input_tokens:5,output_tokens:2,cache_read_tokens:0,cache_creation_tokens:0,total_tokens:7}])
  expect(events).toEqual(before)
})

test('Responses keeps genuine missing fields, explicit empty objects and other-call/history arguments separate', async()=>{
  const tools=[{type:'function',name:'browser_navigate',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}}]
  const call={type:'function_call',id:'same-item',call_id:'same-call',name:'browser_navigate',arguments:''}
  const source='{"url":"https://fixture.invalid/earlier"}'
  for(const arguments_ of ['', '{}']) {
    const item={...call,arguments:arguments_}
    const events=[{type:'response.output_item.added',item:{...item,arguments:''}},
      {type:'response.function_call_arguments.done',item_id:'different-item',arguments:source},
      {type:'response.output_item.done',item},
      {type:'response.completed',response:{id:'empty',status:'completed',output:[item]}}]
    const response=await nativeResponses(sse(events),{stream:true,tools,input:[{...call,arguments:source}]})
    const forwarded=await Array.fromAsync(parseSse(response))
    expect(forwarded.find(event=>event.type==='response.output_item.done')!.item.arguments).toBe('{}')
    expect(forwarded.at(-1)!.response.output[0].arguments).toBe('{}')
  }
  const first=[{type:'response.output_item.added',item:call},
    {type:'response.function_call_arguments.done',item_id:call.id,arguments:source},
    {type:'response.output_item.done',item:call},{type:'response.completed',response:{id:'first',output:[call]}}]
  expect((await Array.fromAsync(parseSse(await nativeResponses(sse(first),{stream:true,tools})))).at(-1)!.response.output[0].arguments).toBe(source)
  const second=[{type:'response.output_item.done',item:call},{type:'response.completed',response:{id:'second',output:[call]}}]
  expect((await Array.fromAsync(parseSse(await nativeResponses(sse(second),{stream:true,tools})))).at(-1)!.response.output[0].arguments).toBe('{}')
})

for(const conflict of ['snapshot','terminal','delta','identity','unknown-tool','duplicate-call-id','explicit-empty','large-integer'] as const)
test('Responses rejects conflicting '+conflict+' without releasing a held executable call',async()=>{
  const tools=[{type:'function',name:'browser_navigate',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}}]
  const item={type:'function_call',id:'item',call_id:'call',name:'browser_navigate',arguments:''}
  const first=conflict==='large-integer'?'{"n":9007199254740992}':'{"url":"https://fixture.invalid/first"}'
  const other=conflict==='large-integer'?'{"n":9007199254740993}':'{"url":"https://fixture.invalid/other"}'
  const done={...item,...(conflict==='snapshot'?{arguments:other}:conflict==='explicit-empty'?{arguments:'{}'}:
    conflict==='identity'?{call_id:'another-call'}:conflict==='unknown-tool'?{name:'not_declared'}:{})}
  const events=[{type:'response.output_item.added',item},
    {type:'response.function_call_arguments.done',item_id:item.id,arguments:first},
    ...(conflict==='delta'?[{type:'response.function_call_arguments.delta',item_id:item.id,delta:other}]:[]),
    ...(conflict==='duplicate-call-id'?[{type:'response.output_item.added',item:{...item,id:'another-item'}}]:[]),
    {type:'response.output_item.done',item:done},
    {type:'response.completed',response:{id:'conflict',status:'completed',output:[{...item,arguments:other}]}}]
  const errors:string[]=[], emitted:any[]=[]
  // Separate chunks ensure this checks withholding, not just a whole-buffer failure.
  const upstream=new Response(new ReadableStream<Uint8Array>({start(controller){
    for(const event of events)controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'))
    controller.close()
  }}))
  const response=await nativeResponses(upstream,{stream:true,tools},undefined,message=>errors.push(message))
  await expect((async()=>{for await(const event of parseSse(response))emitted.push(event)})()).rejects.toThrow(['identity','unknown-tool','duplicate-call-id'].includes(conflict)?'identity':'conflicting')
  expect(emitted.filter(event=>event.type==='response.output_item.done')).toEqual([])
  expect(errors).toHaveLength(1)
  expect(errors[0]).not.toContain('fixture.invalid')
})

test('Responses accepts equivalent complete JSON snapshots without changing their values',async()=>{
  const tools=[{type:'function',name:'probe',parameters:{type:'object'}}]
  const item={type:'function_call',id:'item',call_id:'call',name:'probe',arguments:''}
  const events=[{type:'response.output_item.added',item},
    {type:'response.function_call_arguments.done',item_id:item.id,arguments:'{ "x": 1, "y": "a" }'},
    {type:'response.output_item.done',item},{type:'response.completed',response:{id:'equivalent',output:[{...item,arguments:'{"y":"a","x":1}'}]}}]
  const output=await Array.fromAsync(parseSse(await nativeResponses(sse(events),{stream:true,tools})))
  expect(JSON.parse(output.find(event=>event.type==='response.output_item.done')!.item.arguments)).toEqual({x:1,y:'a'})
})

for(const ending of ['eof','done-marker','incomplete','failed','partial-json'] as const)
test('Responses never executes a held call after '+ending,async()=>{
  const item={type:'function_call',id:'item',call_id:'call',name:'probe',arguments:''}
  const events:any[]=[{type:'response.output_item.added',item},
    {type:'response.function_call_arguments.delta',item_id:item.id,delta:ending==='partial-json'?'{"x":':'{"x":1}'},
    {type:'response.output_item.done',item}]
  if(['incomplete','failed','partial-json'].includes(ending))events.push({type:ending==='partial-json'?'response.completed':'response.'+ending,
    response:{id:'terminal',status:ending==='partial-json'?'completed':ending,output:[item],incomplete_details:{reason:'max_output_tokens'}}})
  const response=await nativeResponses(new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+
    (ending==='done-marker'?'data: [DONE]\n\n':'')),{stream:true,tools:[{type:'function',name:'probe',parameters:{type:'object'}}]})
  const output:any[]=[]
  const read=async()=>{for await(const event of parseSse(response))output.push(event)}
  if(ending==='incomplete'||ending==='failed'){
    await read();expect(output.at(-1)!.type).toBe('response.'+ending)
    expect(output.at(-1)!.response.incomplete_details.reason).toBe('max_output_tokens')
  }else await expect(read()).rejects.toThrow(ending==='partial-json'?'incomplete function-call arguments':'pending function calls')
  expect(output.filter(event=>event.type==='response.output_item.done')).toEqual([])
})

test('Responses cancellation drops held calls and cancels the source',async()=>{
  const item={type:'function_call',id:'item',call_id:'call',name:'probe',arguments:''}
  let cancelled=false
  const source=new Response(new ReadableStream<Uint8Array>({start(controller){
    const events=[{type:'response.output_item.added',item},
      {type:'response.function_call_arguments.done',item_id:item.id,arguments:'{"x":1}'},
      {type:'response.output_item.done',item}]
    controller.enqueue(new TextEncoder().encode(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')))
  },cancel(){cancelled=true}}))
  const response=await nativeResponses(source,{stream:true,tools:[{type:'function',name:'probe',parameters:{type:'object'}}]})
  const reader=response.body!.getReader(), first=await reader.read()
  expect(new TextDecoder().decode(first.value)).not.toContain('response.output_item.done')
  await reader.cancel();expect(cancelled).toBe(true)
})
