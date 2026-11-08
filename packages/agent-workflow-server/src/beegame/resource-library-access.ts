import { safeErrorFacts } from '../security/safe-error-facts'

/** A per-dispatch, read-only bridge to existing library APIs, not a sourcing agent.
 * The user's refreshable credential stays in the host; never give out a service token.
 */
export function createResourceLibraryAccess(input: {
  baseUrl: string
  getAuthToken: () => string | undefined | Promise<string | undefined>
  fetchImpl?: (url: URL, init: RequestInit) => Promise<Response>
}) {
  const upstream = new URL(input.baseUrl)
  if (!['http:', 'https:'].includes(upstream.protocol))
    throw new Error('Resource library requires an HTTP(S) endpoint')
  return async (request: Request, path: string) => {
    const url = new URL(request.url)
    if (request.headers.has('origin'))
      return new Response('Not found', { status: 404 })
    // Exact read-only API shapes. In particular no arbitrary URL, upload,
    // inspection job, catalog mutation or administrative endpoint is proxied.
    const bodyQuery = request.method === 'POST' && (
      path === '/api/resource-catalog/packs' ||
      /^\/api\/resource-catalog\/packs\/[\w-]+\/elements$/.test(path) ||
      path === '/api/resource-library/resolve'
    )
    const readable = bodyQuery || request.method === 'GET' && (
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
        ...(bodyQuery ? { body: await request.text() } : {}),
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      })
      return new Response(response.body, {
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
      })
    } catch (error) {
      const code = request.signal.aborted ? 'resource_request_cancelled'
        : error instanceof Error && error.name === 'TimeoutError' ? 'resource_request_timeout' : 'resource_connection_failed'
      const facts = safeErrorFacts(error)
      console.warn('[resource-library]', { method: request.method, path, code, ...facts })
      return Response.json({ error: 'Resource library request unavailable; do not report no matching assets.', code, ...facts },
        { status: code === 'resource_request_timeout' ? 504 : 503 })
    }
  }
}
