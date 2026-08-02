import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import {
  registerBeeGameSessionRoutes,
  resolveValidRequestAccessToken,
  SESSION_COOKIE_NAME,
} from '../auth/session-routes'
import { encryptSecret } from '../security/secret-crypto'

const originalFlag = process.env.BEEGAME_HTTPONLY_SESSIONS
const originalKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
const originalDataDir = process.env.AGENT_WORKFLOW_DATA_DIR
const temporaryDirectories: string[] = []

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beegame-session-routes-default-'))
  temporaryDirectories.push(directory)
  process.env.AGENT_WORKFLOW_DATA_DIR = directory
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })))
  if (originalFlag === undefined) delete process.env.BEEGAME_HTTPONLY_SESSIONS
  else process.env.BEEGAME_HTTPONLY_SESSIONS = originalFlag
  if (originalKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = originalKey
  if (originalDataDir === undefined) delete process.env.AGENT_WORKFLOW_DATA_DIR
  else process.env.AGENT_WORKFLOW_DATA_DIR = originalDataDir
})

function createApp(
  fetchImpl: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response> = fetch,
  sessionStorePath?: string,
) {
  process.env.BEEGAME_HTTPONLY_SESSIONS = '1'
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64')
  const app = new Hono()
  registerBeeGameSessionRoutes(app, {
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'anon-key',
    fetchImpl,
    sessionStorePath,
    isOriginAllowed: origin => origin === 'http://127.0.0.1:62173',
  })
  return app
}

async function createSessionStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'beegame-session-routes-'))
  temporaryDirectories.push(directory)
  return join(directory, 'sessions.json')
}

function supabaseFetch(userId = 'user-1') {
  return async (
    input: Parameters<typeof fetch>[0],
    _init?: Parameters<typeof fetch>[1],
  ) => {
    if (String(input).includes('/token?grant_type=refresh_token')) {
      return Response.json({ access_token: 'refreshed-access-token', expires_in: 3600 })
    }
    expect(String(input)).toBe('https://project.supabase.co/auth/v1/user')
    return Response.json({ id: userId, email: 'user@example.com' })
  }
}

