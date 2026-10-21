import { expect, test } from 'bun:test'
import { modelRuntimeFetch } from './model-runtime-transport'
import { parseSse } from '../model-providers/response-stream'
import { Agent } from 'undici/index.js'
import { safeErrorFacts } from '../security/safe-error-facts'

test('header timeout preserves its network code and logs no private request data', async () => {
  const diagnostics: unknown[][] = [], warn = console.warn
  const dispatcher = new Agent({ headersTimeout: 50 })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0,
    fetch: () => new Promise<Response>(() => {}) })
  console.warn = (...args) => { diagnostics.push(args) }
  try {
    let failure: unknown
    try { await modelRuntimeFetch(server.url, { headers: { Authorization: 'Bearer synthetic-private-secret' },
      dispatcher, signal: AbortSignal.timeout(3000) } as RequestInit) } catch (error) { failure = error }
    expect(safeErrorFacts(failure)).toEqual({ networkCode: 'UND_ERR_HEADERS_TIMEOUT' })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.[1]).toMatchObject({ event: 'response-headers-failed', networkCode: 'UND_ERR_HEADERS_TIMEOUT' })
    expect(JSON.stringify(diagnostics).includes('synthetic-private-secret')).toBe(false)
  } finally { console.warn = warn; server.stop(true); await dispatcher.destroy() }
}, 5000)

test('body timeout retains its code after headers without leaking the upstream message', async () => {
  const diagnostics: unknown[][] = [], warn = console.warn
  const dispatcher = new Agent({ bodyTimeout: 50 })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () =>
    new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(': waiting\n\n'))
    } })) })
  console.warn = (...args) => { diagnostics.push(args) }
  try {
    const response = await modelRuntimeFetch(server.url, {
      dispatcher, signal: AbortSignal.timeout(3000) } as RequestInit)
    const reader = response.body!.getReader()
    await reader.read()
    let failure: unknown
    try { await reader.read() } catch (error) { failure = error }
    expect(safeErrorFacts(failure)).toEqual({ networkCode: 'UND_ERR_BODY_TIMEOUT' })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.[1]).toMatchObject({ event: 'response-body-failed', networkCode: 'UND_ERR_BODY_TIMEOUT' })
  } finally { console.warn = warn; server.stop(true); await dispatcher.destroy() }
}, 5000)

test('live SSE delivers frames before EOF and DONE cancels the socket, including gzip', async () => {
  const diagnostics: unknown[][] = [], warn = console.warn
  console.warn = (...args) => { diagnostics.push(args) }
  try {
    for (const compressed of [false, true]) {
      let cancelled!: () => void
      const cancellation = new Promise<void>(resolve => { cancelled = resolve })
      const text = 'data: {"fixture":"delivered"}\n\ndata: [DONE]\n\n'
      const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(compressed ? Bun.gzipSync(text) : new TextEncoder().encode(text)) },
          cancel() { cancelled() },
        }), { headers: { 'content-type': 'text/event-stream', ...(compressed ? { 'content-encoding': 'gzip' } : {}) } })
      } })
      try {
        const response = await modelRuntimeFetch(server.url, { signal: AbortSignal.timeout(2000) })
        const events = []
        for await (const event of parseSse(response)) events.push(event)
        expect(events).toEqual([{ fixture: 'delivered' }])
        await cancellation
      } finally { server.stop(true) }
    }
    expect(diagnostics).toEqual([])
  } finally { console.warn = warn }
}, 5000)

test('aborting a live stream rejects its pending read', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(': waiting\n\n')) } }))
  } })
  const abort = new AbortController()
  try {
    const response = await modelRuntimeFetch(server.url, { signal: abort.signal })
    const reader = response.body!.getReader()
    await reader.read()
    const pending = reader.read()
    abort.abort()
    await expect(pending).rejects.toThrow()
  } finally { server.stop(true) }
}, 3000)
