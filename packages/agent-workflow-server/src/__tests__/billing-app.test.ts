import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBeeGameBillingApp } from '../billing-app'

describe('BeeGame billing app', () => {
  test('serves Stripe credit packs and checkout without project runtime routes', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-billing-app-'))
    const originalSecretKey = process.env.BEEGAME_STRIPE_SECRET_KEY
    const originalMapping = process.env.BEEGAME_STRIPE_PRICE_CREDITS
    const originalFetch = globalThis.fetch
    const stripeRequests: Array<{ url: string; authorization: string | null; body: string }> = []
    try {
      process.env.BEEGAME_STRIPE_SECRET_KEY = 'sk_test_checkout'
      process.env.BEEGAME_STRIPE_PRICE_CREDITS = JSON.stringify({
        price_beegame_500: 500,
      })
      globalThis.fetch = (async (input, init) => {
        const headers = new Headers(init?.headers)
        stripeRequests.push({
          url: String(input),
          authorization: headers.get('authorization'),
          body: String(init?.body ?? ''),
        })
        return Response.json({
          id: 'cs_billing_checkout',
          url: 'https://checkout.stripe.com/c/pay/cs_billing_checkout',
        })
      }) as typeof fetch

      const billingApp = createBeeGameBillingApp({
        dashboardDataRoot: projectsRoot,
        currentUser: {
          id: 'customer-a',
          email: 'customer@example.com',
          role: 'developer',
        },
      })

      const healthRes = await billingApp.request('/health')
      expect(healthRes.status).toBe(200)
      expect(await healthRes.json()).toEqual({ status: 'ok', service: 'beegame-billing' })

      const runtimeRouteRes = await billingApp.request('/api/projects')
      expect(runtimeRouteRes.status).toBe(404)

      const packsRes = await billingApp.request('/api/payments/stripe/credit-packs')
      expect(packsRes.status).toBe(200)
      expect(await packsRes.json()).toEqual({
        packs: [{ priceId: 'price_beegame_500', credits: 500 }],
      })

      const checkoutRes = await billingApp.request('/api/payments/stripe/checkout-session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://app.beegame.example',
        },
        body: JSON.stringify({ priceId: 'price_beegame_500' }),
      })
      expect(checkoutRes.status).toBe(200)
      expect(await checkoutRes.json()).toEqual({
        id: 'cs_billing_checkout',
        url: 'https://checkout.stripe.com/c/pay/cs_billing_checkout',
        credits: 500,
        priceId: 'price_beegame_500',
      })
      expect(stripeRequests).toHaveLength(1)
      expect(stripeRequests[0]).toEqual(expect.objectContaining({
        url: 'https://api.stripe.com/v1/checkout/sessions',
        authorization: 'Bearer sk_test_checkout',
      }))
      expect(stripeRequests[0].body).toContain('metadata%5BbeeGameUserId%5D=customer-a')
    } finally {
      if (originalSecretKey === undefined) {
        delete process.env.BEEGAME_STRIPE_SECRET_KEY
      } else {
        process.env.BEEGAME_STRIPE_SECRET_KEY = originalSecretKey
      }
      if (originalMapping === undefined) {
        delete process.env.BEEGAME_STRIPE_PRICE_CREDITS
      } else {
        process.env.BEEGAME_STRIPE_PRICE_CREDITS = originalMapping
      }
      globalThis.fetch = originalFetch
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })
})
