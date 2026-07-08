import type {
  BeeGameBillingCreditPack,
  BeeGameBillingEventInput,
  BeeGameBillingRouteRepository,
} from './billing-ports'
import {
  createStripeCreditPacksFromPriceMap,
} from './credit-pack-helpers'
import {
  toErrorMessage,
} from './http-helpers'
import {
  loadStripePriceCreditMap,
} from './stripe-payments'

export async function loadAvailableStripeCreditPacks(
  request: Request,
  billingRepository: BeeGameBillingRouteRepository,
  rawPriceCredits = process.env.BEEGAME_STRIPE_PRICE_CREDITS,
): Promise<BeeGameBillingCreditPack[]> {
  const storedPacks = await billingRepository.listBillingCreditPacks(request, {
    enabledOnly: true,
  })
  if (storedPacks.length) return storedPacks
  return createStripeCreditPacksFromPriceMap(loadStripePriceCreditMap(rawPriceCredits))
}

export async function safeAppendBillingEvent(
  request: Request | undefined,
  billingRepository: BeeGameBillingRouteRepository,
  input: BeeGameBillingEventInput,
): Promise<void> {
  try {
    await billingRepository.appendBillingEvent(request, input)
  } catch (error) {
    console.warn('[BeeGame] Billing audit event failed:', {
      eventType: input.eventType,
      message: toErrorMessage(error),
    })
  }
}
