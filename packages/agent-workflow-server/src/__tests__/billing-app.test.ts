import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBeeGameBillingApp } from '../billing-app'

describe('BeeGame billing app', () => {
  test('fails fast when request user resolution stalls', async () => {
    const originalTimeout = process.env.BEEGAME_AUTH_RESOLVE_TIMEOUT_MS
    try {
      process.env.BEEGAME_AUTH_RESOLVE_TIMEOUT_MS = '5'
      const billingApp = createBeeGameBillingApp({
        currentUserResolver: () => new Promise(() => {}),
      })

      const result = await Promise.race([
        billingApp.request('/api/payments/stripe/credit-packs', {
          headers: { authorization: 'Bearer stalled-token' },
        }),
        new Promise<'timed-out'>(resolve => setTimeout(() => resolve('timed-out'), 100)),
      ])

      expect(result).not.toBe('timed-out')
      expect((result as Response).status).toBe(401)
      expect(await (result as Response).json()).toEqual({
        error: 'Unauthorized',
        message: 'authentication required',
      })
    } finally {
      if (originalTimeout === undefined) {
        delete process.env.BEEGAME_AUTH_RESOLVE_TIMEOUT_MS
      } else {
        process.env.BEEGAME_AUTH_RESOLVE_TIMEOUT_MS = originalTimeout
      }
    }
  })

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

  test('prefers Supabase billing credit packs and records checkout audit events', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-billing-db-packs-'))
    const originalSupabaseUrl = process.env.BEEGAME_SUPABASE_URL
    const originalServiceRole = process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
    const originalSecretKey = process.env.BEEGAME_STRIPE_SECRET_KEY
    const originalMapping = process.env.BEEGAME_STRIPE_PRICE_CREDITS
    const originalBillingMode = process.env.BEEGAME_BILLING_MODE
    const originalFetch = globalThis.fetch
    const supabaseRequests: Array<{ url: string; method: string; body: unknown }> = []
    try {
      process.env.BEEGAME_BILLING_MODE = 'server'
      process.env.BEEGAME_SUPABASE_URL = 'https://supabase.beegame.test'
      process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY = 'service_role_test'
      process.env.BEEGAME_STRIPE_SECRET_KEY = 'sk_test_checkout'
      process.env.BEEGAME_STRIPE_PRICE_CREDITS = JSON.stringify({
        price_env_100: 100,
      })
      globalThis.fetch = (async (input, init) => {
        const url = String(input)
        const method = String(init?.method ?? 'GET')
        const bodyText = typeof init?.body === 'string' ? init.body : ''
        if (url.includes('/rest/v1/beegame_billing_credit_packs')) {
          supabaseRequests.push({ url, method, body: bodyText ? JSON.parse(bodyText) : undefined })
          return Response.json([
            {
              id: 'pack-db-500',
              provider: 'stripe',
              price_id: 'price_db_500',
              credits: 500,
              display_name: '500 credits',
              enabled: true,
              sort_order: 1,
              metadata: { tier: 'starter' },
              created_at: '2026-07-08T00:00:00.000Z',
              updated_at: '2026-07-08T00:00:00.000Z',
            },
          ])
        }
        if (url.includes('/rest/v1/beegame_billing_events')) {
          supabaseRequests.push({ url, method, body: bodyText ? JSON.parse(bodyText) : undefined })
          return Response.json([{ id: 'billing-event-1' }])
        }
        if (url === 'https://api.stripe.com/v1/checkout/sessions') {
          return Response.json({
            id: 'cs_db_checkout',
            url: 'https://checkout.stripe.com/c/pay/cs_db_checkout',
          })
        }
        return Response.json({ error: 'unexpected request' }, { status: 500 })
      }) as typeof fetch

      const billingApp = createBeeGameBillingApp({
        dashboardDataRoot: projectsRoot,
        currentUser: {
          id: 'customer-a',
          email: 'customer@example.com',
          role: 'developer',
        },
      })

      const packsRes = await billingApp.request('/api/payments/stripe/credit-packs')
      expect(packsRes.status).toBe(200)
      expect(await packsRes.json()).toEqual({
        packs: [{
          priceId: 'price_db_500',
          credits: 500,
          displayName: '500 credits',
        }],
      })

      const checkoutRes = await billingApp.request('/api/payments/stripe/checkout-session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://app.beegame.example',
        },
        body: JSON.stringify({ priceId: 'price_db_500' }),
      })
      expect(checkoutRes.status).toBe(200)
      expect(await checkoutRes.json()).toEqual({
        id: 'cs_db_checkout',
        url: 'https://checkout.stripe.com/c/pay/cs_db_checkout',
        credits: 500,
        priceId: 'price_db_500',
      })

      expect(supabaseRequests.some(request =>
        request.url.includes('/rest/v1/beegame_billing_credit_packs') &&
        request.method === 'GET'
      )).toBe(true)
      expect(supabaseRequests).toContainEqual(expect.objectContaining({
        url: expect.stringContaining('/rest/v1/beegame_billing_events'),
        method: 'POST',
        body: expect.objectContaining({
          provider: 'stripe',
          event_type: 'checkout.session.created',
          status: 'succeeded',
          user_id: 'customer-a',
          price_id: 'price_db_500',
          credits: 500,
          checkout_session_id: 'cs_db_checkout',
        }),
      }))
    } finally {
      if (originalSupabaseUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalSupabaseUrl
      }
      if (originalServiceRole === undefined) {
        delete process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
      } else {
        process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY = originalServiceRole
      }
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
      if (originalBillingMode === undefined) {
        delete process.env.BEEGAME_BILLING_MODE
      } else {
        process.env.BEEGAME_BILLING_MODE = originalBillingMode
      }
      globalThis.fetch = originalFetch
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('exposes permission-gated admin billing packs and events', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-billing-admin-'))
    const originalSupabaseUrl = process.env.BEEGAME_SUPABASE_URL
    const originalServiceRole = process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
    const originalBillingMode = process.env.BEEGAME_BILLING_MODE
    const originalFetch = globalThis.fetch
    const supabaseRequests: Array<{ url: string; method: string; body: unknown }> = []
    try {
      process.env.BEEGAME_BILLING_MODE = 'server'
      process.env.BEEGAME_SUPABASE_URL = 'https://supabase.beegame.test'
      process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY = 'service_role_test'
      globalThis.fetch = (async (input, init) => {
        const url = String(input)
        const method = String(init?.method ?? 'GET')
        const bodyText = typeof init?.body === 'string' ? init.body : ''
        const body = bodyText ? JSON.parse(bodyText) : undefined
        supabaseRequests.push({ url, method, body })
        if (url.includes('/rest/v1/beegame_billing_credit_packs') && method === 'POST') {
          return Response.json([{
            id: 'pack-db-1200',
            provider: 'stripe',
            price_id: 'price_db_1200',
            credits: 1200,
            display_name: '1,200 credits',
            enabled: true,
            sort_order: 2,
            metadata: { tier: 'growth' },
            created_at: '2026-07-08T00:00:00.000Z',
            updated_at: '2026-07-08T00:00:00.000Z',
          }])
        }
        if (url.includes('/rest/v1/beegame_billing_credit_packs')) {
          return Response.json([{
            id: 'pack-db-1200',
            provider: 'stripe',
            price_id: 'price_db_1200',
            credits: 1200,
            display_name: '1,200 credits',
            enabled: true,
            sort_order: 2,
            metadata: { tier: 'growth' },
            created_at: '2026-07-08T00:00:00.000Z',
            updated_at: '2026-07-08T00:00:00.000Z',
          }])
        }
        if (url.includes('/rest/v1/beegame_billing_events')) {
          return Response.json([{
            id: 'event-1',
            provider: 'stripe',
            event_type: 'checkout.session.created',
            status: 'succeeded',
            user_id: 'customer-a',
            price_id: 'price_db_1200',
            credits: 1200,
            provider_event_id: null,
            checkout_session_id: 'cs_1200',
            metadata: {},
            error_message: null,
            created_at: '2026-07-08T00:00:00.000Z',
          }])
        }
        return Response.json({ error: 'unexpected request' }, { status: 500 })
      }) as typeof fetch

      const billingApp = createBeeGameBillingApp({
        dashboardDataRoot: projectsRoot,
        currentUserResolver: request => {
          const header = request.headers.get('authorization')
          if (header === 'Bearer owner-token') return { id: 'owner-user', role: 'owner' }
          if (header === 'Bearer developer-token') return { id: 'developer-user', role: 'developer' }
          return undefined
        },
      })

      const forbiddenRes = await billingApp.request('/api/admin/billing/credit-packs', {
        headers: { authorization: 'Bearer developer-token' },
      })
      expect(forbiddenRes.status).toBe(403)

      const upsertRes = await billingApp.request('/api/admin/billing/credit-packs', {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          priceId: 'price_db_1200',
          credits: 1200,
          displayName: '1,200 credits',
          sortOrder: 2,
          metadata: { tier: 'growth' },
        }),
      })
      expect(upsertRes.status).toBe(200)
      expect(await upsertRes.json()).toEqual({
        pack: expect.objectContaining({
          priceId: 'price_db_1200',
          credits: 1200,
          displayName: '1,200 credits',
          enabled: true,
          sortOrder: 2,
          metadata: { tier: 'growth' },
        }),
      })

      const eventsRes = await billingApp.request('/api/admin/billing/events', {
        headers: { authorization: 'Bearer owner-token' },
      })
      expect(eventsRes.status).toBe(200)
      expect(await eventsRes.json()).toEqual({
        events: [expect.objectContaining({
          id: 'event-1',
          eventType: 'checkout.session.created',
          status: 'succeeded',
          userId: 'customer-a',
          priceId: 'price_db_1200',
          checkoutSessionId: 'cs_1200',
        })],
      })
      expect(supabaseRequests).toContainEqual(expect.objectContaining({
        url: expect.stringContaining('/rest/v1/beegame_billing_credit_packs?on_conflict=provider%2Cprice_id'),
        method: 'POST',
        body: expect.objectContaining({
          provider: 'stripe',
          price_id: 'price_db_1200',
          credits: 1200,
          display_name: '1,200 credits',
          enabled: true,
          sort_order: 2,
          metadata: { tier: 'growth' },
        }),
      }))
    } finally {
      if (originalSupabaseUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalSupabaseUrl
      }
      if (originalServiceRole === undefined) {
        delete process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
      } else {
        process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY = originalServiceRole
      }
      if (originalBillingMode === undefined) {
        delete process.env.BEEGAME_BILLING_MODE
      } else {
        process.env.BEEGAME_BILLING_MODE = originalBillingMode
      }
      globalThis.fetch = originalFetch
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })
})
