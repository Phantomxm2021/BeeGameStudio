import { describe, expect, test, spyOn } from 'bun:test'
import { createBeeGameBillingAuthContext, createConfiguredBillingUserResolver } from '../auth'
import { createBeeGameBillingServerApp } from '../app'
import type { BeeGameBillingServerRepository } from '../supabase-billing-repository'

const env = { BEEGAME_SUPABASE_URL: 'https://offline.invalid', BEEGAME_SUPABASE_ANON_KEY: 'fixture-key' }

describe('billing authentication failures', () => {
  const request = (token = 'fixture-token') => new Request('http://localhost/api/usage-wallet', { headers: { authorization: `Bearer ${token}` } })

  test('coalesces and caches only the same verified credential', async () => {
    let lookups = 0
    const auth = createBeeGameBillingAuthContext({ currentUserResolver: createConfiguredBillingUserResolver(env, {
      fetchImpl: async () => { lookups++; await Promise.resolve(); return Response.json({ id: 'user', role: 'viewer' }) },
    }) })
    const results = await Promise.all(Array.from({ length: 4 }, () => auth.resolveRequestUser(request())))
    expect(results.every(user => user?.id === 'user')).toBe(true)
    await auth.resolveRequestUser(request())
    expect(lookups).toBe(1)
    await auth.resolveRequestUser(request('different-credential'))
    expect(lookups).toBe(2)
    const clock = spyOn(Date, 'now').mockReturnValue(Date.now() + 15_001)
    try { await auth.resolveRequestUser(request()); expect(lookups).toBe(3) }
    finally { clock.mockRestore() }
  })

  test('never serves a cached identity past JWT expiry or after rejection', async () => {
    const now = Date.now()
    const token = `header.${Buffer.from(JSON.stringify({ exp: (now + 1000) / 1000 })).toString('base64url')}.signature`
    let lookups = 0
    const auth = createBeeGameBillingAuthContext({ currentUserResolver: createConfiguredBillingUserResolver(env, {
      fetchImpl: async () => ++lookups === 1 ? Response.json({ id: 'user' }) : new Response('', { status: 401 }),
    }) })
    expect(await auth.resolveRequestUser(request(token))).toMatchObject({ id: 'user' })
    const clock = spyOn(Date, 'now').mockReturnValue(now + 1001)
    try {
      expect(await auth.resolveRequestUser(request(token))).toBeUndefined()
      expect(await auth.resolveRequestUser(request(token))).toBeUndefined()
      expect(lookups).toBe(3)
    } finally { clock.mockRestore() }
  })

  test('backs off failed cold lookups and recovers without logging out', async () => {
    let lookups = 0
    const auth = createBeeGameBillingAuthContext({ currentUserResolver: createConfiguredBillingUserResolver(env, {
      fetchImpl: async () => ++lookups === 1 ? new Response('', { status: 524 }) : Response.json({ id: 'user' }),
    }) })
    await expect(auth.resolveRequestUser(request())).rejects.toMatchObject({ reason: 'upstream', upstreamStatus: 524 })
    await expect(auth.resolveRequestUser(request())).rejects.toMatchObject({ reason: 'cooldown' })
    expect(lookups).toBe(1)
    const clock = spyOn(Date, 'now').mockReturnValue(Date.now() + 2001)
    try { expect(await auth.resolveRequestUser(request())).toMatchObject({ id: 'user' }); expect(lookups).toBe(2) }
    finally { clock.mockRestore() }
  })

  for (const [name, fetchImpl, status] of [
    ['upstream unavailable', async () => new Response('', { status: 503 }), 503],
    ['upstream rate limited', async () => new Response('', { status: 429 }), 503],
    ['network failure', async () => { throw new Error('offline failure') }, 503],
    ['malformed response', async () => new Response('not json'), 503],
    ['malformed identity', async () => Response.json({}), 503],
    ['invalid credential', async () => new Response('', { status: 401 }), 401],
    ['anonymous identity', async () => Response.json(null), 401],
    ['valid identity', async () => Response.json({ id: 'user' }), 200],
  ] as const) {
    test(`${name} returns ${status} without inventing an anonymous user`, async () => {
      let reads = 0
      const app = createBeeGameBillingServerApp({
        currentUserResolver: createConfiguredBillingUserResolver(env, { fetchImpl }),
        repository: { getUsageWalletForUser: async () => { reads++; return { balanceCreditsMicro: 42 } } } as unknown as BeeGameBillingServerRepository,
      })
      const response = await app.request('/api/usage-wallet', { headers: { authorization: 'Bearer fixture-token' } })
      expect(response.status).toBe(status)
      expect(reads).toBe(status === 200 ? 1 : 0)
      if (status === 503) {
        expect(await response.json()).toMatchObject({ code: 'authentication_unavailable', recoverable: true, retry_after_ms: 2000 })
        expect(response.headers.get('retry-after')).toBe('2')
      }
    })
  }

  test('timeout returns 503 and aborts the pending upstream lookup', async () => {
    let signal: AbortSignal | undefined
    const auth = createBeeGameBillingAuthContext({ userResolveTimeoutMs: 5,
      currentUserResolver: createConfiguredBillingUserResolver(env, { fetchImpl: async (_url, init) => {
        signal = init?.signal ?? undefined
        return new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      } }),
    })
    const app = createBeeGameBillingServerApp({ currentUserResolver: auth.resolveRequestUser,
      repository: {} as BeeGameBillingServerRepository })
    const response = await app.request('/api/usage-wallet', { headers: { authorization: 'Bearer fixture-token' } })
    expect(response.status).toBe(503)
    expect(signal?.aborted).toBe(true)
  })

  test('missing credentials remain 401 and do not call upstream', async () => {
    const app = createBeeGameBillingServerApp({ currentUserResolver: createConfiguredBillingUserResolver(env, {
      fetchImpl: async () => { throw new Error('Must not be called') },
    }), repository: {} as BeeGameBillingServerRepository })
    expect((await app.request('/api/usage-wallet')).status).toBe(401)
  })
})
