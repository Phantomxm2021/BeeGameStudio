import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openModelUsageProxy, summarizeModelStageUsage, type ModelRequestObservation } from './model-usage-proxy'
import { nativeErrorMetadata } from '@bee-game-studio/agent-workflow/native-diagnostics'
import { Stream } from '@anthropic-ai/sdk/core/streaming'

const frame = (value: object) => `data: ${JSON.stringify(value)}\r\n\r\n`
const start = frame({ type: 'message_start', message: { usage: { input_tokens: 10,
  output_tokens: 1, cache_read_input_tokens: 20 } } })
const end = frame({ type: 'message_delta', usage: { output_tokens: 30 } }) + frame({ type: 'message_stop' })

test('groups stage costs by actual actor, retaining partial and missing observations without counting metadata as model work', () => {
  const record = (id: number, patch: Partial<ModelRequestObservation>): ModelRequestObservation => ({
    id, stage: 'review', actor: 'reviewer', startedAt: id, outcome: 'completed',
    usage: { input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 5 }, usageCompleteness: 'final',
    requestKind: 'messages', phase: 'body', ...patch,
  })
  const groups = summarizeModelStageUsage([
    record(1, { requestKind: 'other', usage: {}, usageCompleteness: 'missing' }),
    record(2, {}), record(3, { actor: 'writer', stage: 'author' }),
    record(4, { outcome: 'failed', usageCompleteness: 'partial', usage: { input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 1 } }),
    record(5, { outcome: 'running', usage: {}, usageCompleteness: 'missing' }),
    record(6, { actor: undefined, stage: 'revise', usage: {}, usageCompleteness: 'missing' }),
  ])
  expect(groups).toHaveLength(3)
  expect(groups[0]).toMatchObject({ stage: 'review', actor: 'reviewer', firstRequestId: 2, lastRequestId: 5,
    startedModelRequests: 3, finalModelCalls: 1, totalObservedTokens: 86, usageComplete: false,
    partialUsageRequestIds: [4], missingUsageRequestIds: [5], runningRequestIds: [5],
    firstObservedInputContextTokens: 30, lastObservedInputContextTokens: 50,
    minObservedInputContextTokens: 30, maxObservedInputContextTokens: 50 })
  expect(groups[1]).toMatchObject({ actor: 'writer', stage: 'author', totalObservedTokens: 35, usageComplete: true })
  expect(groups[2]).toMatchObject({ actor: null, finalModelCalls: 0, usageComplete: false,
    firstObservedInputContextTokens: null, lastObservedInputContextTokens: null, maxObservedInputContextTokens: null })
  expect(summarizeModelStageUsage([])).toEqual([])
})

async function fixture(response: (request: Request) => Response | Promise<Response>, run: (proxy: ReturnType<typeof openModelUsageProxy>, path: string) => Promise<void>,
  options?: Parameters<typeof openModelUsageProxy>[3]) {
  const root = await mkdtemp(join(tmpdir(), 'bgs-usage-observation-')), path = join(root, 'usage.json')
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: response })
  const proxy = openModelUsageProxy(`http://127.0.0.1:${upstream.port}`, path, () => 'fixture', options)
  try { await run(proxy, path) }
  finally { await proxy.close(); upstream.stop(true); await rm(root, { recursive: true, force: true }) }
}

