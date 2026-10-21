import { expect, test } from 'bun:test'
import { nativeRequest } from './requests'
import { requestProvider } from './request'
import { parseSse, responseEvents } from './response-stream'
import type { ProviderConfig } from './config'

const config: ProviderConfig = { protocol: 'chat-completions', baseUrl: 'https://fixture.invalid/v1',
  model: 'fixture', apiKey: 'synthetic', auth: 'bearer' }
const sse = (chunks: unknown[]) => new Response(chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join(''))

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
