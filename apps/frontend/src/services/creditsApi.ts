import apiClient from './apiClient'

export type BeeGameCreditEstimate = {
  minCredits: number
  maxCredits: number
}

export type BeeGameCreditBalance = {
  userId: string
  plan: 'free'
  balanceCredits: number
  includedCredits: number
  consumedCredits: number
  creditUnitWeightedTokens: number
  estimates: {
    ideaIntake: BeeGameCreditEstimate
    planningDocs: BeeGameCreditEstimate
    smallPlayableGame: BeeGameCreditEstimate
    standardGame: BeeGameCreditEstimate
    complexGame: BeeGameCreditEstimate
  }
}

export type BeeGameUsageEvent = {
  id: string
  userId: string
  credits: number
  projectId?: string
  weightedTokens?: number
  metadata: Record<string, unknown>
  createdAt: string
}

export type BeeGameUsageSummary = {
  entriesCount: number
  consumedCredits: number
  weightedTokens: number
}

export type BeeGameCreditGrant = {
  grantedCredits: number
  balance: BeeGameCreditBalance
}

export type BeeGameCreditGrantInput = {
  userId: string
  credits: number
  metadata?: Record<string, unknown>
}

export type BeeGameStripeCreditPack = {
  priceId: string
  credits: number
  displayName?: string
}

export type BeeGameStripeCreditPacks = {
  packs: BeeGameStripeCreditPack[]
}

export type BeeGameStripeCheckoutSession = {
  id: string
  url: string
  priceId: string
  credits: number
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
  priceId: string
  credits: number
  displayName?: string
  enabled?: boolean
  sortOrder?: number
  metadata?: Record<string, unknown>
}

export type BeeGameBillingCreditPacks = {
  packs: BeeGameBillingCreditPack[]
}

export type BeeGameBillingEvent = {
  id?: string
  provider: 'stripe'
  eventType: string
  status: 'received' | 'ignored' | 'succeeded' | 'failed'
  userId?: string
  priceId?: string
  credits?: number
  providerEventId?: string
  checkoutSessionId?: string
  metadata: Record<string, unknown>
  errorMessage?: string
  createdAt?: string
}

export type BeeGameBillingEvents = {
  events: BeeGameBillingEvent[]
}

type BeeGameUsageEventResponse = {
  id: string
  userId: string
  projectId?: string
  weightedTokensDelta: number
  creditsMicro: number
  metadata: Record<string, unknown>
  createdAt: string
}

type BeeGameUsageSummaryResponse = {
  eventsCount: number
  weightedTokens: number
  creditsMicro: number
}

const getUsageWallet = async (): Promise<{
  userId: string
  includedCreditsMicro: number
  consumedCreditsMicro: number
  balanceCreditsMicro: number
}> => apiClient.get('/api/usage-wallet')

const toCreditBalance = (
  wallet: Awaited<ReturnType<typeof getUsageWallet>>,
): BeeGameCreditBalance => {
  const balanceCredits = wallet.balanceCreditsMicro / 1_000_000
  const includedCredits = wallet.includedCreditsMicro / 1_000_000
  const consumedCredits = wallet.consumedCreditsMicro / 1_000_000
  const emptyEstimate = { minCredits: 0, maxCredits: 0 }
  return {
    userId: wallet.userId,
    plan: 'free',
    balanceCredits,
    includedCredits,
    consumedCredits,
    creditUnitWeightedTokens: 10_000,
    estimates: {
      ideaIntake: emptyEstimate,
      planningDocs: emptyEstimate,
      smallPlayableGame: emptyEstimate,
      standardGame: emptyEstimate,
      complexGame: emptyEstimate,
    },
  }
}

export const getCreditBalance = async (): Promise<BeeGameCreditBalance> =>
  toCreditBalance(await getUsageWallet())

const toUsageEvent = (
  event: BeeGameUsageEventResponse,
): BeeGameUsageEvent => ({
  id: event.id,
  userId: event.userId,
  credits: event.creditsMicro / 1_000_000,
  ...(event.projectId ? { projectId: event.projectId } : {}),
  weightedTokens: event.weightedTokensDelta,
  metadata: event.metadata,
  createdAt: event.createdAt,
})

const requestUsageEvents = (
  projectId?: string,
): Promise<BeeGameUsageEventResponse[]> =>
  apiClient.get('/api/usage/events', {
    ...(projectId ? { params: { projectId } } : {}),
  })

export const getUsageEvents = async (): Promise<BeeGameUsageEvent[]> =>
  (await requestUsageEvents()).map(toUsageEvent)

const requestUsageSummary = (
  projectId?: string,
): Promise<BeeGameUsageSummaryResponse> =>
  apiClient.get('/api/usage/summary', {
    ...(projectId ? { params: { projectId } } : {}),
  })

export const getCreditSummary = async (
  projectId?: string,
): Promise<BeeGameUsageSummary> => {
  const summary = await requestUsageSummary(projectId)
  return {
    entriesCount: summary.eventsCount,
    consumedCredits: summary.creditsMicro / 1_000_000,
    weightedTokens: summary.weightedTokens,
  }
}


export const grantCredits = (
  input: BeeGameCreditGrantInput,
): Promise<BeeGameCreditGrant> =>
  apiClient.post('/api/admin/credits/grants', input)

export const getStripeCreditPacks = (): Promise<BeeGameStripeCreditPacks> =>
  apiClient.get('/api/payments/stripe/credit-packs')

export const createStripeCheckoutSession = (
  priceId: string,
): Promise<BeeGameStripeCheckoutSession> =>
  apiClient.post('/api/payments/stripe/checkout-session', { priceId })

export const getBillingCreditPacks = (): Promise<BeeGameBillingCreditPacks> =>
  apiClient.get('/api/admin/billing/credit-packs')

export const upsertBillingCreditPack = (
  input: BeeGameBillingCreditPackInput,
): Promise<{ pack: BeeGameBillingCreditPack }> =>
  apiClient.post('/api/admin/billing/credit-packs', input)

export const getBillingEvents = (): Promise<BeeGameBillingEvents> =>
  apiClient.get('/api/admin/billing/events')