test('forwards request and fragmented SSE bytes, persists final usage but no prompts/headers', async () => {
  const bytes = new TextEncoder().encode(start + frame({ type: 'content_block_delta', delta: { text: '秘密内容' } }) + end)
  await fixture(async request => {
    expect(await request.text()).toBe('PRIVATE_PROMPT')
    expect(request.headers.get('x-api-key')).toBe('PRIVATE_KEY')
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
      controller.close()
    } }), { headers: { 'content-type': 'text/event-stream' } })
  }, async (proxy, path) => {
    const result = await fetch(proxy.baseUrl + '/v1/messages', { method: 'POST', body: 'PRIVATE_PROMPT', headers: { 'x-api-key': 'PRIVATE_KEY' } })
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes)
    const raw = await readFile(path, 'utf8'), report = JSON.parse(raw)
    expect(report.basis).toBe('provider-observation-not-settlement')
    expect(report.requests).toHaveLength(1)
    expect(report.requests[0]).toMatchObject({ outcome: 'completed', usageCompleteness: 'final',
      usage: { input_tokens: 10, output_tokens: 30, cache_read_input_tokens: 20 } })
    expect(report.requests[0].endedAt).toBeGreaterThanOrEqual(report.requests[0].startedAt)
    expect(report.totals).toMatchObject({ usageComplete: true, totalObservedTokens: 60, startedRequests: 1 })
    expect(report.stageUsage).toMatchObject([{ stage: 'fixture', actor: null, finalModelCalls: 1,
      totalObservedTokens: 60, firstObservedInputContextTokens: 30, lastObservedInputContextTokens: 30 }])
    expect(raw).not.toContain('PRIVATE_'); expect(raw).not.toContain('秘密内容')
  })
})

test.each([start, start + frame({ type: 'error', error: { message: 'private provider details' } })])(
  'initial usage and provider errors are not final consumption', async bytes => {
    await fixture(() => new Response(bytes, { headers: { 'content-type': 'text/event-stream' } }), async (proxy, path) => {
      await (await fetch(proxy.baseUrl + '/v1/messages')).text()
      const report = JSON.parse(await readFile(path, 'utf8'))
      expect(report.requests[0].usageCompleteness).toBe('partial')
      expect(report.requests[0].usage.output_tokens).toBe(1)
      expect(report.requests[0].elapsedSeconds).toBeGreaterThanOrEqual(0)
      expect(report.totals).toMatchObject({ usageComplete: false, partialUsageRequestIds: [1] })
    })
  })

test('JSON completion is final, missing usage and HTTP errors are not zero spend', async () => {
  await fixture(request => new URL(request.url).pathname.endsWith('/good')
    ? Response.json({ usage: { input_tokens: 5, output_tokens: 7 } }) : Response.json({ error: 'denied' }, { status: 401 }), async (proxy, path) => {
    await (await fetch(proxy.baseUrl + '/good')).text()
    await (await fetch(proxy.baseUrl + '/bad')).text()
    const { requests } = JSON.parse(await readFile(path, 'utf8'))
    expect(requests[0]).toMatchObject({ outcome: 'completed', usageCompleteness: 'final' })
    expect(requests[1]).toMatchObject({ status: 401, outcome: 'failed', error: 'provider', usageCompleteness: 'missing', usage: {} })
  })
})

test('stopping the proxy closes a started stream with timestamps and partial usage', async () => {
  await fixture(() => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(start)) } }),
    { headers: { 'content-type': 'text/event-stream' } }), async (proxy, path) => {
    const result = await fetch(proxy.baseUrl + '/v1/messages')
    await result.body!.getReader().read()
    const running = JSON.parse(await readFile(path, 'utf8')).requests[0]
    expect(running.outcome).toBe('running')
    await proxy.close()
    const stopped = JSON.parse(await readFile(path, 'utf8')).requests[0]
    expect(stopped).toMatchObject({ outcome: 'cancelled', error: 'cancelled', usageCompleteness: 'partial', abortSource: 'observer_close' })
    expect(stopped.endedAt).toBeGreaterThanOrEqual(stopped.startedAt)
  })
})

