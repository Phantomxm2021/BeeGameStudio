import type { ProviderConfig } from './config'
import { nativeRequest, openCodeGoHeaders } from './requests'
import { responseEvents, nativeResponses, type ProviderUsage, type ProviderToolErrorHandler } from './response-stream'
import { UnknownProviderToolError, normalizeNativeFunctionHistory, type Json } from './messages'
import { safeErrorFacts } from '../security/safe-error-facts'
import { providerHttpError } from './http-error'

/** One provider call, with no automatic retry or fallback credential. */
export async function requestProvider(
  config: ProviderConfig,
  body: Json,
  request: typeof fetch,
  signal: AbortSignal,
  onUsage?: (usage: ProviderUsage) => void,
  onToolError?: ProviderToolErrorHandler,
  outputBudget?: (fallback: unknown) => Promise<number | undefined>,
): Promise<Response> {
  body = normalizeNativeFunctionHistory(body)
  if (config.protocol === 'responses')
    return nativeResponses(await request(config.baseUrl + '/responses', {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        Authorization: 'Bearer ' + config.apiKey,
        'Content-Type': 'application/json',
        ...openCodeGoHeaders(config),
      },
      body: JSON.stringify(body),
    }), body, onUsage)
  const native = nativeRequest(config, body)
  // Convert/validate first: a rejected local tool request must not cause any
  // provider I/O. Budget filling changes only the protocol's token control.
  if ('generationConfig' in native.body) {
    const tokens = await outputBudget?.(native.body.generationConfig.maxOutputTokens)
    if (tokens !== undefined) native.body.generationConfig.maxOutputTokens = tokens
  } else {
    const tokens = await outputBudget?.(native.body.max_tokens)
    if (tokens !== undefined) native.body.max_tokens = tokens
  }
  const cancellation = new AbortController()
  const upstream = await request(native.url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.any([signal, cancellation.signal]),
    headers: native.headers,
    body: JSON.stringify(native.body),
  })
  if (!upstream.ok) throw await providerHttpError(upstream, signal)
  const events = responseEvents(
    { ...config, model: body.model ?? config.model },
    upstream,
    native.tools,
    onUsage,
    onToolError,
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
    return Response.json(result, { headers: { 'x-reasoning-included': 'true' } })
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
      // Converted providers count replayed assistant history in prompt usage.
      // Its opaque native carrier is not additional hidden context to estimate.
      'x-reasoning-included': 'true',
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
    'Provider reported invalid token usage',
    'Provider returned an unknown tool name',
    'Custom tool arguments must contain input text',
  ]
  if (error instanceof Error && known.includes(error.message)) return error.message
  if (error instanceof SyntaxError) return 'Provider returned invalid tool arguments'
  return 'The provider response failed or was incomplete'
}
