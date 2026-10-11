/** Metadata-only wire protocol. Never transport prompts, URLs, headers or raw errors. */
export const NATIVE_DIAGNOSTIC_PREFIX = 'BEEGAME_NATIVE_DIAGNOSTIC '
const events = ['cli_entry', 'cli_ready', 'client_start', 'client_ready', 'request_start',
  'response_headers', 'first_stream_event', 'stream_end', 'stream_error', 'request_end', 'api_error', 'retry_wait',
  'process_spawn', 'stdin_sent', 'stdout_first', 'model_first', 'usage_first',
  'stop_requested', 'process_exit', 'turn_accepted', 'turn_failed', 'stderr_summary', 'diagnostic_invalid', 'evidence_incomplete'] as const
const categories = ['timeout', 'connection_refused', 'dns', 'tls', 'connection', 'authentication',
  'rate_limit', 'server', 'aborted', 'other'] as const
const errorCodes = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'] as const
export type NativeDiagnostic = { event: typeof events[number]; category?: typeof categories[number];
  source?: 'compact' | 'main' | 'other'; evidenceSource?: 'cli_debug';
  request?: number; originRequest?: number; attempt?: number; status?: number; delayMs?: number; bytes?: number;
  actor?: string; mode?: 'streaming' | 'non_streaming_fallback'; phase?: 'headers' | 'body' | 'query';
  outcome?: 'completed' | 'failed' | 'cancelled'; recovered?: boolean;
  thinkingPolicy?: 'enabled' | 'adaptive' | 'disabled'; thinkingParameter?: 'default' | 'enabled' | 'adaptive' | 'disabled';
  thinkingReturned?: boolean;
  /** Native process cumulative accounting, not an actor's context length. */
  cumulativeInputTokens?: number; cumulativeOutputTokens?: number;
  cumulativeCacheReadTokens?: number; cumulativeCacheCreationTokens?: number;
  errorCode?: typeof errorCodes[number]; errorOrigin?: 'observer';
  lines?: number; pid?: number; exitCode?: number; signal?: 'SIGTERM' | 'SIGKILL' | 'other' }
const numeric = ['request', 'originRequest', 'attempt', 'status', 'delayMs', 'bytes', 'lines', 'pid', 'exitCode',
  'cumulativeInputTokens', 'cumulativeOutputTokens', 'cumulativeCacheReadTokens', 'cumulativeCacheCreationTokens'] as const

/** Rebuild from an allowlist, including when input came from the child process. */
export function parseNativeDiagnostic(value: unknown): NativeDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const record = value as Record<string, unknown>
  if (!(events as readonly unknown[]).includes(record.event)) return
  const result: NativeDiagnostic = { event: record.event as NativeDiagnostic['event'] }
  for (const key of numeric) {
    const value = record[key]
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || (key !== 'exitCode' && value < 0)) return
      result[key] = value
    }
  }
  if (record.category !== undefined) {
    if (!(categories as readonly unknown[]).includes(record.category)) return
    result.category = record.category as NativeDiagnostic['category']
  }
  if (record.signal !== undefined) {
    if (!['SIGTERM', 'SIGKILL', 'other'].includes(record.signal as string)) return
    result.signal = record.signal as NativeDiagnostic['signal']
  }
  // Only opaque runtime IDs, not user-chosen agent/team names.
  if (typeof record.actor === 'string' && /^(main|a[0-9a-f]{6,32}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.test(record.actor)) result.actor = record.actor
  const enums = { mode: ['streaming', 'non_streaming_fallback'], phase: ['headers', 'body', 'query'],
    source: ['compact', 'main', 'other'], evidenceSource: ['cli_debug'],
    outcome: ['completed', 'failed', 'cancelled'], errorCode: errorCodes, errorOrigin: ['observer'],
    thinkingPolicy: ['enabled', 'adaptive', 'disabled'], thinkingParameter: ['default', 'enabled', 'adaptive', 'disabled'] } as const
  for (const key of Object.keys(enums) as (keyof typeof enums)[]) {
    if ((enums[key] as readonly unknown[]).includes(record[key])) Object.assign(result, { [key]: record[key] })
  }
  if (typeof record.recovered === 'boolean') result.recovered = record.recovered
  if (typeof record.thinkingReturned === 'boolean') result.thinkingReturned = record.thinkingReturned
  return result
}

/** Classify in memory; never return or persist any source text. */
export function nativeErrorCategory(error: unknown): NonNullable<NativeDiagnostic['category']> {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const status = record.status
  const headers = record.headers
  const observed = headers instanceof Headers ? headers.get('x-bgs-observer-error-category') : null
  if ((categories as readonly unknown[]).includes(observed)) return observed as NonNullable<NativeDiagnostic['category']>
  if (status === 401 || status === 403) return 'authentication'
  if (status === 429) return 'rate_limit'
  if (typeof status === 'number' && status >= 500) return 'server'
  // SDK/fetch commonly wraps the useful network code in cause. Bounded walk also handles cycles.
  const details: unknown[] = []
  let current: unknown = error
  for (let i = 0; i < 4 && current; i++) {
    const value = typeof current === 'object' ? current as Record<string, unknown> : {}
    details.push(typeof current === 'string' ? current : value.name, value.code, value.message)
    current = value.cause
  }
  const text = details.filter(v => typeof v === 'string').join(' ')
  if (/abort/i.test(text)) return 'aborted'
  if (/timed?\s*out|timeout|ETIMEDOUT/i.test(text)) return 'timeout'
  if (/ECONNREFUSED|connectionrefused|connection refused/i.test(text)) return 'connection_refused'
  if (/ENOTFOUND|EAI_AGAIN|\bdns\b/i.test(text)) return 'dns'
  if (/certificate|\btls\b|\bssl\b|CERT_|ERR_TLS_|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(text)) return 'tls'
  if (/ECONNRESET|EPIPE|connection|fetch failed/i.test(text)) return 'connection'
  return 'other'
}

export function nativeErrorMetadata(error: unknown): Pick<NativeDiagnostic, 'category' | 'errorCode' | 'errorOrigin'> {
  const result: Pick<NativeDiagnostic, 'category' | 'errorCode' | 'errorOrigin'> = { category: nativeErrorCategory(error) }
  let current: unknown = error
  for (let i = 0; i < 4 && current && typeof current === 'object'; i++) {
    const value = current as Record<string, unknown>
    if ((errorCodes as readonly unknown[]).includes(value.code)) { result.errorCode = value.code as typeof errorCodes[number]; break }
    current = value.cause
  }
  const headers = error && typeof error === 'object' ? (error as { headers?: unknown }).headers : undefined
  if (headers instanceof Headers && headers.has('x-bgs-observer-error-category')) result.errorOrigin = 'observer'
  return result
}

const observerHeaders = { request: 'x-bgs-observer-request', originRequest: 'x-bgs-observer-origin',
  actor: 'x-bgs-observer-actor', mode: 'x-bgs-observer-mode', attempt: 'x-bgs-observer-attempt' } as const
/** Rebuild safe correlation fields and remove them from the outbound headers. */
export function takeNativeObserverMetadata(headers: Headers): Partial<NativeDiagnostic> {
  const value: Record<string, unknown> = { event: 'request_start' }
  for (const [key, header] of Object.entries(observerHeaders)) {
    const raw = headers.get(header); headers.delete(header)
    if (raw !== null) value[key] = ['request', 'originRequest', 'attempt'].includes(key)
      ? (/^\d+$/.test(raw) ? Number(raw) : -1) : raw
  }
  const { event: _, ...metadata } = parseNativeDiagnostic(value) ?? { event: 'request_start' }
  return metadata
}
