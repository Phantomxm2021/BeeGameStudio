// Error messages can echo prompts, credentials and URLs. Only known protocol
// identifiers and fixed reason labels may leave this boundary, never raw text.
const types = new Set(['invalid_request_error', 'authentication_error', 'permission_error',
  'not_found_error', 'rate_limit_error', 'api_error', 'overloaded_error', 'server_error',
  'insufficient_quota', 'GoUsageLimitError', 'FreeUsageLimitError', 'MissingSessionID',
  'INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND',
  'RESOURCE_EXHAUSTED', 'INTERNAL', 'UNAVAILABLE'])
const codes = new Set(['unsupported_value', 'unsupported_parameter', 'invalid_value',
  'invalid_parameter', 'invalid_request_error', 'invalid_api_key', 'model_not_found',
  'context_length_exceeded', 'rate_limit_exceeded', 'insufficient_quota', 'server_error',
  'inference_failed'])
const params = new Set(['response_format', 'response_format.type', 'response_format.json_schema',
  'response_format.json_schema.schema', 'response_format.json_schema.strict',
  'tool_choice', 'tools', 'messages', 'model', 'max_tokens', 'max_completion_tokens',
  'temperature', 'stream', 'stream_options', 'thinking', 'reasoning_effort',
  'output_config', 'output_config.format', 'generationConfig.responseSchema',
  'generationConfig.responseJsonSchema'])

type ProviderErrorIdentifiers = { type?: string; code?: string; param?: string }
type BodyStatus = 'pending' | 'parsed' | 'empty' | 'invalid' | 'too-large' | 'incomplete'
export type ProviderHttpErrorDiagnostics = ProviderErrorIdentifiers & {
  bodyStatus: BodyStatus
  requestId?: string
  retryAfter?: number | string
  rateLimits?: Record<string, number | string>
  messageCode?: string
  messageReason?: string
}

function requestId(value: unknown): string | undefined {
  if (typeof value === 'string' && /^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|req_[a-zA-Z0-9]{8,64})$/.test(value)) return value
}
function secondsOrDate(value: string): number | string | undefined {
  if (/^\d{1,10}$/.test(value)) return Number(value)
  const time = Date.parse(value)
  // Date.parse alone accepts arbitrary text; only accept canonical HTTP dates.
  if (Number.isFinite(time) && new Date(time).toUTCString() === value) return value
}

/** Bounded observer shared by converted errors and byte-transparent Responses. */
export function observeProviderHttpError(response: Response) {
  const details: ProviderHttpErrorDiagnostics = { bodyStatus: 'pending' }
  details.requestId = requestId(response.headers.get('x-request-id')) ?? requestId(response.headers.get('request-id'))
    ?? requestId(response.headers.get('x-opencode-log-id'))
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter !== null) details.retryAfter = secondsOrDate(retryAfter)
  for (const resource of ['requests', 'tokens']) {
    for (const kind of ['limit', 'remaining', 'reset']) {
      const name = `x-ratelimit-${kind}-${resource}`, value = response.headers.get(name)
      if (value === null) continue
      const safe = kind === 'reset'
        ? secondsOrDate(value) ?? (value.length <= 40 && /^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(value) ? value : undefined)
        : /^\d{1,15}$/.test(value) ? Number(value) : undefined
      if (safe !== undefined) (details.rateLimits ??= {})[name] = safe
    }
  }
  const chunks: Uint8Array[] = []
  let size = 0
  return {
    details,
    append(chunk: Uint8Array) {
      if (details.bodyStatus !== 'pending') return
      size += chunk.byteLength
      if (size > 16 * 1024) {
        details.bodyStatus = 'too-large'
        chunks.length = 0
      } else chunks.push(chunk.slice())
    },
    finish(complete: boolean) {
      if (details.bodyStatus !== 'pending') return
      details.bodyStatus = complete ? size ? 'invalid' : 'empty' : 'incomplete'
      try {
        if (!complete || !size) return
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        // OpenAI/Anthropic/Gemini use error; OpenCode also sends top-level envelopes.
        const error = body?.error ?? body
        if (!error || typeof error !== 'object' || Array.isArray(error)) return
        details.bodyStatus = 'parsed'
        const type = error.type ?? error.status
        if (types.has(type)) details.type = type
        if (codes.has(error.code)) details.code = error.code
        if (params.has(error.param)) details.param = error.param
        details.requestId ??= requestId(body.request_id) ?? requestId(error.request_id)
        if (typeof error.message === 'string') {
          const message = error.message.replace(/^Error from provider \(Console(?: Go)?\): /, '')
            .replace(/^Upstream request failed: /, '')
          const marker = /^\[([a-z_]+)\] /.exec(message)
          if (marker && codes.has(marker[1]!)) details.messageCode = marker[1]
          const reason = message.replace(/^\[[a-z_]+\] /, '')
          // Evidence labels only, not an automatic retry decision or account diagnosis.
          for (const [prefix, label] of [
            ['Monthly usage limit reached.', 'monthly_usage_limit'],
            ['Weekly usage limit reached.', 'weekly_usage_limit'],
            ['5-hour usage limit reached.', 'rolling_usage_limit'],
            ['Go usage limit exceeded.', 'go_usage_limit'],
            ['Rate limit exceeded.', 'rate_limit'],
            ['Output token rate limit exceeded.', 'output_token_rate_limit'],
            ['Input token rate limit exceeded.', 'input_token_rate_limit'],
            ['Endpoint is unavailable.', 'endpoint_unavailable'],
          ] as const) {
            if (reason.startsWith(prefix)) { details.messageReason = label; break }
          }
        }
      } catch { /* Invalid external JSON: retain headers and bodyStatus, never raw data. */ }
      finally { chunks.length = 0 }
    },
  }
}

export class ProviderHttpError extends Error {
  constructor(readonly status: number, readonly identifiers: Readonly<ProviderErrorIdentifiers>,
    readonly diagnostics: Readonly<ProviderHttpErrorDiagnostics>) {
    const details = Object.entries(identifiers).map(([key, value]) => `${key}=${value}`)
    super(`The selected model provider request failed (HTTP ${status}${details.length ? '; ' + details.join('; ') : ''})`)
    this.name = 'ProviderHttpError'
  }
}

/** Read a small error envelope once; never retain its raw contents or retry. */
export async function providerHttpError(response: Response, signal: AbortSignal): Promise<ProviderHttpError> {
  const observer = observeProviderHttpError(response), reader = response.body?.getReader()
  // Error diagnostics must not hold up reporting a failed request indefinitely.
  if (reader) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(2000)])
    const cancel = () => { void reader.cancel().catch(() => {}) }
    deadline.addEventListener('abort', cancel, { once: true })
    try {
      while (true) {
        deadline.throwIfAborted()
        const chunk = await reader.read()
        deadline.throwIfAborted()
        if (chunk.done) { observer.finish(true); break }
        observer.append(chunk.value)
        if (observer.details.bodyStatus === 'too-large') break
      }
    } catch { /* An interrupted error body must not replace its HTTP failure. */ }
    finally {
      deadline.removeEventListener('abort', cancel)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
      observer.finish(false)
    }
  } else observer.finish(true)
  const identifiers: ProviderErrorIdentifiers = {}
  for (const key of ['type', 'code', 'param'] as const)
    if (observer.details[key] !== undefined) identifiers[key] = observer.details[key]
  return new ProviderHttpError(response.status, identifiers, observer.details)
}
