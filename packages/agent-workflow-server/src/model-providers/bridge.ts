import { modelRuntimeFetch } from '../beegame/model-runtime-transport'
import {
  getTLSFetchOptions,
  resolveApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
import { createPinnedRuntimeFetch } from '../beegame/model-runtime-network'
import { providerConfig } from './config'
import { requestProvider } from './request'
import type { ProviderUsage, ProviderToolErrorHandler } from './response-stream'
import { safeErrorFacts } from '../security/safe-error-facts'

export type ProviderNetworkOptions = {
  outboundTargetPolicyOptions?: OutboundTargetPolicyOptions
  resolveOutboundTarget?: typeof resolveApprovedOutboundTarget
}
export async function startProviderBridge(
  env: Record<string, string>,
  options: ProviderNetworkOptions & {
    sessionId?: string
    onUsage(usage: ProviderUsage): void
    onToolError?: ProviderToolErrorHandler
  },
) {
  const config = { ...providerConfig(env), sessionId: options.sessionId }
  const policy = options.outboundTargetPolicyOptions ?? {
    allowedHosts: (process.env.BEEGAME_OUTBOUND_ALLOWED_HOSTS ?? '')
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
  const capability = crypto.randomUUID(),
    path = '/' + crypto.randomUUID() + '/v1/responses'
  const active = new Map<AbortController, Promise<void>>()
  let closing = false,
    closed: Promise<void> | undefined
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    maxRequestBodySize: 64 * 1024 * 1024,
    async fetch(incoming) {
      if (closing) return new Response('Closed', { status: 410 })
      const route = new URL(incoming.url).pathname
      const compact = config.protocol === 'responses' && route === path + '/compact'
      if (
        incoming.headers.has('origin') ||
        incoming.method !== 'POST' ||
        (route !== path && !compact) ||
        incoming.headers.get('authorization') !== 'Bearer ' + capability
      )
        return new Response('Not found', { status: 404 })
      const abort = new AbortController()
      let finish!: () => void
      active.set(
        abort,
        new Promise(resolve => {
          finish = () => {
            active.delete(abort)
            resolve()
          }
        }),
      )
      let upstreamStarted = false
      try {
        const body = await incoming.json()
        const signal = AbortSignal.any([incoming.signal, abort.signal])
        // Responses stays native (search, usage events and compaction included).
        // Only its transport changes: DNS pinning and redirect policy are host-owned.
        const headers = new Headers(incoming.headers)
        for (const name of ['host', 'authorization', 'content-length', 'connection', 'cookie',
          'transfer-encoding', 'keep-alive', 'proxy-authorization', 'te', 'trailer', 'upgrade']) headers.delete(name)
        headers.set('authorization', 'Bearer ' + config.apiKey)
        // Identify the real network boundary; conversion errors are local,
        // even when their exception has no recognizable code or HTTP status.
        const requestUpstream = ((...args: Parameters<typeof fetch>) => {
          upstreamStarted = true
          return request(...args)
        }) as typeof fetch
        const response = config.protocol === 'responses'
          ? await requestUpstream(config.baseUrl + '/responses' + (compact ? '/compact' : ''), {
              method: 'POST', headers, signal, redirect: 'error', body: JSON.stringify(body),
            })
          : await requestProvider(config, body, requestUpstream, signal, options.onUsage, options.onToolError)
        if (!response.body) {
          finish()
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
                  finish()
                  controller.close()
                } else controller.enqueue(chunk.value)
              } catch {
                finish()
                controller.error(Error('Provider stream failed'))
              }
            },
            async cancel() {
              abort.abort()
              try {
                await reader.cancel()
              } finally {
                finish()
              }
            },
          }),
          { status: response.status, headers: responseHeaders },
        )
      } catch (error) {
        abort.abort()
        finish()
        const facts = safeErrorFacts(error)
        const candidate = facts.httpStatus
        const upstreamStatus = typeof candidate === 'number' && Number.isInteger(candidate) &&
          candidate >= 400 && candidate <= 599 ? candidate : undefined
        return Response.json(
          {
            error: {
              type: upstreamStarted ? 'provider_error' : 'invalid_request_error',
              message: !upstreamStarted
                ? 'BGS could not parse or convert the model request for the selected provider protocol'
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
    baseUrl:
      server.url.toString().replace(/\/$/, '') +
      path.slice(0, -'/responses'.length),
    apiKey: capability,
    close() {
      return (closed ??= (async () => {
        closing = true
        const pending = [...active.values()]
        for (const abort of active.keys()) abort.abort()
        server.stop(true)
        await Promise.allSettled(pending)
        await request.close()
      })())
    },
  }
}
