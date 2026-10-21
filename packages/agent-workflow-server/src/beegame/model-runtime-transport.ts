import { getGlobalDispatcher, interceptors, request, type Dispatcher } from 'undici/index.js'
import { Readable } from 'node:stream'
import { safeErrorFacts } from '../security/safe-error-facts'

type ModelRequestInit = RequestInit & Pick<Dispatcher.RequestOptions, 'headersTimeout' | 'bodyTimeout'>
// Provider-bridge policy: first response may include queueing/prefill. Allow ten
// minutes; once streaming, retain the existing five-minute inactivity limit.
// Both remain interruptible by the caller's signal; neither retries a request.
export const MODEL_RESPONSE_TIMEOUTS = { headersTimeout: 600_000, bodyTimeout: 300_000 } as const

// Undici fetch's Web-stream adapter stalls on live SSE under Bun. Its Node
// request stream delivers chunks correctly; keep the same pinned dispatcher.
export const modelRuntimeFetch = (async (input: RequestInfo | URL, init: ModelRequestInit = {}) => {
  const source = input instanceof Request ? input : undefined
  const headers = new Headers(init.headers ?? source?.headers)
  const dispatcher = (init as RequestInit & { dispatcher?: Dispatcher }).dispatcher ?? getGlobalDispatcher()
  const started = performance.now()
  const response = await request(source?.url ?? input as string | URL, {
    method: (init.method ?? source?.method ?? 'GET') as Dispatcher.HttpMethod,
    headers: Object.fromEntries(headers),
    body: (init.body ?? (source?.body ? Readable.fromWeb(source.body as never) : undefined)) as Dispatcher.RequestOptions['body'],
    signal: init.signal ?? source?.signal,
    // Other callers (including MCP) retain their dispatcher policy.
    headersTimeout: init.headersTimeout,
    bodyTimeout: init.bodyTimeout,
    dispatcher: dispatcher.compose(interceptors.decompress({ skipErrorResponses: false })),
  }).catch(error => {
    if (!(init.signal ?? source?.signal)?.aborted)
      console.warn('[model-transport]', { event: 'response-headers-failed',
        elapsedMs: Math.round(performance.now() - started), ...safeErrorFacts(error) })
    throw error
  })
  if (response.statusCode >= 300 && response.statusCode < 400 && init.redirect === 'error') {
    response.body.destroy()
    throw Error('Model provider redirect is not permitted')
  }
  const responseHeaders = new Headers()
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) for (const entry of value) responseHeaders.append(name, entry)
    else if (value !== undefined) responseHeaders.set(name, value)
  }
  if (['HEAD'].includes(init.method ?? source?.method ?? 'GET') || [204, 205, 304].includes(response.statusCode)) {
    await response.body.dump()
    return new Response(null, { status: response.statusCode, headers: responseHeaders })
  }
  const iterator = response.body[Symbol.asyncIterator]()
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await iterator.next()
        if (chunk.done) controller.close()
        else controller.enqueue(chunk.value)
      } catch (error) {
        if (!cancelled && !(init.signal ?? source?.signal)?.aborted)
          console.warn('[model-transport]', { event: 'response-body-failed',
            elapsedMs: Math.round(performance.now() - started), ...safeErrorFacts(error) })
        controller.error(error)
      }
    },
    cancel() { cancelled = true; response.body.destroy() },
  })
  return new Response(body, { status: response.statusCode, headers: responseHeaders })
}) as typeof fetch
