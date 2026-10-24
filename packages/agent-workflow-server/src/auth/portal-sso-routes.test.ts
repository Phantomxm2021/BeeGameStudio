import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { handleBgsSessionRequest } from '../../../../apps/game-portal/src/bgs-session'
import { registerPortalSsoRoutes } from './portal-sso-routes'
import { openPortalPayload, portalNonce, sealPortalPayload } from '../../../beegame-security-core/src/portal-sso'
const portal = 'https://portal.example.test'
const studio = 'http://127.0.0.1:62173'
const secret = portalNonce()
const expiresAt = Math.floor(Date.now() / 1000 + 3600) * 1000
const token = 'header.' + btoa(JSON.stringify({ sub: 'owner', exp: expiresAt / 1000 })).replace(/=+$/, '') + '.signature'
const env = { BEEGAME_PORTAL_SSO_SECRET: secret, BEEGAME_STUDIO_ORIGIN: studio, BEEGAME_SUPABASE_URL: 'https://db.example.test', BEEGAME_SUPABASE_ANON_KEY: 'public-key' }
function bgs(role: 'owner' | 'viewer' | null = 'owner') {
  const app = new Hono()
  registerPortalSsoRoutes(app, {
    env: { BEEGAME_PORTAL_SSO_SECRET: secret, BEEGAME_GAME_PORTAL_BASE_URL: portal },
    resolveUser: async request => request.headers.get('cookie') === 'beegame_session=existing' && role ? { id: 'owner', role, email: 'owner@example.test' } : undefined,
    getAccessToken: async () => token,
  })
  return app
}
const cookies = (response: Response) => response.headers.getSetCookie().filter(x => !x.includes('Max-Age=0')).map(x => x.split(';')[0]).join('; ')
async function start() {
  const response = (await handleBgsSessionRequest(new Request(portal + '/auth/bgs/start'), env))!
  return { response, stateCookie: cookies(response), authorize: response.headers.get('location')! }
}
const fetchOwner = async (input: RequestInfo | URL, init?: RequestInit) => {
  expect(new URL(String(input)).origin).toBe(env.BEEGAME_SUPABASE_URL)
  expect(init?.headers).toMatchObject({ authorization: `Bearer ${token}`, apikey: 'public-key' })
  return Response.json(true)
}
async function handoff() {
  const began = await start()
  const issued = await bgs().request(began.authorize, { headers: { cookie: 'beegame_session=existing' } })
  const callback = issued.headers.get('location')!
  const completed = (await handleBgsSessionRequest(new Request(callback, { headers: { cookie: began.stateCookie } }), env, fetchOwner))!
  return { ...began, issued, callback, completed, sessionCookie: cookies(completed) }
}
describe('BGS → BeePlay shared sign-in', () => {
  test('uses an existing BGS cookie and keeps all tokens behind HttpOnly server boundaries', async () => {
    const flow = await handoff()
    expect(flow.completed.headers.get('location')).toBe(portal + '/admin')
    expect(flow.authorize).toStartWith(studio + '/api/auth/portal/authorize?state=')
    expect(flow.callback).not.toContain(token)
    expect(flow.issued.headers.get('referrer-policy')).toBe('no-referrer')
    expect(flow.completed.headers.get('cache-control')).toBe('no-store')
    expect(flow.sessionCookie).not.toContain(token)
    const setCookie = flow.completed.headers.getSetCookie().find(x => x.startsWith('__Host-beeplay_bgs='))!
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) expect(setCookie).toContain(flag)
    expect(setCookie).not.toContain('Domain=')
    const session = (await handleBgsSessionRequest(new Request(portal + '/api/auth/bgs/session', { headers: { cookie: flow.sessionCookie } }), env))!
    expect(await session.json()).toEqual({ user: { id: 'owner', email: 'owner@example.test' }, expiresAt })
  })
  test('rejects missing/mismatched browser state, consumed state and tampered grants', async () => {
    const flow = await handoff()
    for (const [cookie, url] of [['', flow.callback], [flow.sessionCookie, flow.callback], [flow.stateCookie, flow.callback.replace('state=', 'state=x')], [flow.stateCookie, flow.callback.replace('grant=', 'grant=x')]]) {
      const result = (await handleBgsSessionRequest(new Request(url, { headers: { cookie } }), env, fetchOwner))!
      expect(result.headers.get('location')).toBe(portal + '/admin?bgs=invalid')
      expect(cookies(result)).toBe('')
    }
  })
  test('rejects expired grants and envelopes from another audience', async () => {
    const flow = await start()
    const state = new URL(flow.authorize).searchParams.get('state')!
    for (const [purpose, expires] of [[`bgs-grant:${portal}`, Date.now() - 1], ['bgs-grant:https://evil.test', Date.now() + 60_000]] as const) {
      const grant = await sealPortalPayload(secret, purpose, { state, accessToken: token, tokenExpiresAt: expiresAt, user: { id: 'owner' }, expiresAt: expires })
      const callback = new URL('/auth/bgs/callback', portal); callback.searchParams.set('state', state); callback.searchParams.set('grant', grant)
      const result = (await handleBgsSessionRequest(new Request(callback, { headers: { cookie: flow.stateCookie } }), env, fetchOwner))!
      expect(result.headers.get('location')).toBe(portal + '/admin?bgs=invalid')
    }
    expect(await openPortalPayload(secret, 'other-purpose', flow.stateCookie.split('=')[1]!)).toBeNull()
  })
  test('does not hand off a guest or non-owner and ignores supplied callback URLs', async () => {
    for (const role of [null, 'viewer'] as const) {
      const began = await start()
      const response = await bgs(role).request(began.authorize + '&redirect_uri=https://evil.test', { headers: { cookie: 'beegame_session=existing' } })
      const target = new URL(response.headers.get('location')!)
      expect(target.origin).toBe(portal)
      expect(target.searchParams.get('error')).toBe(role ? 'forbidden' : 'login_required')
      expect(target.searchParams.has('grant')).toBeFalse()
    }
  })
  test('requires actual database ownership even with a correctly encrypted grant', async () => {
    const began = await start()
    const issued = await bgs().request(began.authorize, { headers: { cookie: 'beegame_session=existing' } })
    const response = (await handleBgsSessionRequest(new Request(issued.headers.get('location')!, { headers: { cookie: began.stateCookie } }), env, async () => Response.json(false)))!
    expect(response.headers.get('location')).toBe(portal + '/admin?bgs=forbidden')
    expect(cookies(response)).toBe('')
  })
  test('forwards owner RPCs with the user token and rejects cross-origin writes', async () => {
    const flow = await handoff()
    for (const origin of ['https://evil.test', '']) {
      const response = (await handleBgsSessionRequest(new Request(portal + '/api/admin/beeplay/featured', { method: 'POST', headers: { cookie: flow.sessionCookie, origin, 'content-type': 'application/json' }, body: '{"p_project_ids":[]}' }), env, fetchOwner))!
      expect(response.status).toBe(403)
    }
    const response = (await handleBgsSessionRequest(new Request(portal + '/api/admin/beeplay/featured', { method: 'POST', headers: { cookie: flow.sessionCookie, origin: portal, 'content-type': 'application/json' }, body: '{"p_project_ids":[]}' }), env, async (input, init) => {
      expect(new URL(String(input)).pathname).toBe('/rest/v1/rpc/beegame_admin_portal_featured')
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${token}` })
      expect(JSON.parse(String(init?.body))).toEqual({ p_project_ids: [] })
      return Response.json({ projectIds: [] })
    }))!
    expect(await response.json()).toEqual({ projectIds: [] })
    const expired = await sealPortalPayload(secret, `beeplay-session:${portal}`, { accessToken: token, expiresAt: Date.now() - 1, user: {id:'owner'} })
    const denied = (await handleBgsSessionRequest(new Request(portal + '/api/admin/beeplay/owner', { method: 'POST', headers: { cookie: '__Host-beeplay_bgs='+expired, origin: portal, 'content-type': 'application/json' }, body:'{}' }), env, fetchOwner))!
    expect(denied.status).toBe(401)
  })
  test('clears the Portal session on same-origin logout', async () => {
    const flow = await handoff()
    const response = (await handleBgsSessionRequest(new Request(portal + '/api/auth/bgs/logout', { method:'POST', headers: { cookie: flow.sessionCookie, origin: portal } }),env))!
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('__Host-beeplay_bgs=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax')
  })
})
