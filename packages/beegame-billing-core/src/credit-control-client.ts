import type { BeeGameBillingConfig } from './billing-config'

export type BeeGameCreditBalance = {
  userId: string
  plan: 'free'
  balanceCredits: number
  includedCredits: number
  consumedCredits: number
  reservedCredits: number
  creditUnitWeightedTokens: number
  estimates: {
    ideaIntake: BeeGameCreditEstimateRange
    planningDocs: BeeGameCreditEstimateRange
    smallPlayableGame: BeeGameCreditEstimateRange
    standardGame: BeeGameCreditEstimateRange
    complexGame: BeeGameCreditEstimateRange
  }
}

export type BeeGameCreditEstimateRange = {
  minCredits: number
  maxCredits: number
}

export type BeeGameCreditReservation = {
  id: string
  reservedCredits: number
  balance: BeeGameCreditBalance
}

export type BeeGameCreditSettlement = {
  reservationId: string
  reservedCredits: number
  settledCredits: number
  refundedCredits: number
  balance: BeeGameCreditBalance
}

export type BeeGameStaleCreditReservationExpiry = {
  expiredReservations: string[]
  refundedCredits: number
  balance: BeeGameCreditBalance
}

export type BeeGameCreditControlReserveInput = {
  credits: number
  kind?: string
  projectId?: string
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

export type BeeGameCreditControlSettleInput = {
  reservationId: string
  weightedTokens: number
  projectId?: string
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

export type BeeGameCreditControlRefundInput = {
  reservationId: string
  projectId?: string
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

export type BeeGameCreditControlExpireInput = {
  olderThan: Date
  projectId?: string
  metadata?: Record<string, unknown>
}

export type BeeGameCreditControlClient = {
  reserveCredits: (
    userId: string,
    input: BeeGameCreditControlReserveInput,
  ) => Promise<BeeGameCreditReservation>
  settleCreditReservation: (
    userId: string,
    input: BeeGameCreditControlSettleInput,
  ) => Promise<BeeGameCreditSettlement>
  refundCreditReservation: (
    userId: string,
    input: BeeGameCreditControlRefundInput,
  ) => Promise<BeeGameCreditSettlement>
  expireStaleCreditReservations: (
    userId: string,
    input: BeeGameCreditControlExpireInput,
  ) => Promise<BeeGameStaleCreditReservationExpiry>
}

export function createRemoteCreditControlClient(
  billingConfig: BeeGameBillingConfig,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): BeeGameCreditControlClient | undefined {
  if (billingConfig.mode !== 'remote') return undefined
  if (!billingConfig.remoteApiBaseUrl || !billingConfig.creditControlToken) {
    return new DisabledRemoteCreditControlClient()
  }
  return new RemoteCreditControlClient(
    billingConfig.remoteApiBaseUrl,
    billingConfig.creditControlToken,
    fetchImpl,
  )
}

class DisabledRemoteCreditControlClient implements BeeGameCreditControlClient {
  reserveCredits(): Promise<BeeGameCreditReservation> {
    return Promise.reject(remoteCreditControlConfigError())
  }

  settleCreditReservation(): Promise<BeeGameCreditSettlement> {
    return Promise.reject(remoteCreditControlConfigError())
  }

  refundCreditReservation(): Promise<BeeGameCreditSettlement> {
    return Promise.reject(remoteCreditControlConfigError())
  }

  expireStaleCreditReservations(): Promise<BeeGameStaleCreditReservationExpiry> {
    return Promise.reject(remoteCreditControlConfigError())
  }
}

class RemoteCreditControlClient implements BeeGameCreditControlClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  reserveCredits(
    userId: string,
    input: BeeGameCreditControlReserveInput,
  ): Promise<BeeGameCreditReservation> {
    return this.post('/api/internal/credits/reservations', {
      userId,
      ...input,
    })
  }

  settleCreditReservation(
    userId: string,
    input: BeeGameCreditControlSettleInput,
  ): Promise<BeeGameCreditSettlement> {
    return this.post(
      `/api/internal/credits/reservations/${encodeURIComponent(input.reservationId)}/settle`,
      {
        userId,
        weightedTokens: input.weightedTokens,
        projectId: input.projectId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      },
    )
  }

  refundCreditReservation(
    userId: string,
    input: BeeGameCreditControlRefundInput,
  ): Promise<BeeGameCreditSettlement> {
    return this.post(
      `/api/internal/credits/reservations/${encodeURIComponent(input.reservationId)}/refund`,
      {
        userId,
        projectId: input.projectId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      },
    )
  }

  expireStaleCreditReservations(
    userId: string,
    input: BeeGameCreditControlExpireInput,
  ): Promise<BeeGameStaleCreditReservationExpiry> {
    return this.post('/api/internal/credits/reconcile-stale-reservations', {
      userId,
      olderThan: input.olderThan.toISOString(),
      projectId: input.projectId,
      metadata: input.metadata,
    })
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(buildCreditControlUrl(this.baseUrl, path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-beegame-credit-control-token': this.token,
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({})) as {
      message?: unknown
      error?: unknown
    }
    if (!response.ok) {
      const message = typeof payload.message === 'string'
        ? payload.message
        : typeof payload.error === 'string'
          ? payload.error
          : `Credit control request failed with ${response.status}`
      throw new Error(message)
    }
    return payload as T
  }
}

function remoteCreditControlConfigError(): Error {
  return new Error(
    'BEEGAME_BILLING_API_BASE_URL and BEEGAME_CREDIT_CONTROL_TOKEN are required for remote credit control',
  )
}

function buildCreditControlUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return new URL(normalizedPath, normalizedBaseUrl).toString()
}
