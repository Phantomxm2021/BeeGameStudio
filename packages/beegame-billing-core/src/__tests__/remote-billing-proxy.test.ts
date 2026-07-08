import { describe, expect, test } from 'bun:test'
import {
  buildBeeGameBillingUrl,
  proxyBeeGameBillingRequest,
} from '../remote-billing-proxy'

describe('remote-billing-proxy', () => {
  test('builds billing service URLs without double slashes', () => {
    expect(buildBeeGameBillingUrl(
      'https://billing.beegame.test/base/',
      '/api/payments/stripe/credit-packs',
    )).toBe('https://billing.beegame.test/base/api/payments/stripe/credit-packs')
  })

  test('returns unavailable when remote billing base URL is missing', async () => {
    const response = await proxyBeeGameBillingRequest(
      new Request('https://runtime.beegame.test/api/payments/stripe/credit-packs'),
      { mode: 'remote' },
      '/api/payments/stripe/credit-packs',
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Remote billing failed',
      message: 'BEEGAME_BILLING_API_BASE_URL is required for remote billing mode',
    })
  })

  test('forwards request body and selected headers to remote billing', async () => {
    const forwarded: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = []
    const response = await proxyBeeGameBillingRequest(
      new Request('https://runtime.beegame.test/api/payments/stripe/checkout-session', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-token',
          origin: 'https://app.beegame.test',
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ priceId: 'price_500' }),
      }),
      {
        mode: 'remote',
        remoteApiBaseUrl: 'https://billing.beegame.test',
      },
      '/api/payments/stripe/checkout-session',
      async (input, init) => {
        const headers = new Headers(init?.headers)
        forwarded.push({
          url: String(input),
          method: String(init?.method),
          headers: Object.fromEntries(headers.entries()),
          body: String(init?.body ?? ''),
        })
        return Response.json({ id: 'cs_test' }, {
          headers: { 'content-type': 'application/json' },
        })
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ id: 'cs_test' })
    expect(forwarded).toEqual([{
      url: 'https://billing.beegame.test/api/payments/stripe/checkout-session',
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer user-token',
        'content-type': 'application/json',
        origin: 'https://app.beegame.test',
      },
      body: '{"priceId":"price_500"}',
    }])
  })
})
