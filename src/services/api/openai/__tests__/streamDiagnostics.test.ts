import { expect, test } from 'bun:test'
import OpenAI from 'openai'
import { adaptOpenAIStreamToAnthropic } from '@ant/model-provider'
import { createOpenAIStreamDiagnostics } from '../streamDiagnostics.js'

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`
const text = { choices: [{ index: 0, delta: { content: 'PRIVATE_REPLY中文', reasoning_content: 'PRIVATE_REASONING' }, finish_reason: null }] }
const terminal = { choices: [{ index: 0, finish_reason: 'stop' }] }

async function run(body: string | ReadableStream<Uint8Array>, status = 200) {
  let calls = 0
  const logs: string[] = []
  const diagnostics = createOpenAIStreamDiagnostics((async (_input, init) => {
    calls++
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer PRIVATE_KEY')
    expect(String(init?.body)).toContain('PRIVATE_PROMPT')
    return new Response(body, { status, headers: { 'content-type': 'text/event-stream', 'x-private': 'PRIVATE_HEADER' } })
  }) as typeof fetch, 'main', line => logs.push(line))
  const client = new OpenAI({ apiKey: 'PRIVATE_KEY', baseURL: 'https://offline.invalid/v1',
    fetch: diagnostics.fetch, maxRetries: 0, logLevel: 'off' })
  let stopped = false, error: unknown
  try {
    const stream = await client.chat.completions.create({ model: 'offline', stream: true,
      messages: [{ role: 'user', content: 'PRIVATE_PROMPT' }] })
    for await (const event of adaptOpenAIStreamToAnthropic(diagnostics.observeParsed(stream), 'offline')) {
      if (event.type === 'message_stop') stopped = true
    }
  } catch (caught) { error = caught }
  const summary = diagnostics.finish(error ? 'failed' : 'completed', error)!
  diagnostics.finish('cancelled')
  expect(logs).toHaveLength(1)
  expect(logs[0]).not.toContain('PRIVATE')
  expect(calls).toBe(1)
  return { summary, error, stopped }
}

test('real SDK preserves split CRLF/UTF-8 SSE, delta-less terminal and trailing usage without logging payloads', async () => {
  const encoded = new TextEncoder().encode(': keepalive\r\n\r\n' + frame(text) + frame(terminal)
    + frame({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }) + 'data: [DONE]\r\n\r\n')
  let offset = 0
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= encoded.length) return controller.close()
    controller.enqueue(encoded.slice(offset, offset += 7))
  } })
  const { summary, stopped, error } = await run(body)
  expect(error).toBeUndefined()
  expect(stopped).toBe(true)
  expect(summary).toMatchObject({ outcome: 'completed', responseFormat: 'event_stream',
    wireEvents: 4, parsedChunks: 3, wireFinishSeen: true, parsedFinishSeen: true,
    terminalWithoutDelta: true, doneSeen: true, eofSeen: true, invalidFrames: 0, pendingFrame: false })
})

test.each(['', 'data: [DONE]\n\n', 'data: {"PRIVATE_PARTIAL":'])('missing terminal remains a failure at EOF (%s)', async ending => {
  const { summary, stopped, error } = await run(frame(text) + ending)
  expect(error).toBeDefined()
  expect(stopped).toBe(false)
  expect(summary).toMatchObject({ outcome: 'failed', streamFailure: 'upstream_incomplete',
    wireFinishSeen: false, parsedFinishSeen: false, eofSeen: true })
})

test('invalid SSE JSON is distinguished from transport failure and its raw contents are not logged', async () => {
  const { summary, stopped } = await run(frame(text) + 'data: PRIVATE_KEY_PRIVATE_BODY\n\n')
  expect(stopped).toBe(false)
  expect(summary).toMatchObject({ streamFailure: 'invalid_sse', invalidFrames: 1 })
})

test('body transport exception retains only a whitelisted network code', async () => {
  let reads = 0
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (++reads === 1) controller.enqueue(new TextEncoder().encode(frame(text)))
    else controller.error(Object.assign(new Error('PRIVATE_KEY_PRIVATE_URL'), { code: 'ECONNRESET' }))
  } }, { highWaterMark: 0 })
  const { summary, stopped } = await run(body)
  expect(stopped).toBe(false)
  expect(summary).toMatchObject({ streamFailure: 'transport', errorCode: 'ECONNRESET', eofSeen: false })
})

test.each(['\n\n', ''])('oversized frames leave diagnosis unknown even without a final delimiter', async delimiter => {
  const { summary } = await run('data: ' + JSON.stringify({ choices: [], private: 'PRIVATE'.repeat(10000) }) + delimiter)
  expect(summary).toMatchObject({ streamFailure: 'unknown', skippedFrames: 1 })
})

test('wire/SDK comparison separates lost SDK terminal, adapter failure and cancellation', async () => {
  for (const kind of ['sdk_parse', 'adapter', 'consumer', 'cancelled'] as const) {
    const logs: string[] = []
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(frame(terminal))) },
      cancel() { cancelled = true },
    })
    const diagnostics = createOpenAIStreamDiagnostics((async () => new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch, 'main', line => logs.push(line))
    const response = await diagnostics.fetch('https://offline.invalid')
    const reader = response.body!.getReader()
    await reader.read()
    async function* parsed() {
      if (kind === 'consumer') yield text as any
      if (kind === 'adapter') yield terminal as any
    }
    for await (const _chunk of diagnostics.observeParsed(parsed())) {
      if (kind === 'consumer') break // Downstream stopped before SDK finished reading.
    }
    await reader.cancel()
    const summary = diagnostics.finish(kind === 'cancelled' ? 'cancelled' : 'failed', new Error('PRIVATE'))!
    expect(cancelled).toBe(true)
    expect(summary.wireFinishSeen).toBe(true)
    expect(summary.streamFailure).toBe(kind === 'cancelled' ? undefined : kind === 'consumer' ? 'adapter' : kind)
    expect(logs.join('')).not.toContain('PRIVATE')
  }
})
