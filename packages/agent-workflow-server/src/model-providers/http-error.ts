// Error messages can echo prompts, credentials and URLs. Retain only known
// protocol identifiers; unfamiliar values stay omitted rather than being logged.
const types = new Set(['invalid_request_error', 'authentication_error', 'permission_error',
  'not_found_error', 'rate_limit_error', 'api_error', 'overloaded_error',
  'INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND',
  'RESOURCE_EXHAUSTED', 'INTERNAL', 'UNAVAILABLE'])
const codes = new Set(['unsupported_value', 'unsupported_parameter', 'invalid_value',
  'invalid_parameter', 'invalid_request_error', 'invalid_api_key', 'model_not_found',
  'context_length_exceeded', 'rate_limit_exceeded', 'insufficient_quota', 'server_error'])
const params = new Set(['response_format', 'response_format.type', 'response_format.json_schema',
  'response_format.json_schema.schema', 'response_format.json_schema.strict',
  'tool_choice', 'tools', 'messages', 'model', 'max_tokens', 'max_completion_tokens',
  'temperature', 'stream', 'stream_options', 'thinking', 'reasoning_effort',
  'output_config', 'output_config.format', 'generationConfig.responseSchema',
  'generationConfig.responseJsonSchema'])

type ProviderErrorIdentifiers = { type?: string; code?: string; param?: string }

export class ProviderHttpError extends Error {
  constructor(readonly status: number, readonly identifiers: Readonly<ProviderErrorIdentifiers>) {
    const details = Object.entries(identifiers).map(([key, value]) => `${key}=${value}`)
    super(`The selected model provider request failed (HTTP ${status}${details.length ? '; ' + details.join('; ') : ''})`)
    this.name = 'ProviderHttpError'
  }
}

/** Read a small error envelope once; never retain its raw contents or retry. */
export async function providerHttpError(response: Response, signal: AbortSignal): Promise<ProviderHttpError> {
  const identifiers: ProviderErrorIdentifiers = {}, reader = response.body?.getReader()
  if (!reader) return new ProviderHttpError(response.status, identifiers)
  // Error diagnostics must not hold up reporting a failed request indefinitely.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(2000)])
  const cancel = () => { void reader.cancel().catch(() => {}) }
  deadline.addEventListener('abort', cancel, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      deadline.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 16 * 1024) return new ProviderHttpError(response.status, identifiers)
      chunks.push(chunk.value)
    }
    deadline.throwIfAborted()
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const error = body?.error
    if (error && typeof error === 'object') {
      const type = error.type ?? error.status
      if (types.has(type)) identifiers.type = type
      if (codes.has(error.code)) identifiers.code = error.code
      if (params.has(error.param)) identifiers.param = error.param
    }
  } catch { /* Missing, malformed or interrupted diagnostics still retain HTTP status. */ }
  finally {
    deadline.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return new ProviderHttpError(response.status, identifiers)
}
