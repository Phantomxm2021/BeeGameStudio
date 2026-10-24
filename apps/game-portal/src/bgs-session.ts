import { openPortalPayload, portalNonce, sealPortalPayload, portalTokenExpiry } from '../../../packages/beegame-security-core/src/portal-sso'

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type Env = {
  BEEGAME_PORTAL_SSO_SECRET?: string
  BEEGAME_STUDIO_ORIGIN?: string
  BEEGAME_SUPABASE_URL: string
  BEEGAME_SUPABASE_ANON_KEY?: string
}
type Session = { accessToken: string; expiresAt: number; user: { id: string; email?: string; displayName?: string } }
const sessionName = '__Host-beeplay_bgs'
const stateName = '__Host-beeplay_sso_state'
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const cookie = (name: string, value: string, age: number) => `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`
function readCookie(request: Request, name: string) {
  return (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) || ''
}
export function studioOrigin(env: Env): string | null {
  try {
    const url = new URL(env.BEEGAME_STUDIO_ORIGIN || '')
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
      (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ? url.origin : null
  } catch { return null }
}
async function readSession(request: Request, env: Env): Promise<Session | null> {
  if (!env.BEEGAME_PORTAL_SSO_SECRET) return null
  const value = await openPortalPayload(env.BEEGAME_PORTAL_SSO_SECRET, `beeplay-session:${new URL(request.url).origin}`, readCookie(request, sessionName))
  if (!value || typeof value.accessToken !== 'string' || !value.user || typeof value.user !== 'object' || typeof (value.user as {id?: unknown}).id !== 'string') return null
  if (portalTokenExpiry(value.accessToken) < Number(value.expiresAt)) return null
  return value as Session
}
async function rpc(env: Env, token: string, name: string, body: unknown, fetchImpl: FetchImplementation) {
  if (!env.BEEGAME_SUPABASE_ANON_KEY) return json({ error: 'unavailable' }, 503)
  try {
    const response = await fetchImpl(new URL('/rest/v1/rpc/' + name, env.BEEGAME_SUPABASE_URL), {
      method: 'POST', headers: { apikey: env.BEEGAME_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return json({ error: 'request_failed' }, [400, 401, 403].includes(response.status) ? response.status : 503)
    return json(await response.json())
  } catch { return json({ error: 'unavailable' }, 503) }
}
export async function handleBgsSessionRequest(request: Request, env: Env, fetchImpl: FetchImplementation = fetch): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname
  if (!path.startsWith('/auth/bgs/') && !path.startsWith('/api/auth/bgs/') && !path.startsWith('/api/admin/beeplay/')) return null
  const secret = env.BEEGAME_PORTAL_SSO_SECRET
  const redirect = (path: string, cookies: string[] = []) => {
    const result = new Response(null, { status: 303, headers: { ...headers, location: new URL(path, url.origin).href } })
    for (const value of cookies) result.headers.append('set-cookie', value)
    return result
  }
  if (path === '/auth/bgs/start' && request.method === 'GET') {
    const issuer = studioOrigin(env)
    if (!secret || !issuer) return redirect('/admin?bgs=unavailable')
    const state = portalNonce()
    const stateCookie = await sealPortalPayload(secret, `beeplay-state:${url.origin}`, { state, expiresAt: Date.now() + 120_000 })
    const target = new URL('/api/auth/portal/authorize', issuer)
    target.searchParams.set('state', state)
    const response = redirect(target.href, [cookie(stateName, stateCookie, 120)])
    return response
  }
  if (path === '/auth/bgs/callback' && request.method === 'GET') {
    const state = secret ? await openPortalPayload(secret, `beeplay-state:${url.origin}`, readCookie(request, stateName)) : null
    const clearState = cookie(stateName, '', 0)
    if (!state || state.state !== url.searchParams.get('state')) return redirect('/admin?bgs=invalid', [clearState])
    if (url.searchParams.has('error')) return redirect('/admin?bgs=' + (url.searchParams.get('error') === 'forbidden' ? 'forbidden' : 'login_required'), [clearState])
    const grant = await openPortalPayload(secret!, `bgs-grant:${url.origin}`, url.searchParams.get('grant') || '')
    if (!grant || grant.state !== state.state || typeof grant.accessToken !== 'string' || !grant.user || typeof grant.user !== 'object' || typeof (grant.user as {id?: unknown}).id !== 'string') return redirect('/admin?bgs=invalid', [clearState])
    const expiresAt = Math.min(portalTokenExpiry(grant.accessToken), Number(grant.tokenExpiresAt))
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return redirect('/admin?bgs=invalid', [clearState])
    // Recheck platform ownership in the same database used by the admin RPCs.
    const owner = await rpc(env, grant.accessToken, 'beegame_is_platform_owner', {}, fetchImpl)
    if (!owner.ok || await owner.json() !== true) return redirect('/admin?bgs=forbidden', [clearState])
    const value = await sealPortalPayload(secret!, `beeplay-session:${url.origin}`, { accessToken: grant.accessToken, expiresAt, user: grant.user })
    if (value.length > 3800) return redirect('/admin?bgs=unavailable', [clearState])
    return redirect('/admin', [clearState, cookie(sessionName, value, Math.ceil((expiresAt - Date.now()) / 1000))])
  }
  if (path === '/api/auth/bgs/session' && request.method === 'GET') {
    const session = await readSession(request, env)
    return session ? json({ user: session.user, expiresAt: session.expiresAt }) : json({ authenticated: false }, 401)
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (request.headers.get('origin') !== url.origin) return json({ error: 'forbidden_origin' }, 403)
  if (path === '/api/auth/bgs/logout') {
    const response = json({ ok: true })
    response.headers.append('set-cookie', cookie(sessionName, '', 0))
    return response
  }
  const names: Record<string, string> = { overview: 'beegame_admin_portal_overview', featured: 'beegame_admin_portal_featured', owner: 'beegame_is_platform_owner' }
  const shortName = path.slice('/api/admin/beeplay/'.length)
  const name = Object.hasOwn(names, shortName) ? names[shortName] : undefined
  if (!path.startsWith('/api/admin/beeplay/') || !name) return json({ error: 'not_found' }, 404)
  const session = await readSession(request, env)
  if (!session) return json({ error: 'unauthorized' }, 401)
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'bad_request' }, 400)
  const body = await request.text()
  if (body.length > 4096) return json({ error: 'bad_request' }, 400)
  try { return await rpc(env, session.accessToken, name, JSON.parse(body), fetchImpl) }
  catch { return json({ error: 'bad_request' }, 400) }
}
