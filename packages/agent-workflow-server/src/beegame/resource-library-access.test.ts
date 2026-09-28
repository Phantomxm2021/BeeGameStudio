import { expect, test } from 'bun:test'
import { openResourceLibraryAccess } from './resource-library-access'

test('exposes existing semantic facets as read-only queries without permitting mutations', async () => {
  const bodies: string[] = []
  const access = openResourceLibraryAccess({ baseUrl: 'https://library.test', getAuthToken: () => 'test',
    fetchImpl: async (_url, init) => { bodies.push(String(init.body)); return Response.json({ items: [], facets: { usageTags: ['terrain'] } }) } })
  const base = access.baseUrl
  try {
    expect(access.catalogObserved()).toBe(false)
    const body = JSON.stringify({ filters: { usageTags: ['terrain'], formats: ['png'] } })
    for (const path of ['/api/resource-catalog/packs', '/api/resource-catalog/packs/pack-1/elements']) {
      expect((await fetch(base + path, { method: 'POST', body })).status).toBe(200)
    }
    expect(bodies).toEqual([body, body])
    expect(access.catalogObserved()).toBe(true)
    expect((await fetch(base + '/api/resource-packs/pack-1', { method: 'POST', body })).status).toBe(405)
  } finally { access.close() }
})

test('native HTTP access reuses user auth, supports metadata/download and forbids mutations', async () => {
  const calls: { url: string; auth: string | null }[] = []
  let token = 'user-token-1'
  const access = openResourceLibraryAccess({
    baseUrl: 'https://library.test',
    getAuthToken: () => token,
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
      expect(init?.redirect).toBe('error')
      return Response.json({ url: 'https://cdn.test/asset.png' })
    }),
  })
  const base = access.baseUrl
  try {
    expect(access.catalogObserved()).toBe(false)
    expect(access.instruction).not.toContain(token)
    expect(access.instruction).not.toContain(base)
    expect((await fetch(base + '/api/resource-search?status=published')).status).toBe(200)
    token = 'refreshed-user-token'
    const download = await fetch(base + '/api/resource-packs/pack-1/elements/element-1/resource-url')
    expect(await download.json()).toEqual({ url: 'https://cdn.test/asset.png' })
    expect(calls).toEqual([
      { url: 'https://library.test/api/resource-search?status=published', auth: 'Bearer user-token-1' },
      { url: 'https://library.test/api/resource-packs/pack-1/elements/element-1/resource-url', auth: 'Bearer refreshed-user-token' },
    ])
    expect((await fetch(base + '/api/resource-packs/pack-1', { method: 'DELETE' })).status).toBe(405)
    expect((await fetch(base + '/api/internal/admin')).status).toBe(405)
    expect((await fetch(base + '/api/resource-search', { headers: { origin: 'https://untrusted.test' } })).status).toBe(404)
    expect((await fetch(base.replace(/\/[a-f0-9]+$/, '/wrong') + '/api/resource-search')).status).toBe(404)
    expect(calls).toHaveLength(2)
  } finally { access.close() }
  await expect(fetch(base + '/api/resource-search')).rejects.toThrow()
})

test('unavailable auth and upstream errors are not empty search results', async () => {
  let authenticated = false
  const access = openResourceLibraryAccess({
    baseUrl: 'https://library.test',
    getAuthToken: () => authenticated ? 'secret' : undefined,
    fetchImpl: async () => { throw new Error('secret upstream error') },
  })
  const base = access.baseUrl
  try {
    const noAuth = await fetch(base + '/api/resource-search')
    expect(noAuth.status).toBe(503)
    expect(await noAuth.text()).toContain('not an empty search result')
    expect(access.catalogObserved()).toBe(false)
    authenticated = true
    const unavailable = await fetch(base + '/api/resource-search')
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('secret')
  } finally { access.close() }
})
