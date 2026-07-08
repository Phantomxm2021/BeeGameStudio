import { describe, expect, test } from 'bun:test'
import type {
  BeeGameBillingCreditPack,
  BeeGameBillingRouteRepository,
} from '../billing-ports'

describe('billing-ports', () => {
  test('defines route-facing billing repository contracts without runtime host types', () => {
    const pack: BeeGameBillingCreditPack = {
      provider: 'stripe',
      priceId: 'price_contract',
      credits: 500,
      enabled: true,
      sortOrder: 1,
      metadata: {},
    }
    const repository = {
      listBillingCreditPacks: async () => [pack],
    } satisfies Pick<BeeGameBillingRouteRepository, 'listBillingCreditPacks'>

    expect(repository.listBillingCreditPacks).toBeFunction()
  })
})