test('failure before response headers still has a persisted end and unknown usage', async () => {
  const unused = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({}) })
  const endpoint = `http://127.0.0.1:${unused.port}`; unused.stop(true)
  const root = await mkdtemp(join(tmpdir(), 'bgs-usage-transport-')), path = join(root, 'usage.json')
  const proxy = openModelUsageProxy(endpoint, path, () => 'fixture')
  try {
    expect((await fetch(proxy.baseUrl + '/v1/messages')).status).toBe(502)
    const row = JSON.parse(await readFile(path, 'utf8')).requests[0]
    expect(row).toMatchObject({ outcome: 'failed', error: 'transport', usageCompleteness: 'missing',
      phase: 'headers', errorOrigin: 'upstream_transport', category: 'connection_refused' })
    expect(row.endedAt).toBeGreaterThanOrEqual(row.startedAt)
  } finally { await proxy.close(); await rm(root, { recursive: true, force: true }) }
})

test('a started request stopped before headers still has a record, rather than disappearing', async () => {
  let entered!: () => void, release!: (response: Response) => void
  const called = new Promise<void>(resolve => { entered = resolve })
  const delayed = new Promise<Response>(resolve => { release = resolve })
  await fixture(() => { entered(); return delayed }, async (proxy, path) => {
    const waiting = fetch(proxy.baseUrl + '/v1/messages').then(() => true, () => false)
    await called
    expect(JSON.parse(await readFile(path, 'utf8')).requests[0].outcome).toBe('running')
    await proxy.close()
    release(Response.json({}))
    await waiting
    const report = JSON.parse(await readFile(path, 'utf8'))
    expect(report.requests[0]).toMatchObject({ id: 1, outcome: 'cancelled', usageCompleteness: 'missing', abortSource: 'observer_close' })
    expect(report.requests[0].elapsedSeconds).toBeGreaterThanOrEqual(0)
    expect(report.totals).toMatchObject({ startedRequests: 1, missingUsageRequestIds: [1], runningRequestIds: [], usageComplete: false })
  })
})

test('concurrent stream and fallback requests retain exact ownership; observer headers never reach upstream', async () => {
  await fixture(async request => {
    expect([...request.headers.keys()].some(key => key.startsWith('x-bgs-observer-'))).toBe(false)
    const body = JSON.parse(await request.text())
    if (body.stream) return new Response(start + end, { headers: { 'content-type': 'text/event-stream' } })
    return Response.json({ usage: { input_tokens: 5, output_tokens: 7 } })
  }, async (proxy, path) => {
    await Promise.all([
      fetch(proxy.baseUrl + '/v1/messages', { method: 'POST', body: JSON.stringify({ stream: true }), headers: {
        'x-bgs-observer-request': '11', 'x-bgs-observer-actor': 'a11111111', 'x-bgs-observer-mode': 'streaming',
      } }).then(r => r.text()),
      fetch(proxy.baseUrl + '/v1/messages', { method: 'POST', body: JSON.stringify({ stream: false }), headers: {
        'x-bgs-observer-request': '13', 'x-bgs-observer-origin': '12', 'x-bgs-observer-actor': 'a22222222',
        'x-bgs-observer-mode': 'non_streaming_fallback', 'x-bgs-observer-attempt': '2',
      } }).then(r => r.text()),
      fetch(proxy.baseUrl + '/auth-probe', { method: 'POST', body: '{}' }).then(r => r.text()),
    ])
    const { requests, totals } = JSON.parse(await readFile(path, 'utf8'))
    expect(requests.find((r: any) => r.request === 11)).toMatchObject({ actor: 'a11111111', mode: 'streaming', usageCompleteness: 'final' })
    expect(requests.find((r: any) => r.request === 13)).toMatchObject({ actor: 'a22222222', originRequest: 12, mode: 'non_streaming_fallback', attempt: 2 })
    expect(totals).toMatchObject({ startedRequests: 3, startedModelRequests: 2 })
  })
})

