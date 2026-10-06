import { writeFile } from 'node:fs/promises'
import { nativeErrorMetadata, takeNativeObserverMetadata, type NativeDiagnostic } from '@bee-game-studio/agent-workflow/native-diagnostics'

type TokenUsage = Partial<Record<'input_tokens' | 'output_tokens' |
  'cache_read_input_tokens' | 'cache_creation_input_tokens', number>>
export type ModelRequestObservation = Pick<NativeDiagnostic, 'request' | 'originRequest' | 'actor' | 'mode' | 'attempt' | 'category' | 'errorCode'> & {
  id: number; stage: string; startedAt: number; endedAt?: number; elapsedSeconds?: number
  outcome: 'running' | 'completed' | 'failed' | 'cancelled'
  status?: number; usage: TokenUsage; usageCompleteness: 'missing' | 'partial' | 'final'
  error?: 'timeout' | 'transport' | 'provider' | 'cancelled'
  requestKind: 'messages' | 'other'; phase: 'request_body' | 'headers' | 'body'
  headersAt?: number; lastByteAt?: number; bytesReceived?: number
  errorOrigin?: 'observer' | 'upstream_transport' | 'upstream_http'
  abortSource?: 'client' | 'observer_close' | 'proxy_deadline'
}

export function summarizeModelRequests(records: readonly ModelRequestObservation[]) {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  for (const record of records) for (const key of Object.keys(usage) as (keyof typeof usage)[])
    usage[key] += record.usage[key] ?? 0
  return { usage, totalObservedTokens: Object.values(usage).reduce((sum, count) => sum + count, 0),
    startedRequests: records.length,
    startedModelRequests: records.filter(r => r.requestKind === 'messages').length,
    runningRequestIds: records.filter(r => r.outcome === 'running').map(r => r.id),
    partialUsageRequestIds: records.filter(r => r.usageCompleteness === 'partial').map(r => r.id),
    missingUsageRequestIds: records.filter(r => r.usageCompleteness === 'missing').map(r => r.id),
    usageComplete: records.every(r => r.usageCompleteness === 'final'),
    note: 'Observed provider tokens, not settled credits. Missing/partial usage is not zero spend; incomplete totals are lower-bound observations.',
  }
}

/** Cost attribution for the existing test observation, not a billing limit.
 * Only model requests belong to these groups; unknown ownership stays unknown.
 */
export function summarizeModelStageUsage(records: readonly ModelRequestObservation[]) {
  const groups = new Map<string, ModelRequestObservation[]>()
  for (const record of records) {
    if (record.requestKind !== 'messages') continue
    const key = JSON.stringify([record.stage, record.actor ?? null])
    const group = groups.get(key) ?? []
    group.push(record); groups.set(key, group)
  }
  return [...groups.values()].map(group => {
    const contexts = group.flatMap(record => typeof record.usage.input_tokens !== 'number' ? [] : [
      record.usage.input_tokens + (record.usage.cache_read_input_tokens ?? 0) + (record.usage.cache_creation_input_tokens ?? 0),
    ])
    return { stage: group[0]!.stage, actor: group[0]!.actor ?? null,
      firstRequestId: group[0]!.id, lastRequestId: group.at(-1)!.id,
      ...summarizeModelRequests(group),
      finalModelCalls: group.filter(record => record.usageCompleteness === 'final').length,
      firstObservedInputContextTokens: contexts[0] ?? null,
      lastObservedInputContextTokens: contexts.at(-1) ?? null,
      minObservedInputContextTokens: contexts.length ? Math.min(...contexts) : null,
      maxObservedInputContextTokens: contexts.length ? Math.max(...contexts) : null,
    }
  })
}

/** Test-only transparent proxy. Persists metadata, never prompts, headers or stream content.
 * Normal responses are byte-identical; interrupted SSE is explicitly failed rather than clean EOF.
 * Fault/clock overrides are local-test only; the default request deadline remains 600s.
 * This observes provider tokens; it neither submits a debit nor certifies settlement. */
