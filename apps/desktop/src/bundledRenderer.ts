import path from 'node:path'
import { stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { DEV_RENDERER_URL } from './config'

type NetworkFetch = (
  input: string | Request,
  init?: RequestInit & { bypassCustomProtocolHandlers?: boolean },
) => Promise<Response>

const RUNTIME_URL = 'http://127.0.0.1:62174'

/** Serve the packaged UI at the existing local origin without binding a socket.
 * The same API/preview routes as Vite go to BGS; all other HTTP traffic uses Chromium.
 */
export async function serveBundledRenderer(
  request: Request,
  root: string,
  fetch: NetworkFetch,
): Promise<Response> {
  const url = new URL(request.url)
  if (url.origin !== DEV_RENDERER_URL) {
    return fetch(request, { bypassCustomProtocolHandlers: true })
  }
  if (/^\/(api|previews|deployments)(\/|$)/.test(url.pathname)) {
    try {
      return await fetch(`${RUNTIME_URL}${url.pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: request.signal,
        redirect: 'manual',
        credentials: 'include',
        bypassCustomProtocolHandlers: true,
      })
    } catch {
      return new Response(JSON.stringify({ error: 'Local BGS service is unavailable.' }), {
        status: 503, headers: { 'content-type': 'application/json' },
      })
    }
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405 })
  }
  let pathname: string
  try { pathname = decodeURIComponent(url.pathname) } catch {
    return new Response('Invalid path', { status: 400 })
  }
  const file = path.resolve(root, `.${pathname}`)
  const relative = path.relative(root, file)
  if (relative.startsWith('..') || path.isAbsolute(relative) || pathname.includes('\0')) {
    return new Response('Forbidden', { status: 403 })
  }
  try {
    const exists = await stat(file).then(value => value.isFile()).catch(() => false)
    // Client routes fall back to the app entry; missing assets stay missing.
    const target = exists ? file : path.extname(pathname) ? null : path.join(root, 'index.html')
    if (!target) return new Response('Not found', { status: 404 })
    const response = await fetch(pathToFileURL(target).toString())
    return request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response
  } catch {
    return new Response('Bundled frontend is unavailable.', { status: 500 })
  }
}
