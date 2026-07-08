import { describe, expect, test } from 'bun:test'
import {
  createStripeCreditPacksFromPriceMap,
  stripeCreditPacksToCreditMap,
  toPublicStripeCreditPack,
} from '../credit-pack-helpers'

describe('credit-pack-helpers', () => {
  test('normalizes Stripe credit packs for public store and checkout lookup', () => {
    const packs = createStripeCreditPacksFromPriceMap({
      price_large: 1200,
      price_small: 500,
      price_invalid: 0,
    })

    expect(packs.map(pack => ({
      priceId: pack.priceId,
      credits: pack.credits,
      sortOrder: pack.sortOrder,
    }))).toEqual([
      { priceId: 'price_small', credits: 500, sortOrder: 1 },
      { priceId: 'price_large', credits: 1200, sortOrder: 0 },
    ])
    expect(stripeCreditPacksToCreditMap([
      ...packs,
      {
        provider: 'stripe',
        priceId: 'price_disabled',
        credits: 3000,
        enabled: false,
        sortOrder: 2,
        metadata: {},
      },
    ])).toEqual({
      price_small: 500,
      price_large: 1200,
    })
    expect(toPublicStripeCreditPack({
      ...packs[0],
      displayName: 'Starter',
      metadata: { internal: true },
    })).toEqual({
      priceId: 'price_small',
      credits: 500,
      displayName: 'Starter',
    })
  })
})
