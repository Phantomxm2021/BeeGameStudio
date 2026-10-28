import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serveBundledRenderer } from './bundledRenderer'

let root: string
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'bgs-bundle-test-'))
  await writeFile(path.join(root, 'index.html'), '<h1>BGS</h1>')
  await writeFile(path.join(root, 'app.js'), 'export {}')
})
afterAll(async () => { await rm(root, { recursive: true, force: true }) })

describe('bundled renderer', () => {
  it('loads assets and client routes from the bundled directory', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('asset'))
    await serveBundledRenderer(new Request('http://127.0.0.1:62173/app.js'), root, fetch)
    expect(fetch.mock.calls[0][0]).toBe(new URL(`file://${root}/app.js`).toString())
    await serveBundledRenderer(new Request('http://127.0.0.1:62173/library'), root, fetch)
    expect(fetch.mock.calls[1][0]).toBe(new URL(`file://${root}/index.html`).toString())
    const missing = await serveBundledRenderer(new Request('http://127.0.0.1:62173/missing.js'), root, fetch)
    expect(missing.status).toBe(404)
  })

  it('rejects encoded directory traversal and local writes', async () => {
    const fetch = vi.fn()
    const outside = await serveBundledRenderer(new Request('http://127.0.0.1:62173/%2e%2e%2fsecret'), root, fetch)
    expect(outside.status).toBe(403)
    const write = await serveBundledRenderer(new Request('http://127.0.0.1:62173/app.js', { method: 'POST' }), root, fetch)
    expect(write.status).toBe(405)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('forwards BGS routes, query, methods, headers and cancellation without recursion', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('ok'))
    const request = new Request('http://127.0.0.1:62173/api/data?page=2', {
      method: 'POST', body: 'payload', headers: { 'content-type': 'text/plain' },
    })
    await serveBundledRenderer(request, root, fetch)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:62174/api/data?page=2')
    expect(options).toMatchObject({ method: 'POST', bypassCustomProtocolHandlers: true, redirect: 'manual' })
    expect(options.headers.get('content-type')).toBe('text/plain')
    expect(await new Response(options.body).text()).toBe('payload')
    expect(options.signal).toBe(request.signal)
    for (const route of ['/previews/one/', '/deployments/one/']) {
      await serveBundledRenderer(new Request(`http://127.0.0.1:62173${route}`), root, fetch)
      expect(fetch.mock.lastCall?.[0]).toBe(`http://127.0.0.1:62174${route}`)
    }
  })

  it('preserves other HTTP requests and reports unavailable BGS', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('other'))
    const other = new Request('http://localhost:9999/file')
    await serveBundledRenderer(other, root, fetch)
    expect(fetch).toHaveBeenCalledWith(other, { bypassCustomProtocolHandlers: true })
    fetch.mockRejectedValue(new Error('offline'))
    const response = await serveBundledRenderer(new Request('http://127.0.0.1:62173/api/projects'), root, fetch)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Local BGS service is unavailable.' })
  })
})