test('headers failure retains safe cause code and marks synthetic 502 without leaking details', async () => {
  await fixture(() => Response.json({}), async (proxy, path) => {
    const response = await fetch(proxy.baseUrl + '/v1/messages')
    expect(response.status).toBe(502)
    expect(nativeErrorMetadata({ status: response.status, headers: response.headers })).toEqual({ category: 'dns', errorOrigin: 'observer' })
    const raw = await readFile(path, 'utf8')
    expect(JSON.parse(raw).requests[0]).toMatchObject({ phase: 'headers', category: 'dns', errorCode: 'ENOTFOUND', errorOrigin: 'upstream_transport' })
    expect(raw).not.toContain('PRIVATE')
  }, { fetch: async () => { throw new Error('PRIVATE_ENDPOINT', { cause: Object.assign(new Error('PRIVATE_TOKEN'), { code: 'ENOTFOUND' }) }) } })
})

test('body interruption keeps partial usage, byte timestamps and actual cause without replay', async () => {
  let calls = 0
  await fixture(() => Response.json({}), async (proxy, path) => {
    const response = await fetch(proxy.baseUrl + '/v1/messages')
    expect(response.status).toBe(200)
    const stream = Stream.fromSSEResponse(response, new AbortController())
    await expect((async () => { for await (const _part of stream) { /* Consume native SSE events. */ } })()).rejects.toThrow('Observer upstream stream interrupted')
    const raw = await readFile(path, 'utf8'), row = JSON.parse(raw).requests[0]
    expect(row).toMatchObject({ outcome: 'failed', phase: 'body', usageCompleteness: 'partial',
      category: 'connection', errorCode: 'ECONNRESET', errorOrigin: 'upstream_transport' })
    expect(row.bytesReceived).toBe(new TextEncoder().encode(start).length)
    expect(row.lastByteAt).toBeGreaterThanOrEqual(row.headersAt)
    expect(raw).not.toContain('PRIVATE')
    expect(calls).toBe(1)
  }, { fetch: async () => { calls++; return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(start)) },
    async pull(c) { await Bun.sleep(10); c.error(new Error('PRIVATE_DETAIL', { cause: Object.assign(new Error('PRIVATE_ENDPOINT'), { code: 'ECONNRESET' }) })) },
  }), { headers: { 'content-type': 'text/event-stream' } }) } })
})

test('upstream timeouts are observed, not caused by a proxy deadline or automatically retried', async () => {
  let calls = 0
  await fixture(() => Response.json({}), async (proxy, path) => {
    expect((await fetch(proxy.baseUrl + '/v1/messages')).status).toBe(502)
    expect(JSON.parse(await readFile(path, 'utf8')).requests[0]).toMatchObject({
      outcome: 'failed', error: 'timeout', category: 'timeout', phase: 'headers',
    })
    expect(JSON.parse(await readFile(path, 'utf8')).requests[0].abortSource).toBeUndefined()
    expect(calls).toBe(1)
  }, { fetch: async (_url, init) => {
    calls++
    expect(init.signal!.aborted).toBe(false)
    throw new DOMException('Synthetic upstream timeout', 'TimeoutError')
  } })
})

test('client abort reaches the upstream and is not labelled proxy deadline or observer close', async () => {
  let entered!: () => void, aborted!: () => void
  const called = new Promise<void>(resolve => { entered = resolve })
  const upstreamAborted = new Promise<void>(resolve => { aborted = resolve })
  await fixture(() => Response.json({}), async (proxy, path) => {
    const controller = new AbortController()
    const request = fetch(proxy.baseUrl + '/v1/messages', { signal: controller.signal }).catch(() => undefined)
    await called
    controller.abort()
    await request
    await Promise.race([upstreamAborted, Bun.sleep(1000).then(() => { throw Error('Client cancellation did not reach upstream') })])
    // Flush the observer's existing queue; the client cancellation has already settled this request.
    await proxy.close()
    expect(JSON.parse(await readFile(path, 'utf8')).requests[0]).toMatchObject({
      outcome: 'cancelled', error: 'cancelled', abortSource: 'client', phase: 'headers',
    })
  }, { fetch: async (_url, init) => {
    entered()
    return new Promise((_resolve, reject) => { init.signal!.addEventListener('abort', () => { aborted(); reject(init.signal!.reason) }, { once: true }) })
  } })
})
