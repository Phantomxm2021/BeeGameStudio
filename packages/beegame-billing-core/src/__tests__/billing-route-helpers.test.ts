import { describe, expect, test } from 'bun:test'
import {
  loadAvailableStripeCreditPacks,
  safeAppendBillingEvent,
} from '../billing-route-helpers'
import type {
  BeeGameBillingEventInput,
  BeeGameBillingRouteRepository,
} from '../billing-ports'

function createRepository(
  overrides: Partial<BeeGameBillingRouteRepository>,
): BeeGameBillingRouteRepository {
  return {
    debitRealTimeUsageForUser: async () => {
      throw new Error('not used')
    },
    recordShadowUsageForUser: async () => {
      throw new Error('not used')
    },
    grantPaymentProviderCredits: async () => {
      throw new Error('not used')
    },
    grantCredits: async () => {
      throw new Error('not used')
    },
    listBillingCreditPacks: async () => [],
    upsertBillingCreditPack: async () => {
      throw new Error('not used')
    },
    appendBillingEvent: async () => {},
    listBillingEvents: async () => [],
    ...overrides,
  }
}

describe('billing-route-helpers', () => {
  test('prefers stored enabled Stripe credit packs over env fallback', async () => {
    const repository = createRepository({
      listBillingCreditPacks: async (_request, options) => {
        expect(options).toEqual({ enabledOnly: true })
        return [{
          provider: 'stripe',
          priceId: 'price_stored',
          credits: 500,
          enabled: true,
          sortOrder: 1,
          metadata: {},
        }]
      },
    })

    await expect(loadAvailableStripeCreditPacks(
      new Request('https://billing.beegame.test'),
      repository,
      'price_env=1200',
    )).resolves.toEqual([{
      provider: 'stripe',
      priceId: 'price_stored',
      credits: 500,
      enabled: true,
      sortOrder: 1,
      metadata: {},
    }])
  })

  test('falls back to env Stripe price mappings when no stored packs exist', async () => {
    const packs = await loadAvailableStripeCreditPacks(
      new Request('https://billing.beegame.test'),
      createRepository({}),
      'price_large=1200,price_small=500',
    )

    expect(packs.map(pack => ({ priceId: pack.priceId, credits: pack.credits }))).toEqual([
      { priceId: 'price_small', credits: 500 },
      { priceId: 'price_large', credits: 1200 },
    ])
  })

  test('safe audit append never throws when event persistence fails', async () => {
    const appended: BeeGameBillingEventInput[] = []
    const repository = createRepository({
      appendBillingEvent: async (_request, input) => {
        appended.push(input)
        throw new Error('audit unavailable')
      },
    })
    const originalWarn = console.warn
    const warnings: unknown[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args)
    }
    try {
      await expect(safeAppendBillingEvent(
        new Request('https://billing.beegame.test'),
        repository,
        {
          provider: 'stripe',
          eventType: 'checkout.session.created',
          status: 'failed',
        },
      )).resolves.toBeUndefined()
    } finally {
      console.warn = originalWarn
    }

    expect(appended).toEqual([{
      provider: 'stripe',
      eventType: 'checkout.session.created',
      status: 'failed',
    }])
    expect(warnings.length).toBe(1)
  })
})