export function openModelUsageProxy(endpoint: string, outputPath: string, stage: () => string,
  options: { fetch?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number } = {}) {
  const records: ModelRequestObservation[] = []
  const pending = new Set<{ abort: AbortController; finish: (outcome: ModelRequestObservation['outcome'], error?: ModelRequestObservation['error']) => Promise<void> }>()
  let closing = false, saved = Promise.resolve()
  const persist = () => {
    const snapshot = JSON.stringify({ basis: 'provider-observation-not-settlement',
      totals: summarizeModelRequests(records), stageUsage: summarizeModelStageUsage(records), requests: records }, null, 2)
    saved = saved.then(() => writeFile(outputPath, snapshot))
    return saved
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, async fetch(request) {
    if (closing) return new Response('Test ended', { status: 503 })
    const url = new URL(request.url), countOnly = url.pathname.endsWith('/count_tokens')
    const headers = new Headers(request.headers)
    const correlation = takeNativeObserverMetadata(headers)
    const record: ModelRequestObservation | undefined = countOnly ? undefined : {
      id: records.length + 1, stage: stage(), startedAt: Date.now(), outcome: 'running',
      usage: {}, usageCompleteness: 'missing',
      ...correlation, requestKind: url.pathname.endsWith('/messages') ? 'messages' : 'other', phase: 'request_body',
    }
    if (record) { records.push(record); await persist() }
    const abort = new AbortController()
    let finalUsage = false, messageStopped = false, finished = false
    const merge = (value: unknown) => {
      if (!record || !value || typeof value !== 'object') return
      for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const) {
        const n = (value as TokenUsage)[key]
        if (typeof n === 'number' && Number.isFinite(n) && n >= 0) record.usage[key] = n
      }
    }
    const finish = async (outcome: ModelRequestObservation['outcome'], error?: ModelRequestObservation['error']) => {
      if (finished) return
      noteAbort()
      finished = true; pending.delete(task)
      if (!record) return
      record.endedAt = Date.now(); record.elapsedSeconds = (record.endedAt - record.startedAt) / 1000
      record.outcome = outcome
      if (error) record.error = error
      const known = typeof record.usage.input_tokens === 'number' && typeof record.usage.output_tokens === 'number'
      record.usageCompleteness = outcome === 'completed' && finalUsage && messageStopped && known
        ? 'final' : Object.keys(record.usage).length ? 'partial' : 'missing'
      await persist()
    }
    const task = { abort, finish }; pending.add(task)
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(options.timeoutMs ?? 600000)])
    const noteAbort = () => {
      if (record && signal.aborted) record.abortSource = abort.signal.aborted
        ? (abort.signal.reason === 'observer_close' ? 'observer_close' : 'client') : 'proxy_deadline'
    }
    const cancel = () => { abort.abort('client'); noteAbort(); void finish('cancelled', 'cancelled') }
    request.signal.addEventListener('abort', cancel, { once: true })
    headers.delete('host'); headers.delete('content-length')
    let upstream: Response
    try {
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
      if (record) record.phase = 'headers'
      upstream = await (options.fetch ?? fetch)(endpoint.replace(/\/$/, '') + url.pathname + url.search, {
        method: request.method, headers, body,
        signal,
      })
    } catch (error) {
      noteAbort()
      const metadata = nativeErrorMetadata(error)
      if (record && !finished) Object.assign(record, metadata, { errorOrigin: record.phase === 'request_body' ? 'observer' : 'upstream_transport' })
      request.signal.removeEventListener('abort', cancel)
      await finish(abort.signal.aborted ? 'cancelled' : 'failed', abort.signal.aborted ? 'cancelled'
        : signal.reason?.name === 'TimeoutError' || error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'transport')
      return Response.json({ error: { type: 'api_error', message: 'Upstream request failed' } },
        { status: 502, headers: { 'x-bgs-observer-error-category': metadata.category ?? 'other' } })
    }
    if (record) { record.status = upstream.status; record.headersAt = Date.now(); record.phase = 'body'
      if (!upstream.ok) { record.errorOrigin = 'upstream_http'; record.category = nativeErrorMetadata({ status: upstream.status }).category } }
    if (!upstream.body) {
      request.signal.removeEventListener('abort', cancel)
      await finish(upstream.ok ? 'completed' : 'failed', upstream.ok ? undefined : 'provider')
      return upstream
    }
    const reader = upstream.body.getReader(), decoder = new TextDecoder()
    const sse = upstream.headers.get('content-type')?.includes('text/event-stream') === true
    let buffer = '', providerError = false
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return
      try {
        const event = JSON.parse(line.slice(5).trim())
        merge(event.message?.usage); merge(event.usage)
        if (event.type === 'message_delta' && typeof event.usage?.output_tokens === 'number') finalUsage = true
        if (event.type === 'message_stop') messageStopped = true
        if (event.type === 'error') { providerError = true; if (record) record.errorOrigin = 'upstream_http' }
      } catch { /* Non-JSON SSE frames carry no measurable usage. Forward unchanged. */ }
    }
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (record && value) { record.lastByteAt = Date.now(); record.bytesReceived = (record.bytesReceived ?? 0) + value.byteLength }
        if (done) {
          buffer += decoder.decode()
          if (sse) consume(buffer.replace(/\r$/, ''))
          else { try { const response = JSON.parse(buffer); merge(response.usage); finalUsage = true; messageStopped = true } catch {} }
          request.signal.removeEventListener('abort', cancel)
          await finish(providerError || !upstream.ok ? 'failed' : 'completed', providerError || !upstream.ok ? 'provider' : undefined)
          controller.close(); return
        }
        buffer += decoder.decode(value, { stream: true })
        if (sse) {
          let end: number
          while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end).replace(/\r$/, '')); buffer = buffer.slice(end + 1) }
        }
        controller.enqueue(value)
      } catch (error) {
        request.signal.removeEventListener('abort', cancel)
        noteAbort()
        if (record && !finished) Object.assign(record, nativeErrorMetadata(error), { errorOrigin: 'upstream_transport' })
        await finish(abort.signal.aborted ? 'cancelled' : 'failed', abort.signal.aborted ? 'cancelled'
          : signal.reason?.name === 'TimeoutError' ? 'timeout' : 'transport')
        if (closing) controller.close()
        else if (sse) {
          // Bun.serve can turn an errored response stream into clean EOF. Keep
          // failure explicit for the native SSE client; never emit message_stop.
          controller.enqueue(new TextEncoder().encode('\n\nevent: error\ndata: {"type":"error","error":{"type":"api_error","message":"Observer upstream stream interrupted"}}\n\n'))
          controller.close()
        } else controller.error(new Error('Upstream stream interrupted'))
      }
    }, async cancel() {
      request.signal.removeEventListener('abort', cancel)
      abort.abort('client'); noteAbort(); await finish('cancelled', 'cancelled'); await reader.cancel()
    } })
    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.delete('content-length'); responseHeaders.delete('content-encoding')
    return new Response(stream, { status: upstream.status, headers: responseHeaders })
  } })
  return { baseUrl: `http://127.0.0.1:${server.port}`, records,
    async close() {
      closing = true
      for (const task of [...pending]) { task.abort.abort('observer_close'); await task.finish('cancelled', 'cancelled') }
      server.stop(true); await saved
    },
  }
}
