import type { Hono } from 'hono'
import type { BeeGameUserContext } from './user-context'
import { portalTokenExpiry, sealPortalPayload } from '../../../beegame-security-core/src/portal-sso'

export function registerPortalSsoRoutes(app: Hono, options: {
  resolveUser(request: Request): Promise<BeeGameUserContext | undefined>
  getAccessToken(request: Request): Promise<string | undefined>
  env?: Record<string, string | undefined>
}) {
  const env = options.env ?? process.env
  // A fixed callback prevents this route from forwarding credentials to a
  // caller-supplied host. Only an existing HttpOnly session is used here.
  app.get('/api/auth/portal/authorize', async c => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    const secret = env.BEEGAME_PORTAL_SSO_SECRET
    const portal = new URL(env.BEEGAME_GAME_PORTAL_BASE_URL || 'https://portal.beegame.studio')
    const state = c.req.query('state') || ''
    if (!secret || portal.protocol !== 'https:' || !/^[A-Za-z0-9_-]{43}$/.test(state)) return c.json({ error: 'SSO unavailable' }, 400)
    const callback = new URL('/auth/bgs/callback', portal)
    callback.searchParams.set('state', state)
    const user = await options.resolveUser(c.req.raw)
    const token = user?.role === 'owner' ? await options.getAccessToken(c.req.raw) : undefined
    const tokenExpiresAt = token ? portalTokenExpiry(token) : 0
    if (!user || !token || tokenExpiresAt <= Date.now()) {
      callback.searchParams.set('error', user ? 'forbidden' : 'login_required')
      return c.redirect(callback.href, 303)
    }
    const grant = await sealPortalPayload(secret, `bgs-grant:${portal.origin}`, {
      state, accessToken: token, tokenExpiresAt,
      user: { id: user.id, ...(user.email ? { email: user.email } : {}), ...(user.displayName ? { displayName: user.displayName } : {}) },
      expiresAt: Date.now() + 60_000,
    })
    callback.searchParams.set('grant', grant)
    return c.redirect(callback.href, 303)
  })
}
