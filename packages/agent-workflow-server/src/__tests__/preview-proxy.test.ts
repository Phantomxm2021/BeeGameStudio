import { expect, test } from 'bun:test'
import { proxyBeeGamePreviewRequest } from '../app'

test('answers authenticated-route CORS preflights without requiring upstream OPTIONS support', async () => {
  const response = await proxyBeeGamePreviewRequest(new Request('http://studio/previews/session/src/main.ts', {
    method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'GET' },
  }), 'session', 'http://127.0.0.1:1')
  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-origin')).toBe('*')
  expect(response.headers.get('access-control-allow-methods')).toContain('GET')
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
