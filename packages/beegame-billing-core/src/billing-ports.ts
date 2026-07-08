import type { BeeGameCreditBalance } from './credit-control-client'
import type {
  BeeGameCreditControlExpireInput,
  BeeGameCreditControlRefundInput,
  BeeGameCreditControlReserveInput,
  BeeGameCreditControlSettleInput,
  BeeGameCreditReservation,
  BeeGameCreditSettlement,
  BeeGameStaleCreditReservationExpiry,
} from './credit-control-client'

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
  reserveCreditsForUser: (
    userId: string,
    input: BeeGameCreditControlReserveInput,
  ) => Promise<BeeGameCreditReservation>
  findCreditReservationByIdempotencyKeyForUser: (
    userId: string,
    idempotencyKey: string,
  ) => Promise<BeeGameCreditReservation | undefined>
  getCreditSettlementForUser: (
    userId: string,
    reservationId: string,
  ) => Promise<BeeGameCreditSettlement | undefined>
  settleCreditReservationForUser: (
    userId: string,
    input: BeeGameCreditControlSettleInput,
  ) => Promise<BeeGameCreditSettlement>
  refundCreditReservationForUser: (
    userId: string,
    input: BeeGameCreditControlRefundInput,
  ) => Promise<BeeGameCreditSettlement>
  expireStaleCreditReservationsForUser: (
    userId: string,
    input: BeeGameCreditControlExpireInput,
  ) => Promise<BeeGameStaleCreditReservationExpiry>
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
