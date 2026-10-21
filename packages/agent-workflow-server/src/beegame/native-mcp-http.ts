import { modelRuntimeFetch } from './model-runtime-transport'
import { getTLSFetchOptions, resolveApprovedOutboundTarget, type OutboundTargetPolicyOptions,
  type ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import { createPinnedRuntimeFetch } from './model-runtime-network'

export type McpHttpNetworkOptions = {
  outboundTargetPolicyOptions?: OutboundTargetPolicyOptions
  resolveOutboundTarget?: typeof resolveApprovedOutboundTarget
}

/** Native MCP has no custom DNS transport hook. Relay only the selected, pinned
 * endpoints; never give the native client an unrestricted remote URL. */
export async function startNativeMcpHttp(servers: Record<string, string>, options: McpHttpNetworkOptions = {}) {
  const targets: Record<string, ApprovedOutboundTarget> = {}
  for (const [name, url] of Object.entries(servers)) {
    const target = await (options.resolveOutboundTarget ?? resolveApprovedOutboundTarget)(url,
      options.outboundTargetPolicyOptions ?? { allowedHosts: (process.env.BEEGAME_OUTBOUND_ALLOWED_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean) })
    if (!target) throw Error('MCP endpoint is not permitted: ' + name)
    targets[name] = target
  }
  const request = createPinnedRuntimeFetch(modelRuntimeFetch, targets, { tls: getTLSFetchOptions().tls })
  const capability = crypto.randomUUID(), routes = new Map<string, ApprovedOutboundTarget>()
  const paths = Object.fromEntries(Object.entries(targets).map(([name, target]) => {
    const path = '/' + crypto.randomUUID() + '/mcp'
    routes.set(path, target)
    return [name, path]
  }))
  const active = new Map<AbortController, Promise<void>>()
  let closing = false, closed: Promise<void> | undefined
  let server: ReturnType<typeof Bun.serve>
  try {
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, maxRequestBodySize: 64 * 1024 * 1024,
      async fetch(incoming) {
        const url = new URL(incoming.url), target = routes.get(url.pathname)
        if (closing) return new Response('Closed', { status: 410 })
        if (!target || url.search || incoming.headers.has('origin') ||
          incoming.headers.get('x-bgs-mcp-token') !== capability || !['POST', 'GET', 'DELETE'].includes(incoming.method))
          return new Response('Not found', { status: 404 })
        const abort = new AbortController()
        let finish!: () => void
        active.set(abort, new Promise(resolve => { finish = () => { active.delete(abort); resolve() } }))
        try {
          const headers = new Headers()
          for (const name of ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']) {
            const value = incoming.headers.get(name)
            if (value !== null) headers.set(name, value)
          }
          const response = await request(target.url, { method: incoming.method, headers,
            body: incoming.method === 'POST' ? new Uint8Array(await incoming.arrayBuffer()) : undefined,
            signal: AbortSignal.any([incoming.signal, abort.signal]), redirect: 'error' })
          // Authentication discovery must not send the native HTTP client around
          // this relay. BGS has no remote MCP OAuth credential flow yet.
          if (response.status === 401) {
            await response.body?.cancel()
            throw Error('MCP authentication is unavailable')
          }
          const responseHeaders = new Headers()
          for (const name of ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'cache-control']) {
            const value = response.headers.get(name)
            if (value !== null) responseHeaders.set(name, value)
          }
          if (!response.body) { finish(); return new Response(null, { status: response.status, headers: responseHeaders }) }
          const reader = response.body.getReader()
          return new Response(new ReadableStream({
            async pull(controller) {
              try {
                const chunk = await reader.read()
                if (chunk.done) { finish(); controller.close() } else controller.enqueue(chunk.value)
              } catch { finish(); controller.error(Error('MCP stream failed')) }
            },
            async cancel() { abort.abort(); try { await reader.cancel() } finally { finish() } },
          }), { status: response.status, headers: responseHeaders })
        } catch {
          abort.abort(); finish()
          return Response.json({ error: 'MCP request failed; check the permitted endpoint and authentication requirements' }, { status: 502 })
        }
      },
    })
  } catch (error) { await request.close(); throw error }
  return {
    config: Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, {
      url: server.url.origin + path, http_headers: { 'x-bgs-mcp-token': capability },
    }])),
    close() {
      return closed ??= (async () => {
        closing = true
        const pending = [...active.values()]
        for (const abort of active.keys()) abort.abort()
        server.stop(true)
        await Promise.allSettled(pending)
        await request.close()
      })()
    },
  }
}
