import { expect, test } from 'bun:test'
import { proxyBeeGamePreviewRequest } from '../app'
import { gzipSync } from 'node:zlib'

test('preserves module query flags and encoding while stripping only preview capabilities', async () => {
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new Response(new URL(request.url).search)
  } })
  try {
    for (const query of [
      'import&raw&label=a%20b&label=a+b',
      '__beegame_preview_capability=secret&import&raw&label=a%20b&label=a+b',
      'import&%5F%5Fbeegame_preview_capability=secret&raw&label=a%20b&label=a+b&__beegame_preview_capability=other',
    ]) {
      const response = await proxyBeeGamePreviewRequest(new Request(`http://studio/previews/session/content/index.json?${query}`), 'session', upstream.url.toString())
      expect(await response.text()).toBe('?import&raw&label=a%20b&label=a+b')
    }
  } finally { upstream.stop(true) }
})

test('compressed HTML, JavaScript and binary assets survive the HTTP proxy without double decoding', async () => {
  const files = new Map([
    ['/index.html', { type: 'text/html', body: Buffer.from('<html><head></head><body>Hello</body></html>') }],
    ['/main.js', { type: 'application/javascript', body: Buffer.from('export const value = 42;') }],
    ['/image.png', { type: 'image/png', body: Buffer.from([137, 80, 78, 71, 0, 255, 12]) }],
  ])
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const file = files.get(new URL(request.url).pathname)!
    const compressed = gzipSync(file.body)
    return new Response(compressed, { headers: { 'content-type': file.type,
      'content-encoding': 'gzip', 'content-length': String(compressed.length), etag: '"compressed"' } })
  } })
  const proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return proxyBeeGamePreviewRequest(request, 'session', upstream.url.toString())
  } })
  try {
    for (const [path, file] of files) {
      const response = await fetch(new URL(`/previews/session${path}`, proxy.url))
      expect(response.headers.has('content-encoding')).toBe(false)
      expect(response.headers.has('etag')).toBe(false)
      const body = Buffer.from(await response.arrayBuffer())
      if (file.type === 'text/html') {
        expect(body.toString()).toContain('data-beegame-preview-console-bridge')
        expect(body.toString()).toContain('<body>Hello</body>')
      } else expect(body).toEqual(file.body)
    }
  } finally { proxy.stop(true); upstream.stop(true) }
})

test('answers authenticated-route CORS preflights without requiring upstream OPTIONS support', async () => {
  const response = await proxyBeeGamePreviewRequest(new Request('http://studio/previews/session/src/main.ts', {
    method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'GET' },
  }), 'session', 'http://127.0.0.1:1')
  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-origin')).toBe('*')
  expect(response.headers.get('access-control-allow-methods')).toContain('GET')
})

test('HTML cache responses and HEAD keep their bodyless semantics', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new Response(null, { status: request.method === 'HEAD' ? 200 : 304,
      headers: { 'content-type': 'text/html', etag: '"cached"', 'content-length': '120' } })
  } })
  try {
    for (const method of ['GET', 'HEAD']) {
      const response = await proxyBeeGamePreviewRequest(new Request('http://studio/previews/session/', { method }), 'session', server.url.toString())
      expect(response.status).toBe(method === 'HEAD' ? 200 : 304)
      expect(await response.text()).toBe('')
      expect(response.headers.get('etag')).toBe('"cached"')
    }
  } finally { server.stop(true) }
})

test('proxies game assets without leaking BGS credentials or capability to project code', async () => {
  let forwarded: { url: string; headers: Headers } | undefined
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    forwarded = { url: request.url, headers: new Headers(request.headers) }
    return new Response('export const ok=true', { headers: { 'content-type': 'application/javascript' } })
  } })
  try {
    const response = await proxyBeeGamePreviewRequest(new Request('http://studio/previews/session/src/main.ts?__beegame_preview_capability=secret&t=5', {
      headers: { cookie: 'private=secret', authorization: 'Bearer secret', origin: 'null' },
    }), 'session', server.url.toString())
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(new URL(forwarded!.url).pathname).toBe('/src/main.ts')
    expect(new URL(forwarded!.url).search).toBe('?t=5')
    expect(forwarded!.headers.has('cookie')).toBe(false)
    expect(forwarded!.headers.has('authorization')).toBe(false)
  } finally { server.stop(true) }
})
