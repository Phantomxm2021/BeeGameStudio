import type {
  BeeGameBillingCreditPack,
} from './billing-ports'

export type BeeGamePublicStripeCreditPack = {
  priceId: string
  credits: number
  displayName?: string
}

export function createStripeCreditPacksFromPriceMap(
  priceCredits: Record<string, number>,
): BeeGameBillingCreditPack[] {
  return Object.entries(priceCredits)
    .filter(([, credits]) => Number.isFinite(credits) && credits > 0)
    .map(([priceId, credits], index) => ({
      provider: 'stripe' as const,
      priceId,
      credits,
      enabled: true,
      sortOrder: index,
      metadata: {},
    }))
    .sort((left, right) => left.credits - right.credits)
}

export function stripeCreditPacksToCreditMap(
  packs: BeeGameBillingCreditPack[],
): Record<string, number> {
  const mapping: Record<string, number> = {}
  for (const pack of packs) {
    if (pack.enabled && pack.priceId && pack.credits > 0) {
      mapping[pack.priceId] = pack.credits
    }
  }
  return mapping
}

export function toPublicStripeCreditPack(
  pack: BeeGameBillingCreditPack,
): BeeGamePublicStripeCreditPack {
  return {
    priceId: pack.priceId,
    credits: pack.credits,
    ...(pack.displayName ? { displayName: pack.displayName } : {}),
  }
}