describe('HttpOnly session routes', () => {
  it('prefers a refreshed HttpOnly session token over a stale bearer token', async () => {
    const request = new Request('http://localhost/api/projects/project-1/workflow', {
      headers: { authorization: 'Bearer expired-bearer-token' },
    })
    const token = await resolveValidRequestAccessToken(request, {
      getAccessToken: () => undefined,
      getValidAccessToken: async () => 'refreshed-session-token',
    })

    expect(token).toBe('refreshed-session-token')
  })

  it('falls back to a bearer token when no refreshable session exists', async () => {
    const request = new Request('http://localhost/api/projects/project-1/workflow', {
      headers: { authorization: 'Bearer current-bearer-token' },
    })

    expect(await resolveValidRequestAccessToken(request)).toBe(
      'current-bearer-token',
    )
  })

  it('does not reuse a stale bearer token when a cookie session cannot refresh', async () => {
    const request = new Request('http://localhost/api/projects/project-1/workflow', {
      headers: {
        authorization: 'Bearer expired-bearer-token',
        cookie: `${SESSION_COOKIE_NAME}=session-1`,
      },
    })
    const token = await resolveValidRequestAccessToken(request, {
      getAccessToken: () => undefined,
      getValidAccessToken: async () => undefined,
    })

    expect(token).toBeUndefined()
  })

  it('sets a Secure HttpOnly Lax root cookie and refreshes from the cookie', async () => {
    const app = createApp(supabaseFetch())
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
      }),
    })

    expect(sessionResponse.status).toBe(200)
    const cookie = sessionResponse.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=2592000')

    const cookieValue = cookie.split(';', 1)[0]
    const refreshResponse = await app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        cookie: cookieValue,
      },
    })
    expect(refreshResponse.status).toBe(200)
  })

  it('rejects cross-origin cookie mutations and logs out a valid session', async () => {
    const app = createApp(supabaseFetch())
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token' }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(';', 1)[0]

    const csrfResponse = await app.request('/api/auth/session/logout', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', cookie },
    })
    expect(csrfResponse.status).toBe(403)

    const logoutResponse = await app.request('/api/auth/session/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })
    expect(logoutResponse.status).toBe(200)
    expect(logoutResponse.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('allows cookie refresh from a separately hosted trusted dashboard origin', async () => {
    const app = createApp(supabaseFetch())
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token' }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(';', 1)[0]

    const refreshResponse = await app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:62173', cookie },
    })

    expect(refreshResponse.status).toBe(200)
  })

  it('persists a session across route registration', async () => {
    const storePath = await createSessionStorePath()
    const firstApp = createApp(supabaseFetch(), storePath)
    const sessionResponse = await firstApp.request('/api/auth/session', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token' }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(';', 1)[0]

    const restartedApp = createApp(supabaseFetch(), storePath)
    const persistedResponse = await restartedApp.request('/api/auth/session', {
      headers: { cookie },
    })

    expect(persistedResponse.status).toBe(200)
    expect(await persistedResponse.json()).toMatchObject({
      authenticated: true,
      user: { id: 'user-1' },
    })
  })

  it('persists refresh updates and logout deletion', async () => {
    const storePath = await createSessionStorePath()
    const firstApp = createApp(supabaseFetch(), storePath)
    const sessionResponse = await firstApp.request('/api/auth/session', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token' }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(';', 1)[0]

    const refreshedApp = createApp(supabaseFetch(), storePath)
    const refreshResponse = await refreshedApp.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })
    expect(refreshResponse.status).toBe(200)

    const logoutApp = createApp(supabaseFetch(), storePath)
    const logoutResponse = await logoutApp.request('/api/auth/session/logout', {
      method: 'DELETE',
      headers: { origin: 'http://localhost', cookie },
    })
    expect(logoutResponse.status).toBe(200)

    const afterLogoutApp = createApp(supabaseFetch(), storePath)
    expect((await afterLogoutApp.request('/api/auth/session', { headers: { cookie } })).status)
      .toBe(401)
  })

  it('ignores records whose refresh-capable session lifetime has expired', async () => {
    const storePath = await createSessionStorePath()
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64')
    const sessionId = 'expired-session-id'
    const record = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1,
      sessionExpiresAt: Date.now() - 1,
      user: { id: 'user-1', role: 'viewer' },
    }
    await Bun.write(storePath, JSON.stringify({
      [sessionId]: encryptSecret(JSON.stringify(record), 'auth:session'),
    }))

    const app = createApp(supabaseFetch(), storePath)
    const response = await app.request('/api/auth/session', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    })

    expect(response.status).toBe(401)
  })

  it('refreshes an expired access token while the cookie session remains valid', async () => {
    const storePath = await createSessionStorePath()
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64')
    const sessionId = 'refreshable-expired-access-token'
    const record = {
      accessToken: 'expired-access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1,
      sessionExpiresAt: Date.now() + 60_000,
      user: { id: 'user-1', role: 'viewer' },
    }
    await Bun.write(storePath, JSON.stringify({
      [sessionId]: encryptSecret(JSON.stringify(record), 'auth:session'),
    }))

    const app = createApp(supabaseFetch(), storePath)
    const cookie = `${SESSION_COOKIE_NAME}=${sessionId}`
    expect((await app.request('/api/auth/session', { headers: { cookie } })).status).toBe(200)

    const refreshResponse = await app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })

    expect(refreshResponse.status).toBe(200)
    expect(await refreshResponse.json()).toMatchObject({ authenticated: true })
  })

  it('proactively refreshes a near-expiry token for a background workflow dispatch', async () => {
    const storePath = await createSessionStorePath()
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64')
    const sessionId = 'background-workflow-session'
    const record = {
      accessToken: 'expired-access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 20_000,
      sessionExpiresAt: Date.now() + 60_000,
      user: { id: 'user-1', role: 'viewer' },
    }
    await Bun.write(storePath, JSON.stringify({
      [sessionId]: encryptSecret(JSON.stringify(record), 'auth:session'),
    }))
    process.env.BEEGAME_HTTPONLY_SESSIONS = '1'
    const app = new Hono()
    const auth = registerBeeGameSessionRoutes(app, {
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'anon-key',
      fetchImpl: supabaseFetch(),
      sessionStorePath: storePath,
    })
    const request = new Request('http://localhost/api/projects/project-1/workflow', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    })

    expect(await auth?.getValidAccessToken(request)).toBe('refreshed-access-token')
    expect(auth?.getAccessToken(request)).toBe('refreshed-access-token')
    const credential = auth?.getCredential?.(request)
    expect(credential).toBeDefined()
    expect(
      await credential?.getValidAccessToken({ forceRefresh: true }),
    ).toBe('refreshed-access-token')
  })

  it('preserves the cookie session when the auth provider refresh is temporarily unavailable', async () => {
    let refreshUnavailable = false
    const app = createApp(async input => {
      if (String(input).includes('/token?grant_type=refresh_token')) {
        return refreshUnavailable
          ? new Response('upstream unavailable', { status: 503 })
          : Response.json({ access_token: 'refreshed-access-token', expires_in: 3600 })
      }
      return Response.json({ id: 'user-1', email: 'user@example.com' })
    })
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token' }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(';', 1)[0]
    refreshUnavailable = true

    const refreshResponse = await app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })

    expect(refreshResponse.status).toBe(503)
    expect((await app.request('/api/auth/session', { headers: { cookie } })).status).toBe(200)
  })

  it('coalesces concurrent refreshes so a rotated refresh token is consumed once', async () => {
    let refreshCalls = 0
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve
    })
    const app = createApp(async input => {
      if (String(input).includes('/token?grant_type=refresh_token')) {
        refreshCalls += 1
        await refreshGate
        return Response.json({
          access_token: 'refreshed-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
        })
      }
      return Response.json({ id: 'user-1', email: 'user@example.com' })
    })
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token' }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(';', 1)[0]

    const first = app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })
    const second = app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })
    await Promise.resolve()
    releaseRefresh?.()
    const responses = await Promise.all([first, second])

    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(refreshCalls).toBe(1)
  })

  it('leaves legacy behavior untouched when the flag is disabled', async () => {
    process.env.BEEGAME_HTTPONLY_SESSIONS = '0'
    const app = new Hono()
    const routes = registerBeeGameSessionRoutes(app, { fetchImpl: fetch })
    expect(routes).toBeUndefined()
    expect((await app.request('/api/auth/session')).status).toBe(404)
  })
})
