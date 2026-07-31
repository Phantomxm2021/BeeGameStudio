import { describe, expect, test } from 'bun:test'
import { SESSION_COOKIE_NAME } from '../auth/session-routes'
import { proxyAuthenticatedBillingRequest } from '../auth/authenticated-billing-proxy'

const billingConfig = {
  mode: 'remote' as const,
  usageBillingMode: 'realtime' as const,
  remoteApiBaseUrl: 'https://billing.beegame.test',
}

describe('authenticated billing proxy', () => {
  test('replaces a stale browser bearer with the refreshed HttpOnly session token', async () => {
    const forwarded: Array<{
      url: string
      authorization: string | null
      cookie: string | null
    }> = []
    const response = await proxyAuthenticatedBillingRequest(
      new Request('https://runtime.beegame.test/api/usage-wallet', {
        headers: {
          authorization: 'Bearer stale-browser-token',
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
        },
      }),
      billingConfig,
      '/api/usage-wallet',
      {
        getAccessToken: () => 'stale-session-token',
        getValidAccessToken: async () => 'refreshed-session-token',
      },
      async (input, init) => {
        forwarded.push({
          url: String(input),
          authorization: new Headers(init?.headers).get('authorization'),
          cookie: new Headers(init?.headers).get('cookie'),
        })
        return Response.json({ available_credits: 25 })
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ available_credits: 25 })
    expect(forwarded).toEqual([{
      url: 'https://billing.beegame.test/api/usage-wallet',
      authorization: 'Bearer refreshed-session-token',
      cookie: null,
    }])
  })

  test('does not fall back to a stale bearer when an HttpOnly session cannot refresh', async () => {
    let forwarded = false
    const response = await proxyAuthenticatedBillingRequest(
      new Request('https://runtime.beegame.test/api/usage-wallet', {
        headers: {
          authorization: 'Bearer stale-browser-token',
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
        },
      }),
      billingConfig,
      '/api/usage-wallet',
      {
        getAccessToken: () => 'stale-session-token',
        getValidAccessToken: async () => undefined,
      },
      async () => {
        forwarded = true
        return Response.json({})
      },
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      message: 'authentication required',
    })
    expect(forwarded).toBe(false)
  })

  test('preserves bearer authentication when no HttpOnly session is configured', async () => {
    const forwardedAuthorizations: Array<string | null> = []
    const response = await proxyAuthenticatedBillingRequest(
      new Request('https://runtime.beegame.test/api/usage/summary', {
        headers: { authorization: 'Bearer current-browser-token' },
      }),
      billingConfig,
      '/api/usage/summary?projectId=project-1',
      undefined,
      async (_input, init) => {
        forwardedAuthorizations.push(
          new Headers(init?.headers).get('authorization'),
        )
        return Response.json({ eventsCount: 0 })
      },
    )

    expect(response.status).toBe(200)
    expect(forwardedAuthorizations).toEqual(['Bearer current-browser-token'])
  })

  test('preserves a remote billing POST body after injecting session authentication', async () => {
    const forwardedBodies: string[] = []
    const response = await proxyAuthenticatedBillingRequest(
      new Request('https://runtime.beegame.test/api/payments/stripe/checkout-session', {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ priceId: 'price-1' }),
      }),
      billingConfig,
      '/api/payments/stripe/checkout-session',
      {
        getAccessToken: () => 'current-session-token',
        getValidAccessToken: async () => 'current-session-token',
      },
      async (_input, init) => {
        forwardedBodies.push(String(init?.body ?? ''))
        return Response.json({ id: 'checkout-1' })
      },
    )

    expect(response.status).toBe(200)
    expect(forwardedBodies).toEqual(['{"priceId":"price-1"}'])
  })
})
