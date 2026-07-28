import type { BeeGameUsageBillingEvent } from '@bee-game-studio/beegame-billing-core/usage-control-client'
import type { CreditLedgerEntry } from './credit-store'

export type CreditReconciliationReport = {
  pricingVersion: string
  shadow: {
    events: number
    weightedTokens: number
    creditsMicro: number
    credits: number
  }
  legacy: {
    settledEntries: number
    settledCredits: number
    weightedTokens: number
  }
  difference: {
    credits: number
    weightedTokens: number
  }
  status: 'aligned' | 'legacy_only' | 'shadow_only' | 'diverged'
}

export function reconcileCreditLedgers(
  shadowEvents: BeeGameUsageBillingEvent[],
  legacyEntries: CreditLedgerEntry[],
): CreditReconciliationReport {
  const shadowWeightedTokens = shadowEvents.reduce(
    (sum, event) => sum + event.weightedTokensDelta,
    0,
  )
  const shadowCreditsMicro = shadowEvents.reduce(
    (sum, event) => sum + event.shadowCreditsMicro,
    0,
  )
  const settledEntries = legacyEntries.filter(entry => entry.kind === 'settle')
  const legacyCredits = settledEntries.reduce(
    (sum, entry) => sum + Math.max(0, entry.credits),
    0,
  )
  const legacyWeightedTokens = settledEntries.reduce(
    (sum, entry) => sum + Math.max(0, entry.weightedTokens ?? 0),
    0,
  )
  const shadowCredits = shadowCreditsMicro / 1_000_000
  const creditsDifference = legacyCredits - shadowCredits
  const weightedDifference = legacyWeightedTokens - shadowWeightedTokens
  const hasShadow = shadowEvents.length > 0
  const hasLegacy = settledEntries.length > 0
  const status =
    !hasShadow && hasLegacy
      ? 'legacy_only'
      : hasShadow && !hasLegacy
        ? 'shadow_only'
        : Math.abs(creditsDifference) < 0.000001 && weightedDifference === 0
          ? 'aligned'
          : 'diverged'

  return {
    pricingVersion: shadowEvents[0]?.pricingVersion ?? 'weighted-v1',
    shadow: {
      events: shadowEvents.length,
      weightedTokens: shadowWeightedTokens,
      creditsMicro: shadowCreditsMicro,
      credits: shadowCredits,
    },
    legacy: {
      settledEntries: settledEntries.length,
      settledCredits: legacyCredits,
      weightedTokens: legacyWeightedTokens,
    },
    difference: {
      credits: creditsDifference,
      weightedTokens: weightedDifference,
    },
    status,
  }
}
