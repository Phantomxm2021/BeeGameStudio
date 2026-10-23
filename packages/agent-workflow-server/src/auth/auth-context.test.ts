import { describe, expect, it } from 'bun:test'
import { createBeeGameAuthContext } from './auth-context'
import { BeeGameAuthUnavailableError, getBearerToken } from './user-context'
import { DashboardRepository } from '../dashboard-repository'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'

describe('request authentication credentials', () => {
  it('pins the verified token through the request even when the session crosses its refresh boundary', async () => {
    let sessionToken: string | undefined = 'fresh-cookie-token'
    let resolutions = 0
    const auth = createBeeGameAuthContext({
      resolveAccessToken: async () => { resolutions++; return sessionToken },
      currentUserResolver: request => {
        expect(getBearerToken(request)).toBe('fresh-cookie-token')
        sessionToken = undefined // The synchronous session reader would now refuse it.
        return { id: 'owner', role: 'owner' }
      },
    })
    const request = new Request('http://localhost/api/projects/p/events/stream', {
      headers: { authorization: 'Bearer stale-header-token' },
    })
    expect(auth.getAccessToken(request)).toBeUndefined()
    await auth.resolveRequestUser(request)
    expect(auth.getCurrentUser(request).id).toBe('owner')
    expect(auth.getAccessToken(request)).toBe('fresh-cookie-token')
    expect(auth.getAccessToken(request)).toBe('fresh-cookie-token')
    expect(resolutions).toBe(1)
    expect(auth.getAccessToken(new Request(request))).toBeUndefined()
  })

  it('isolates users and resolves a fresh credential on the next request', async () => {
    const auth = createBeeGameAuthContext({ currentUserResolver: request => ({
      id: getBearerToken(request)!, role: 'owner',
    }) })
    const first = new Request('http://localhost/api', { headers: { authorization: 'Bearer first' } })
    const next = new Request('http://localhost/api', { headers: { authorization: 'Bearer next' } })
    await Promise.all([auth.resolveRequestUser(first), auth.resolveRequestUser(next)])
    expect(auth.getAccessToken(first)).toBe('first')
    expect(auth.getCurrentUser(next).id).toBe('next')
    expect(auth.getAccessToken(next)).toBe('next')
  })

  it('supplies the verified cookie token to the project-session repository after the session changes', async () => {
    let token: string | undefined = 'cookie-token'
    const auth = createBeeGameAuthContext({
      resolveAccessToken: async () => token,
      currentUserResolver: () => ({ id: 'owner', role: 'owner' }),
    })
    const sentTokens: Array<string | null> = []
    const repository = new DashboardRepository({
      dashboardDataRoot: '/unused-test-root', getUserDataRoot: () => '/unused-test-root',
      getAuthToken: auth.getAccessToken,
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://supabase.test', anonKey: 'test-key',
        fetchImpl: async (input, init) => {
          expect(String(input)).toContain('/rest/v1/beegame_sessions?')
          sentTokens.push(new Headers(init?.headers).get('authorization'))
          return Response.json([])
        },
      }),
    })
    const request = new Request('http://localhost/api/projects/p/events/stream', {
      headers: { cookie: 'beegame_session=test' },
    })
    await auth.resolveRequestUser(request)
    token = undefined
    await expect(repository.listProjectSessions(request, auth.getCurrentUser(request), 'p')).resolves.toEqual([])
    expect(sentTokens).toEqual(['Bearer cookie-token'])
  })

  it('does not fall back to stale bearer credentials when cookie authentication fails', async () => {
    const auth = createBeeGameAuthContext({
      resolveAccessToken: async () => undefined,
      currentUserResolver: request => {
        expect(getBearerToken(request)).toBeUndefined()
        return undefined
      },
    })
    const request = new Request('http://localhost/api', { headers: { authorization: 'Bearer stale' } })
    expect(await auth.resolveRequestUser(request)).toBeUndefined()
    expect(auth.getAccessToken(request)).toBeUndefined()
    expect(() => auth.getCurrentUser(request)).toThrow()
  })

  it('preserves transient failures and stores no credential until authentication succeeds', async () => {
    const auth = createBeeGameAuthContext({
      resolveAccessToken: async () => { throw new BeeGameAuthUnavailableError() },
      currentUserResolver: () => ({ id: 'owner', role: 'owner' }),
    })
    const request = new Request('http://localhost/api')
    await expect(auth.resolveRequestUser(request)).rejects.toBeInstanceOf(BeeGameAuthUnavailableError)
    expect(auth.getAccessToken(request)).toBeUndefined()
  })

  it('does not install credentials if authentication completes after its deadline', async () => {
    let finish!: (user: { id: string; role: 'owner' }) => void
    const auth = createBeeGameAuthContext({
      userResolveTimeoutMs: 5,
      resolveAccessToken: async () => 'fresh',
      currentUserResolver: () => new Promise(resolve => { finish = resolve }),
    })
    const request = new Request('http://localhost/api')
    await expect(auth.resolveRequestUser(request)).rejects.toBeInstanceOf(BeeGameAuthUnavailableError)
    finish({ id: 'owner', role: 'owner' })
    await Promise.resolve()
    expect(auth.getAccessToken(request)).toBeUndefined()
  })
})
