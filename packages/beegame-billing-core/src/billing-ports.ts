export type BeeGameCreditBalance = {
  userId: string
  plan: 'free'
  balanceCredits: number
  includedCredits: number
  consumedCredits: number
  reservedCredits: number
  creditUnitWeightedTokens: number
  estimates: Record<string, { minCredits: number; maxCredits: number }>
}
import type {
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from './usage-control-client'

export type BeeGameCreditGrant = {
  grantedCredits: number
  balance: BeeGameCreditBalance
}

export type BeeGameBillingCreditPack = {
  provider: 'stripe'
  priceId: string
  credits: number
  displayName?: string
  enabled: boolean
  sortOrder: number
  metadata: Record<string, unknown>
}

export type BeeGameBillingCreditPackInput = {
  provider?: 'stripe'
  priceId: string
  credits: number
  displayName?: string
  enabled?: boolean
  sortOrder?: number
  metadata?: Record<string, unknown>
}

export type BeeGameBillingEventInput = {
  provider: 'stripe'
  eventType: string
  status: 'received' | 'ignored' | 'succeeded' | 'failed'
  userId?: string
  priceId?: string
  credits?: number
  providerEventId?: string
  checkoutSessionId?: string
  metadata?: Record<string, unknown>
  errorMessage?: string
}

export type BeeGameManualCreditGrantInput = {
  credits: number
  metadata?: Record<string, unknown>
}

export type BeeGameBillingCreditPackFilters = {
  enabledOnly?: boolean
}

export type BeeGameBillingRouteRepository = {
  recordShadowUsageForUser: (
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ) => Promise<BeeGameUsageBillingRecordResult>
  debitRealTimeUsageForUser: (
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ) => Promise<BeeGameUsageBillingRecordResult>
  grantPaymentProviderCredits: (
    request: Request,
    targetUserId: string,
    input: BeeGameManualCreditGrantInput,
  ) => Promise<BeeGameCreditGrant>
  grantCredits: (
    request: Request,
    targetUserId: string,
    input: BeeGameManualCreditGrantInput,
  ) => Promise<BeeGameCreditGrant>
  listBillingCreditPacks: (
    request: Request,
    options?: BeeGameBillingCreditPackFilters,
  ) => Promise<BeeGameBillingCreditPack[]>
  upsertBillingCreditPack: (
    request: Request,
    input: BeeGameBillingCreditPackInput,
  ) => Promise<BeeGameBillingCreditPack>
  appendBillingEvent: (
    request: Request | undefined,
    input: BeeGameBillingEventInput,
  ) => Promise<void>
  listBillingEvents: (
    request: Request,
  ) => Promise<BeeGameBillingEventInput[]>
}
