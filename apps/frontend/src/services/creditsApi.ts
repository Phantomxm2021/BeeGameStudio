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

export type BeeGameUsageSummary = {
  entriesCount: number
  inputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  outputTokens: number
  totalTokens: number
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

type BeeGameUsageSummaryResponse = {
  eventsCount: number
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  weightedTokens: number
  creditsMicro: number
}

const getUsageWallet = async (background = false): Promise<{
  userId: string
  includedCreditsMicro: number
  consumedCreditsMicro: number
  balanceCreditsMicro: number
}> => background ? apiClient.get('/api/usage-wallet', { headers: { 'Hide-Error-Toast': 'true' } })
  : apiClient.get('/api/usage-wallet')

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

export const getCreditBalance = async (background = false): Promise<BeeGameCreditBalance> =>
  toCreditBalance(await getUsageWallet(background))

const requestUsageSummary = (
  projectId?: string,
  background = false,
): Promise<BeeGameUsageSummaryResponse> =>
  apiClient.get('/api/usage/summary', {
    ...(background ? { headers: { 'Hide-Error-Toast': 'true' } } : {}),
    ...(projectId ? { params: { projectId } } : {}),
  })

export const getCreditSummary = async (
  projectId?: string,
  background = false,
): Promise<BeeGameUsageSummary> => {
  const summary = await requestUsageSummary(projectId, background)
  return {
    entriesCount: summary.eventsCount,
    inputTokens: Number(summary.promptTokens) || 0,
    cacheReadTokens: Number(summary.cacheReadTokens) || 0,
    cacheCreationTokens: Number(summary.cacheCreationTokens) || 0,
    outputTokens: Number(summary.completionTokens) || 0,
    totalTokens: Number(summary.totalTokens) || 0,
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
