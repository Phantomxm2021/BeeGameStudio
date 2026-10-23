import { PREVIEW_CAPABILITY_QUERY_PARAM } from '../auth/preview-capability'
import { stripViteClientScript } from './vite-preview-host'

export async function proxyBeeGamePreviewRequest(
  request: Request,
  sessionId: string,
  internalBaseUrl: string,
  preservePublicPath = false,
  idleTimeoutMs = 15_000,
  routeId = sessionId,
): Promise<Response> {
  const requestUrl = new URL(request.url)
  const prefix = `/previews/${encodeURIComponent(routeId)}`
  if (requestUrl.pathname !== prefix && !requestUrl.pathname.startsWith(prefix + '/'))
    return new Response('Invalid preview path', { status: 400 })
  const restPath = requestUrl.pathname.startsWith(prefix)
    ? requestUrl.pathname.slice(prefix.length) || '/'
    : '/'
  const targetPath = preservePublicPath ? requestUrl.pathname : restPath
  let target: URL, upstreamBase: URL
  try {
    upstreamBase = new URL(internalBaseUrl)
    target = new URL(targetPath, ensureTrailingSlash(internalBaseUrl))
  } catch {
    return new Response('Invalid preview target', { status: 400 })
  }
  if (!['http:', 'https:'].includes(upstreamBase.protocol) ||
      target.origin !== upstreamBase.origin || target.username || target.password)
    return new Response('Invalid preview target', { status: 400 })
  // URLSearchParams mutation reserializes bare Vite flags (`raw` -> `raw=`),
  // changing module semantics. Remove our credentials without rewriting the
  // remaining query bytes, including repeated keys and percent encoding.
  target.search = requestUrl.search.slice(1).split('&')
    .filter(part => !new URLSearchParams(part).has(PREVIEW_CAPABILITY_QUERY_PARAM))
    .join('&')
  const headers = new Headers(request.headers)
  stripHopByHopHeaders(headers)
  headers.delete('host')
  // The game dev server is untrusted project code, not an authenticated BGS API.
  headers.delete('cookie')
  headers.delete('authorization')
  // fetch decodes response bodies. Prefer identity upstream, and still handle
  // servers that send a compressed representation despite that preference.
  headers.set('accept-encoding', 'identity')
  const method = request.method.toUpperCase()
  if (method === 'OPTIONS')
    return new Response(null, { status: 204, headers: withPreviewCorsHeaders(new Headers()) })
  // Bound both header wait and idle body reads; cancellation belongs to the
  // requesting tab, not to the project preview process.
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abort)
  }
  const abort = () => { controller.abort(request.signal.reason); cleanup() }
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { timedOut = true; controller.abort(); cleanup() }, idleTimeoutMs)
  }
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  else arm()
  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
      signal: controller.signal,
    })
    const responseHeaders = withPreviewCorsHeaders(new Headers(upstream.headers))
    stripHopByHopHeaders(responseHeaders)
    responseHeaders.set('referrer-policy', 'no-referrer')
    if (method === 'HEAD' || [204, 205, 304].includes(upstream.status)) {
      await upstream.body?.cancel()
      cleanup()
      return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders })
    }
    if (upstream.headers.has('content-encoding')) {
      for (const name of ['content-encoding', 'content-length', 'etag', 'content-md5'])
        responseHeaders.delete(name)
    }
    if (method === 'GET' && upstream.status !== 206 && isHtmlResponse(upstream.headers)) {
      const html = await upstream.text()
      cleanup()
      for (const name of ['content-length', 'etag', 'content-md5']) responseHeaders.delete(name)
      return new Response(
        injectBeeGamePreviewLifecycleBridge(stripViteClientScript(html, `${prefix}/`), routeId),
        { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders },
      )
    }
    if (!upstream.body) {
      cleanup()
      return new Response(null, { status: upstream.status, headers: responseHeaders })
    }
    const reader = upstream.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(destination) {
        try {
          const { value, done } = await reader.read()
          if (done) { cleanup(); destination.close(); return }
          arm()
          destination.enqueue(value)
        } catch (error) {
          cleanup()
          destination.error(error)
        }
      },
      async cancel(reason) {
        controller.abort(reason)
        cleanup()
        await reader.cancel(reason).catch(() => undefined)
      },
    })
    return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders })
  } catch (error) {
    cleanup()
    return new Response(
      timedOut ? 'Preview upstream timed out' : controller.signal.aborted
        ? 'Preview request cancelled' : `Preview upstream unavailable: ${error instanceof Error ? error.message : String(error)}`,
      { status: timedOut ? 504 : controller.signal.aborted ? 499 : 502,
        headers: withPreviewCorsHeaders(new Headers({ 'content-type': 'text/plain; charset=UTF-8' })) },
    )
  }
}

function isHtmlResponse(headers: Headers): boolean {
  return (headers.get('content-type') || '').toLowerCase().includes('text/html')
}

function withPreviewCorsHeaders(headers: Headers): Headers {
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  headers.set('access-control-allow-headers', '*')
  return headers
}

function injectBeeGamePreviewLifecycleBridge(
  html: string,
  sessionId: string,
): string {
  const bridge = `<script data-beegame-preview-lifecycle-bridge>
(() => {
  if (window.__beegamePreviewLifecycleBridgeInstalled) return;
  window.__beegamePreviewLifecycleBridgeInstalled = true;
  const sessionId = ${JSON.stringify(sessionId)};
  // The sandbox has an opaque origin and referrer-policy is no-referrer.
  // Address the embedding window; the host validates event.source and sessionId.
  const lifecycle = (status) => window.parent?.postMessage({
    type: 'beegame.preview.lifecycle', sessionId, status,
  }, '*');
  const sendConsole = (level, args) => {
    const message = args.slice(0, 8).map(value => {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.stack || value.message;
      try { return JSON.stringify(value) ?? String(value); }
      catch { return String(value); }
    }).join(' ').slice(0, 2000);
    window.parent?.postMessage({ type: 'beegame.preview.console', sessionId, level, message }, '*');
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      try { sendConsole(level, args); } catch { /* Logging must not break the game. */ }
      return original(...args);
    };
  }
  window.addEventListener('DOMContentLoaded', () => lifecycle('loaded'), { once: true });
  window.addEventListener('error', event => {
    if (event.target?.tagName === 'SCRIPT') lifecycle('failed');
  }, true);
  window.addEventListener('error', event => {
    if (event.error || event.message) {
      sendConsole('error', [event.error || event.message]);
      lifecycle('failed');
    }
  });
  window.addEventListener('unhandledrejection', event => {
    sendConsole('error', [event.reason]);
  });
})();
</script>`
  const headClose = html.indexOf('</head>')
  if (headClose >= 0)
    return `${html.slice(0, headClose)}${bridge}${html.slice(headClose)}`
  const bodyClose = html.indexOf('</body>')
  if (bodyClose >= 0)
    return `${html.slice(0, bodyClose)}${bridge}${html.slice(bodyClose)}`
  return `${bridge}${html}`
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}


function stripHopByHopHeaders(headers: Headers): void {
  const nominated = (headers.get('connection') || '').split(',').map(value => value.trim()).filter(Boolean)
  for (const name of [...nominated, 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade']) headers.delete(name)
}
