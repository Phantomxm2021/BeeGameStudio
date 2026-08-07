import type { BeeGameBillingConfig } from './billing-config'

type BillingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type BeeGameUsageBillingUsage = {
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
}

export type BeeGameUsageBillingEvent = {
  id: string
  idempotencyKey: string
  userId: string
  sessionId: string
  turnId?: string
  projectId?: string
  pricingVersion: string
  usageSource: 'runtime_snapshot' | 'model_runtime_host'
  usage: BeeGameUsageBillingUsage
  delta: BeeGameUsageBillingUsage
  weightedTokens: number
  weightedTokensDelta: number
  creditsMicro: number
  createdAt: string
  metadata: Record<string, unknown>
}

export type BeeGameUsageBillingRecordInput = {
  sessionId: string
  turnId?: string
  projectId?: string
  usage: BeeGameUsageBillingUsage
  idempotencyKey: string
  metadata?: Record<string, unknown>
  pricingVersion?: string
  usageSource?: BeeGameUsageBillingEvent['usageSource']
}

export type BeeGameUsageBillingRecordResult = {
  event: BeeGameUsageBillingEvent
  duplicate: boolean
  cumulativeUsage: BeeGameUsageBillingUsage
  cumulativeWeightedTokens: number
  creditsMicro: number
}

export type BeeGameUsageBillingClient = {
  recordUsage: (
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ) => Promise<BeeGameUsageBillingRecordResult>
  debitRealTimeUsage: (
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ) => Promise<BeeGameUsageBillingRecordResult>
}

export class BeeGameUsageBillingError extends Error {
  readonly stage = 'usage_billing' as const

  constructor(
    message: string,
    readonly retryable: boolean,
    options: { cause?: unknown; traceId?: string } = {},
  ) {
    super(message, options)
    this.name = 'BeeGameUsageBillingError'
    this.traceId = options.traceId
  }

  readonly traceId?: string
}

export function createRemoteUsageBillingClient(
  billingConfig: BeeGameBillingConfig,
  fetchImpl: BillingFetch = globalThis.fetch.bind(globalThis),
): BeeGameUsageBillingClient | undefined {
  if (billingConfig.mode !== 'remote') return undefined
  if (!billingConfig.remoteApiBaseUrl || !billingConfig.creditControlToken) {
    return new DisabledRemoteUsageBillingClient()
  }
  return new RemoteUsageBillingClient(
    billingConfig.remoteApiBaseUrl,
    billingConfig.creditControlToken,
    fetchImpl,
  )
}

class DisabledRemoteUsageBillingClient implements BeeGameUsageBillingClient {
  recordUsage(): Promise<BeeGameUsageBillingRecordResult> {
    return Promise.reject(remoteUsageBillingConfigError())
  }

  debitRealTimeUsage(): Promise<BeeGameUsageBillingRecordResult> {
    return Promise.reject(remoteUsageBillingConfigError())
  }
}

class RemoteUsageBillingClient implements BeeGameUsageBillingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: BillingFetch,
  ) {}

  recordUsage(
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    return this.post('/api/internal/usage/events', {
      userId,
      ...input,
    })
  }

  debitRealTimeUsage(
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    return this.post('/api/internal/usage/debits', {
      userId,
      ...input,
    })
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(
        buildUsageBillingUrl(this.baseUrl, path),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-beegame-credit-control-token': this.token,
          },
          body: JSON.stringify(body),
        },
      )
    } catch (error) {
      throw new BeeGameUsageBillingError(
        error instanceof Error ? error.message : 'Usage billing transport failed',
        true,
        { cause: error },
      )
    }
    const payload = (await response.json().catch(() => ({}))) as {
      message?: unknown
      error?: unknown
      traceId?: unknown
    }
    if (!response.ok) {
      const message =
        typeof payload.message === 'string'
          ? payload.message
          : typeof payload.error === 'string'
            ? payload.error
            : `Usage billing request failed with ${response.status}`
      throw new BeeGameUsageBillingError(message, response.status >= 500, {
        traceId:
          typeof payload.traceId === 'string' && payload.traceId.trim()
            ? payload.traceId
            : undefined,
      })
    }
    return payload as T
  }
}

function remoteUsageBillingConfigError(): Error {
  return new Error(
    'BEEGAME_BILLING_API_BASE_URL and BEEGAME_CREDIT_CONTROL_TOKEN are required for remote usage billing',
  )
}

function buildUsageBillingUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return new URL(normalizedPath, normalizedBaseUrl).toString()
}
