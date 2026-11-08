import { expect, test } from 'bun:test'
import { createResourceLibraryAccess } from './resource-library-access'

function openResourceLibraryAccess(input: Parameters<typeof createResourceLibraryAccess>[0]) {
  const access = createResourceLibraryAccess(input)
  const path = '/fixture-library'
  const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    const pathname=new URL(request.url).pathname
    return pathname.startsWith(path+'/') ? access(request,pathname.slice(path.length)) : new Response('Not found',{status:404})
  }})
  return {baseUrl:server.url.origin+path,close(){server.stop(true)}}
}

test('exposes existing semantic facets as read-only queries without permitting mutations', async () => {
  const bodies: string[] = []
  const access = openResourceLibraryAccess({ baseUrl: 'https://library.test', getAuthToken: () => 'test',
    fetchImpl: async (_url, init) => { bodies.push(String(init.body)); return Response.json({ items: [], facets: { usageTags: ['terrain'] } }) } })
  const base = access.baseUrl
  try {
    const body = JSON.stringify({ filters: { usageTags: ['terrain'], formats: ['png'] } })
    for (const path of ['/api/resource-catalog/packs', '/api/resource-catalog/packs/pack-1/elements']) {
      expect((await fetch(base + path, { method: 'POST', body })).status).toBe(200)
    }
    expect(bodies).toEqual([body, body])
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
    expect((await fetch(base.replace('/fixture-library', '/wrong') + '/api/resource-search')).status).toBe(404)
    expect(calls).toHaveLength(2)
  } finally { access.close() }
  await expect(fetch(base + '/api/resource-search')).rejects.toThrow()
})

test('native HTTP access forwards explicit dependency-closure resolution', async () => {
  const calls: { url: string; method: string; body: string }[] = []
  const access = openResourceLibraryAccess({
    baseUrl: 'https://library.test',
    getAuthToken: () => 'user-token',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
      return Response.json({ selections: [{ resourceId: 'scene', dependencies: [{ elementId: 'texture' }] }] })
    },
  })
  const body = JSON.stringify({ selections: [{ resourceId: 'scene' }] })
  try {
    const response = await fetch(access.baseUrl + '/api/resource-library/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ selections: [{ resourceId: 'scene', dependencies: [{ elementId: 'texture' }] }] })
    expect(calls).toEqual([{ url: 'https://library.test/api/resource-library/resolve', method: 'POST', body }])
    expect((await fetch(access.baseUrl + '/api/resource-library/resolve')).status).toBe(405)
    expect(calls).toHaveLength(1)
  } finally { access.close() }
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
    authenticated = true
    const unavailable = await fetch(base + '/api/resource-search')
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('secret')
  } finally { access.close() }
})


test('client cancellation reaches the existing library request without retrying', async () => {
  let entered!:()=>void,aborted!:()=>void,calls=0
  const ready=new Promise<void>(resolve=>entered=resolve),cancelled=new Promise<void>(resolve=>aborted=resolve)
  const access=openResourceLibraryAccess({baseUrl:'https://library.test',getAuthToken:()=> 'synthetic',fetchImpl:async(_url,init)=>{
    calls++;entered();return new Promise((_resolve,reject)=>{
      init.signal!.addEventListener('abort',()=>{aborted();reject(init.signal!.reason)},{once:true})
    })
  }})
  const controller=new AbortController()
  try {
    const response=fetch(access.baseUrl+'/api/resource-catalog/packs',{method:'POST',body:'{}',signal:controller.signal}).catch(error=>error)
    await ready;controller.abort();await response
    await Promise.race([cancelled,Bun.sleep(500).then(()=>{throw Error('Library request was not cancelled')})])
    expect(calls).toBe(1);
  }finally{access.close()}
})


test.each([
  {error:Object.assign(new Error('PRIVATE_URL secret'),{code:'ECONNRESET'}),status:503,code:'resource_connection_failed',networkCode:'ECONNRESET'},
  {error:new DOMException('PRIVATE_URL secret','TimeoutError'),status:504,code:'resource_request_timeout',networkCode:undefined},
])('library errors retain the safe cause without returning an empty result: $code',async fixture=>{
  let calls=0
  const access=openResourceLibraryAccess({baseUrl:'https://library.test',getAuthToken:()=> 'synthetic',fetchImpl:async()=>{calls++;throw fixture.error}})
  try{
    const response=await fetch(access.baseUrl+'/api/resource-catalog/packs',{method:'POST',body:'{}'})
    expect(response.status).toBe(fixture.status)
    const body=await response.json() as any
    expect(body).toMatchObject({code:fixture.code,...(fixture.networkCode?{networkCode:fixture.networkCode}:{})})
    expect(JSON.stringify(body)).not.toContain('PRIVATE');expect(JSON.stringify(body)).not.toContain('secret')
    expect(body).not.toHaveProperty('items');expect(calls).toBe(1)
  }finally{access.close()}
})
