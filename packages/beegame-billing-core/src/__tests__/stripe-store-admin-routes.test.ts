import { Hono } from 'hono'
import { afterEach, describe, expect, test } from 'bun:test'
import type { BeeGameBillingRouteRepository } from '../billing-ports'
import type { BillingRouteDeps } from '../billing-route-types'
import { registerBeeGameStripeStoreRoutes } from '../stripe-store-admin-routes'

const billingConfig = { mode: 'server' as const, usageBillingMode: 'realtime' as const }

function createRepository(
  overrides: Partial<BeeGameBillingRouteRepository> = {},
): BeeGameBillingRouteRepository {
  return {
    debitRealTimeUsageForUser: async () => {
      throw new Error('not used')
    },
    recordShadowUsageForUser: async () => {
      throw new Error('not used')
    },
    grantPaymentProviderCredits: async () => {
      throw new Error('unused')
    },
    grantCredits: async () => {
      throw new Error('unused')
    },
    listBillingCreditPacks: async () => [],
    upsertBillingCreditPack: async () => {
      throw new Error('unused')
    },
    appendBillingEvent: async () => {},
    listBillingEvents: async () => [],
    ...overrides,
  }
}

function createApp(
  repository: BeeGameBillingRouteRepository,
  hasPermission: BillingRouteDeps['hasPermission'] = () => true,
): Hono {
  const app = new Hono()
  registerBeeGameStripeStoreRoutes(app, {
    billingConfig,
    dashboardRepository: repository,
    getCurrentUser: () => ({ id: 'admin-user' }),
    hasPermission,
  })
  return app
}

afterEach(() => {
  console.warn = originalWarn
})

const originalWarn = console.warn

describe('stripe store admin routes', () => {
  test('redacts and traces credit-pack repository failures', async () => {
    const failure = new Error('database secret')
    const warnings: unknown[] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    const app = createApp(
      createRepository({
        listBillingCreditPacks: async () => {
          throw failure
        },
      }),
    )

    const response = await app.request('/api/admin/billing/credit-packs')
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      error: 'Request failed',
      traceId: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain('database secret')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toEqual([
      '[BeeGame] route failed',
      expect.objectContaining({
        traceId: body.traceId,
        route: 'admin.billing.credit-packs.list',
        cause: 'Error',
      }),
    ])
  })

  test('redacts and traces billing event repository failures after audit authorization', async () => {
    const failure = new Error('billing events backend secret')
    const warnings: unknown[] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    const app = createApp(
      createRepository({
        listBillingEvents: async () => {
          throw failure
        },
      }),
    )

    const response = await app.request('/api/admin/billing/events')
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      error: 'Request failed',
      traceId: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain('billing events backend secret')
    expect(warnings[0]).toEqual([
      '[BeeGame] route failed',
      expect.objectContaining({
        traceId: body.traceId,
        route: 'admin.billing.events.list',
        cause: 'Error',
      }),
    ])
  })

  test('preserves billing events audit authorization before repository access', async () => {
    let repositoryCalls = 0
    const app = createApp(
      createRepository({
        listBillingEvents: async () => {
          repositoryCalls += 1
          return []
        },
      }),
      () => false,
    )

    const response = await app.request('/api/admin/billing/events')

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(repositoryCalls).toBe(0)
  })

  test('redacts and traces credit-pack upsert failures', async () => {
    const failure = new Error('upsert backend secret')
    const warnings: unknown[] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    const app = createApp(
      createRepository({
        upsertBillingCreditPack: async () => {
          throw failure
        },
      }),
    )

    const response = await app.request('/api/admin/billing/credit-packs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priceId: 'price-test', credits: 10 }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      error: 'Request failed',
      traceId: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain('upsert backend secret')
    expect(warnings[0]).toEqual([
      '[BeeGame] route failed',
      expect.objectContaining({
        traceId: body.traceId,
        route: 'admin.billing.credit-packs.upsert',
        cause: 'Error',
      }),
    ])
  })

  test('redacts and traces credit grant repository failures', async () => {
    const failure = new Error('grant backend secret')
    const warnings: unknown[] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    const app = createApp(
      createRepository({
        grantCredits: async () => {
          throw failure
        },
      }),
    )

    const response = await app.request('/api/admin/credits/grants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'target-user', credits: 10 }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      error: 'Request failed',
      traceId: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain('grant backend secret')
    expect(warnings[0]).toEqual([
      '[BeeGame] route failed',
      expect.objectContaining({
        traceId: body.traceId,
        route: 'admin.credits.grants',
        cause: 'Error',
      }),
    ])
  })

  test('preserves credits admin authorization and grant validation responses', async () => {
    const app = createApp(createRepository(), () => false)
    const forbidden = await app.request('/api/admin/credits/grants', {
      method: 'POST',
    })
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ error: 'Forbidden' })

    const authorizedApp = createApp(createRepository())
    const invalid = await authorizedApp.request('/api/admin/credits/grants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: '', credits: 0 }),
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({
      error: 'Invalid request',
      message: 'userId and positive credits are required.',
    })
  })
})
