import type { ProviderConfig } from './config'
import { nativeRequest } from './requests'
import { responseEvents, type ProviderUsage } from './response-stream'
import { UnknownProviderToolError, type Json } from './messages'
import { safeErrorFacts } from '../security/safe-error-facts'

/** One provider call, with no automatic retry or fallback credential. */
export async function requestProvider(
  config: ProviderConfig,
  body: Json,
  request: typeof fetch,
  signal: AbortSignal,
  onUsage?: (usage: ProviderUsage) => void,
): Promise<Response> {
  if (config.protocol === 'responses')
    return request(config.baseUrl + '/responses', {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        Authorization: 'Bearer ' + config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  const native = nativeRequest(config, body)
  const cancellation = new AbortController()
  const upstream = await request(native.url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([signal, cancellation.signal]),
    headers: native.headers,
    body: JSON.stringify(native.body),
  })
  if (!upstream.ok) {
    await upstream.body?.cancel()
    throw Object.assign(
      Error('Model provider request failed (' + upstream.status + ')'),
      { status: upstream.status },
    )
  }
  const events = responseEvents(
    { ...config, model: body.model ?? config.model },
    upstream,
    native.tools,
    onUsage,
  )
  if (!body.stream) {
    let result: Json | undefined
    for await (const event of events)
      if (
        event.type === 'response.completed' ||
        event.type === 'response.incomplete'
      )
        result = event.response
    if (!result) throw Error('Provider response was incomplete')
    return Response.json(result)
  }
  const encoder = new TextEncoder()
  let sequence = 0
  let response: Json = {}
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next()
        if (next.done) {
          controller.close()
          return
        }
        const event: Json = { ...next.value, sequence_number: sequence++ }
        if (event.type === 'response.created') response = event.response
        controller.enqueue(
          encoder.encode(
            'event: ' +
              event.type +
              '\ndata: ' +
              JSON.stringify(event) +
              '\n\n',
          ),
        )
      } catch (error) {
        // Bgs ignores ordinary `error` events except for a few special API
        // codes. A failed Response preserves the failure instead of reducing
        // every adapter error to "stream closed before response.completed".
        controller.enqueue(
          encoder.encode(
            'event: response.failed\ndata: ' +
              JSON.stringify({
                type: 'response.failed',
                sequence_number: sequence++,
                response: { ...response, status: 'failed', error: {
                  code: 'provider_stream_failed',
                  message: safeStreamFailure(error),
                } },
              }) +
              '\n\n',
          ),
        )
        controller.close()
      }
    },
    async cancel() {
      cancellation.abort()
      await events.return(undefined)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
    },
  })
}

function safeStreamFailure(error: unknown): string {
  if (error instanceof UnknownProviderToolError) return error.message
  const { networkCode } = safeErrorFacts(error)
  if (networkCode) return `The provider transport failed (${networkCode})`
  // Only adapter-owned fixed messages may cross into native logs. Upstream
  // exception messages/bodies can contain credentials or private requests.
  const known = [
    'Provider returned no response stream',
    'Provider returned an invalid JSON event',
    'Provider response event exceeds the size limit',
    'Provider stream ended inside an event',
    'Model provider reported a stream error',
    'Provider stream ended without a terminal event',
    'Provider did not report final token usage',
    'Provider reported invalid token usage',
    'Provider returned an unknown tool name',
    'Custom tool arguments must contain input text',
  ]
  if (error instanceof Error && known.includes(error.message)) return error.message
  if (error instanceof SyntaxError) return 'Provider returned invalid tool arguments'
  return 'The provider response failed or was incomplete'
}
