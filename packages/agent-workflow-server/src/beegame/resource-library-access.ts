import { randomBytes } from 'node:crypto'

/** A per-dispatch, read-only bridge to existing library APIs, not a sourcing agent.
 * The user's refreshable credential stays in the host; never give out a service token.
 */
export function openResourceLibraryAccess(input: {
  baseUrl: string
  getAuthToken: () => string | undefined | Promise<string | undefined>
  fetchImpl?: (url: URL, init: RequestInit) => Promise<Response>
}) {
  const upstream = new URL(input.baseUrl)
  if (!['http:', 'https:'].includes(upstream.protocol))
    throw new Error('Resource library requires an HTTP(S) endpoint')
  const key = randomBytes(32).toString('hex')
  const prefix = '/' + key
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    maxRequestBodySize: 1024 * 1024,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.headers.has('origin') || !url.pathname.startsWith(prefix + '/'))
        return new Response('Not found', { status: 404 })
      const path = url.pathname.slice(prefix.length)
      // Exact read-only API shapes. In particular no arbitrary URL, upload,
      // inspection job, catalog mutation or administrative endpoint is proxied.
      const catalogQuery = request.method === 'POST' && (
        path === '/api/resource-catalog/packs' ||
        /^\/api\/resource-catalog\/packs\/[\w-]+\/elements$/.test(path)
      )
      const readable = catalogQuery || request.method === 'GET' && (
        path === '/api/resource-search' ||
        /^\/api\/resource-packs(?:\/[\w-]+(?:\/elements(?:\/[\w-]+(?:\/resource-url)?)?)?)?$/.test(path)
      )
      if (!readable)
        return new Response('Read-only resource endpoint required', { status: 405 })
      try {
        const token = await input.getAuthToken()
        if (!token) return Response.json({ error: 'Resource library authentication unavailable; this is not an empty search result.' }, { status: 503 })
        const response = await (input.fetchImpl ?? fetch)(new URL(path + url.search, upstream), {
          method: request.method,
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          ...(catalogQuery ? { body: await request.text() } : {}),
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        })
        return new Response(response.body, {
          status: response.status,
          headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
        })
      } catch {
        return Response.json({ error: 'Resource library request unavailable; do not report no matching assets.' }, { status: 503 })
      }
    },
  })
  const base = 'http://127.0.0.1:' + server.port + prefix
  return {
    instruction: [
      'Built-in resource library: use native Bash/curl against this temporary read-only endpoint (no deferred resource tool is needed).',
      'Base URL: ' + base,
      'GET /api/resource-search?status=published lists packs. Optional filters: dimension=2D or 3D, primaryCategory, tag, gameType; tag/gameType can be repeated. Pack responses include tags and category metadata. These are filters, not free-text search; omit an uncertain filter rather than interpret an empty intersection as an empty library.',
      'For semantic browsing, POST /api/resource-catalog/packs with {"filters":{}} returns items and available facets. POST /api/resource-catalog/packs/{packId}/elements with {"filters":{"usageTags":["terrain"],"formats":["png"]}} filters files within your chosen pack. Select filter values from returned facets; these POST endpoints are read-only queries, not generation or automatic resource selection.',
      'GET /api/resource-packs/{packId} reads pack/license/version metadata; GET /api/resource-packs/{packId}/elements lists files and dependency metadata.',
      'GET /api/resource-packs/{packId}/elements/{elementId}/resource-url returns a download URL. Inspect dependencies and obtain the required files, not just the preview image.',
      'Download selected files with native tools into assets/, retain source/license/pack/version and register actual hashes in Manifest. Keep this temporary endpoint out of project artifacts.',
      '401/403/503 are access failures, not evidence that the library has no suitable assets. Internet sourcing remains available independently through native search/browser or Bash HTTP tools.',
    ].join('\n'),
    close() { server.stop(true) },
  }
}
