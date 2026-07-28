import type { BeeGameBillingConfig } from './billing-config'

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

export function createRemoteUsageBillingClient(
  billingConfig: BeeGameBillingConfig,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
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
    private readonly fetchImpl: typeof fetch,
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
    const response = await this.fetchImpl(
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
    const payload = (await response.json().catch(() => ({}))) as {
      message?: unknown
      error?: unknown
    }
    if (!response.ok) {
      const message =
        typeof payload.message === 'string'
          ? payload.message
          : typeof payload.error === 'string'
            ? payload.error
            : `Usage billing request failed with ${response.status}`
      throw new Error(message)
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
