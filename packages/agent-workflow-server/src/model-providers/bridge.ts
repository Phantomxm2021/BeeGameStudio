import { createHash } from 'node:crypto'
import { openCodeGoHeaders } from './requests'
import { normalizeNativeFunctionHistory } from './messages'
import { modelRuntimeFetch, MODEL_RESPONSE_TIMEOUTS } from '../beegame/model-runtime-transport'
import {
  getTLSFetchOptions,
  resolveApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
import { createPinnedRuntimeFetch } from '../beegame/model-runtime-network'
import { providerConfig } from './config'
import { requestProvider } from './request'
import { providerOutputBudget } from './output-budget'
import { checkedLocalCompaction, nativeResponses, type ProviderUsage, type ProviderToolErrorHandler } from './response-stream'
import { safeErrorFacts } from '../security/safe-error-facts'
import { observeProviderHttpError, ProviderHttpError } from './http-error'

export type ProviderNetworkOptions = {
  outboundTargetPolicyOptions?: OutboundTargetPolicyOptions
  resolveOutboundTarget?: typeof resolveApprovedOutboundTarget
}
export async function startProviderBridge(
  env: Record<string, string>,
  options: ProviderNetworkOptions & {
    sessionId?: string
    modelCatalog?: string
    onUsage(usage: ProviderUsage): void
    onToolError?: ProviderToolErrorHandler
  },
) {
  const config = { ...providerConfig(env), sessionId: options.sessionId }
  const policy = options.outboundTargetPolicyOptions ?? {
    allowTrustedDevelopmentProxy: process.env.NODE_ENV !== 'production' &&
      process.env.BEEGAME_ALLOW_TRUSTED_DEVELOPMENT_OUTBOUND_PROXY === '1',
    trustedDevelopmentProxyHosts: (process.env.BEEGAME_TRUSTED_DEVELOPMENT_PROXY_HOSTS ?? '')
      .split(',')
      .map(host => host.trim())
      .filter(Boolean),
  }
  const target = await (
    options.resolveOutboundTarget ?? resolveApprovedOutboundTarget
  )(config.baseUrl, policy)
  if (!target)
    throw Error('The selected model provider endpoint is not permitted')
  const request = createPinnedRuntimeFetch(
    modelRuntimeFetch,
    { provider: target },
    { tls: getTLSFetchOptions().tls },
  )
  const metadataAbort = new AbortController()
  const budgetFor = providerOutputBudget(config, request, metadataAbort.signal)
  const capability = crypto.randomUUID(),
    path = '/' + crypto.randomUUID() + '/v1/responses'
  const catalogPath = path.slice(0, -'/responses'.length) + '/models'
  const sessionHash = options.sessionId === undefined ? undefined
    : createHash('sha256').update(options.sessionId).digest('hex')
  const active = new Map<AbortController, Promise<void>>()
  let closing = false,
    closed: Promise<void> | undefined
  let toolArgumentsFailure: string | undefined
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    // Use Bun's finite default: retained inline-image history can exceed 64 MiB.
    async fetch(incoming) {
      if (closing) return new Response('Closed', { status: 410 })
      const route = new URL(incoming.url).pathname
      const compact = config.protocol === 'responses' && route === path + '/compact'
      if (
        incoming.headers.has('origin') ||
        incoming.headers.get('authorization') !== 'Bearer ' + capability
      )
        return new Response('Not found', { status: 404 })
      if (incoming.method === 'GET' && route === catalogPath && options.modelCatalog !== undefined)
        return new Response(options.modelCatalog, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
      if (incoming.method !== 'POST' || (route !== path && !compact))
        return new Response('Not found', { status: 404 })
      // Native may reconnect after a broken stream. An unrecoverable argument
      // conflict cannot be repaired by paying for that same response again.
      if (toolArgumentsFailure) return Response.json({ error: { type: 'invalid_request_error',
        code: 'provider_tool_arguments', message: toolArgumentsFailure + '; automatic resubmission is disabled for this execution.' } }, { status: 400 })
      const abort = new AbortController()
      const started = performance.now(), startedAt = new Date().toISOString(), requestId = crypto.randomUUID()
      let localCompaction = isLocalCompaction(incoming.headers.get('x-codex-turn-metadata'))
      const timing: { bodyParsedMs?: number; upstreamStartMs?: number; upstreamHeadersMs?: number;
        requestBytes?: number; httpStatus?: number; sentMaxOutputTokens?: number;
        outputBudgetSource?: string; outputBudgetUnavailable?: string; budgetLookupMs?: number } = {}
      const elapsed = () => Math.round(performance.now() - started)
      let httpError: Readonly<ReturnType<typeof observeProviderHttpError>['details']> | undefined
      let errorBody: ReturnType<typeof observeProviderHttpError> | undefined
      // Fixed metadata and allowlisted HTTP facts only; never raw headers or payloads.
      const trace = (event: string, details: Record<string, string | boolean> = {}) =>
        console.info('[model-request] ' + JSON.stringify({ event, requestId, sessionHash,
          protocol: config.protocol, operation: compact ? 'compact' : localCompaction ? 'local-compaction' : 'responses', startedAt,
          ...timing, elapsedMs: elapsed(), ...details, ...(event === 'finished' && httpError ? { error: httpError } : {}) }))
      trace('received')
      let finish!: (end: 'body-ended' | 'body-error' | 'cancelled' | 'request-error' | 'no-body') => void
      active.set(
        abort,
        new Promise(resolve => {
          finish = end => {
            errorBody?.finish(end === 'body-ended' || end === 'no-body')
            // EOF, cancellation and shutdown can converge on the same request.
            if (active.delete(abort)) trace('finished', { end, aborted: abort.signal.aborted || incoming.signal.aborted })
            resolve()
          }
        }),
      )
      let upstreamStarted = false
      let usageReported = false
      const onUsage = (usage: ProviderUsage) => {
        usageReported = true
        options.onUsage(usage)
      }
      try {
        const body = await incoming.json()
        timing.bodyParsedMs = elapsed()
        localCompaction ||= isLocalCompaction(body.client_metadata?.['x-codex-turn-metadata'])
        const signal = AbortSignal.any([incoming.signal, abort.signal])
        // Responses retains native inputs and opaque model data. The shared
        // boundary normalizes empty tool explanations and records usage.
        const headers = new Headers(incoming.headers)
        for (const name of ['host', 'authorization', 'content-length', 'connection', 'cookie',
          'transfer-encoding', 'keep-alive', 'proxy-authorization', 'te', 'trailer', 'upgrade']) headers.delete(name)
        headers.set('authorization', 'Bearer ' + config.apiKey)
        if (config.protocol === 'responses')
          for (const [name, value] of Object.entries(openCodeGoHeaders(config))) headers.set(name, value)
        // Identify the real network boundary; conversion errors are local,
        // even when their exception has no recognizable code or HTTP status.
        const requestUpstream = (async (input: RequestInfo | URL, init?: RequestInit) => {
          // All bridge routes dispatch serialized JSON; count UTF-8 bytes once,
          // without serializing again or retaining another copy of the history.
          if (typeof init?.body !== 'string') throw Error('Provider bridge requires serialized JSON')
          timing.requestBytes = Buffer.byteLength(init.body, 'utf8')
          timing.upstreamStartMs = elapsed()
          upstreamStarted = true
          trace('upstream-started')
          const response = await request(input, { ...init, ...MODEL_RESPONSE_TIMEOUTS } as RequestInit)
          timing.upstreamHeadersMs = elapsed()
          timing.httpStatus = response.status
          trace('upstream-headers')
          return response
        }) as typeof fetch
        const outputBudget = async (fallback?: unknown) => {
          if (compact || localCompaction) return undefined
          if (body.max_output_tokens != null) {
            timing.outputBudgetSource = 'request'
            if (Number.isSafeInteger(body.max_output_tokens) && body.max_output_tokens > 0)
              timing.sentMaxOutputTokens = body.max_output_tokens
            return undefined
          }
          const model = body.model ?? config.model
          const lookupStarted = elapsed()
          const budget = typeof model === 'string' && model
            ? await budgetFor(model) : { tokens: undefined, unavailable: 'model_not_selected' }
          timing.budgetLookupMs = elapsed() - lookupStarted
          timing.outputBudgetSource = budget.tokens === undefined ? 'provider-default' : 'provider-model'
          timing.outputBudgetUnavailable = budget.unavailable
          const sent = budget.tokens ?? fallback
          if (typeof sent === 'number' && Number.isSafeInteger(sent) && sent > 0) timing.sentMaxOutputTokens = sent
          return budget.tokens
        }
        if (config.protocol === 'responses' && !compact) {
          const tokens = await outputBudget()
          if (tokens !== undefined) body.max_output_tokens = tokens
        }
        let response = config.protocol === 'responses'
          ? await requestUpstream(config.baseUrl + '/responses' + (compact ? '/compact' : ''), {
              method: 'POST', headers, signal, redirect: 'error', body: JSON.stringify(normalizeNativeFunctionHistory(body)),
            })
          : await requestProvider(config, body, requestUpstream, signal, onUsage, options.onToolError, outputBudget)
        // Observe native HTTP failures without changing bytes, headers or retry semantics.
        if (config.protocol === 'responses' && !response.ok) {
          errorBody = observeProviderHttpError(response)
          httpError = errorBody.details
        }
        if (config.protocol === 'responses')
          response = await nativeResponses(response, body, onUsage, message => { toolArgumentsFailure = message })
        if (localCompaction) response = await checkedLocalCompaction(response, body.stream === true)
        if (!response.body) {
          finish('no-body')
          return response
        }
        const reader = response.body.getReader()
        const responseHeaders = new Headers(response.headers)
        // Undici has already decoded compressed upstream bodies.
        for (const name of ['content-length', 'content-encoding', 'connection', 'transfer-encoding']) responseHeaders.delete(name)
        return new Response(
          new ReadableStream({
            async pull(controller) {
              try {
                const chunk = await reader.read()
                if (chunk.done) {
                  finish('body-ended')
                  controller.close()
                } else {
                  errorBody?.append(chunk.value)
                  controller.enqueue(chunk.value)
                }
              } catch {
                finish('body-error')
                controller.error(Error('Provider stream failed'))
              }
            },
            async cancel() {
              abort.abort()
              try {
                await reader.cancel()
              } finally {
                finish('cancelled')
              }
            },
          }),
          { status: response.status, headers: responseHeaders },
        )
      } catch (error) {
        if (error instanceof ProviderHttpError) httpError = error.diagnostics
        abort.abort()
        finish('request-error')
        // A request may have reached the supplier without returning headers or
        // a final receipt. Preserve known totals; zero here is only a delta.
        // Conversion failures before dispatch and already reported streams
        // must not create another usage event.
        if (upstreamStarted && !usageReported) onUsage({
          input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
          cache_creation_tokens: 0, total_tokens: 0, incomplete: true,
        })
        const facts = safeErrorFacts(error)
        const candidate = facts.httpStatus
        const upstreamStatus = typeof candidate === 'number' && Number.isInteger(candidate) &&
          candidate >= 400 && candidate <= 599 ? candidate : undefined
        const providerError = upstreamStarted && error instanceof ProviderHttpError ? error : undefined
        return Response.json(
          {
            error: {
              type: providerError?.identifiers.type ?? (upstreamStarted ? 'provider_error' : 'invalid_request_error'),
              code: providerError?.identifiers.code,
              param: providerError?.identifiers.param,
              message: !upstreamStarted
                ? 'BGS could not parse or convert the model request for the selected provider protocol'
                : error instanceof ProviderHttpError
                ? error.message
                : upstreamStatus
                ? `The selected model provider request failed (HTTP ${upstreamStatus})`
                : 'The selected model provider transport failed' +
                  (facts.networkCode ? ` (${facts.networkCode})` : ''),
            },
          },
          { status: upstreamStarted ? upstreamStatus ?? 502 : 400 },
        )
      }
    },
  })
  return {
    protocol: config.protocol,
    ...(options.modelCatalog !== undefined ? { modelCatalogUrl: server.url.origin + catalogPath } : {}),
    baseUrl:
      server.url.toString().replace(/\/$/, '') +
      path.slice(0, -'/responses'.length),
    apiKey: capability,
    close() {
      return (closed ??= (async () => {
        closing = true
        metadataAbort.abort()
        const pending = [...active.values()]
        for (const abort of active.keys()) abort.abort()
        server.stop(true)
        await Promise.allSettled(pending)
        await request.close()
      })())
    },
  }
}

/** This optional native metadata is classification evidence, not prompt text. */
function isLocalCompaction(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try { return JSON.parse(value)?.request_kind === 'compaction' } catch { return false }
}
