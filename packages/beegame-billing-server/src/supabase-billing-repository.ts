import type {
  BeeGameBillingCreditPack,
  BeeGameBillingCreditPackFilters,
  BeeGameBillingCreditPackInput,
  BeeGameBillingEventInput,
  BeeGameBillingRouteRepository,
  BeeGameCreditBalance,
  BeeGameCreditGrant,
  BeeGameManualCreditGrantInput,
} from '@bee-game-studio/beegame-billing-core/billing-ports'
import type {
  BeeGameUsageBillingEvent,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { createTLSAwareFetch } from '@bee-game-studio/security-core'
import type { ImageBillingInput, ImageBillingReceipt } from '@bee-game-studio/beegame-billing-core/image-billing'

type JsonObject = Record<string, unknown>

type SupabaseBillingConfig = {
  url: string
  serviceRoleKey: string
  fetchImpl?: BillingFetch
}

type BillingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type SupabaseUsageWalletRow = {
  user_id: string
  included_credits_micro: number
  consumed_credits_micro: number
  reserved_credits_micro?: number
  updated_at: string
}

type SupabaseUsageBillingEventRow = SupabaseUsageBillingResult['event']

export type BeeGameUsageWallet = {
  userId: string
  includedCreditsMicro: number
  consumedCreditsMicro: number
  reservedCreditsMicro?: number
  balanceCreditsMicro: number
}

export type BeeGameUsageSummary = {
  eventsCount: number
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  weightedTokens: number
  creditsMicro: number
}

export type BeeGameUsageEventsPage = {
  items: BeeGameUsageBillingEvent[]
  total: number | null
}

export const DEFAULT_USAGE_EVENTS_PAGE_SIZE = 100
export const MAX_USAGE_EVENTS_PAGE_SIZE = 200

export interface BeeGameBillingServerRepository
  extends BeeGameBillingRouteRepository {
  listUsageEventsPageForUser(
    userId: string,
    projectId?: string,
    from?: Date,
    to?: Date,
    offset?: number,
    limit?: number,
  ): Promise<BeeGameUsageEventsPage>
  /** Server-side aggregation avoids reading the complete usage ledger. */
  getUsageSummaryForUser(
    userId: string,
    projectId?: string,
    from?: Date,
    to?: Date,
  ): Promise<BeeGameUsageSummary>
  getUsageWalletForUser(userId: string): Promise<BeeGameUsageWallet>
}

type SupabaseBillingCreditPackRow = {
  provider: string
  price_id: string
  credits: number
  display_name: string | null
  enabled: boolean
  sort_order: number
  metadata: JsonObject
}

type SupabaseBillingEventRow = {
  provider: string
  event_type: string
  status: string
  user_id: string | null
  price_id: string | null
  credits: number | null
  provider_event_id: string | null
  checkout_session_id: string | null
  metadata: JsonObject
  error_message: string | null
}

type SupabaseUsageBillingResult = {
  duplicate?: boolean
  event: {
    id: string
    idempotency_key: string
    user_id: string
    session_id: string
    turn_id: string | null
    project_id: string | null
    pricing_version: string
    usage_source: 'runtime_snapshot' | 'model_runtime_host'
    prompt_tokens: number
    completion_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
    total_tokens: number
    prompt_tokens_delta: number
    completion_tokens_delta: number
    cache_read_tokens_delta: number
    cache_creation_tokens_delta: number
    total_tokens_delta: number
    weighted_tokens: number
    weighted_tokens_delta: number
    credits_micro: number
    created_at: string
    metadata: JsonObject
  }
  cumulative_usage: {
    prompt_tokens: number
    completion_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
    total_tokens: number
  }
  cumulative_weighted_tokens: number
  credits_micro: number
}

type SupabaseUsageSummaryRow = {
  events_count: number
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
  weighted_tokens: number
  credits_micro: number
}

export function createBeeGameSupabaseBillingRepositoryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: BillingFetch = createTLSAwareFetch(),
): BeeGameBillingServerRepository {
  const url = trimString(
    env.BEEGAME_SUPABASE_URL ?? env.SUPABASE_URL ?? env.VITE_SUPABASE_URL,
  )
  const serviceRoleKey = trimString(
    env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
  )
  if (!url || !serviceRoleKey) return new MissingSupabaseBillingRepository()
  return new SupabaseBillingRepository({ url, serviceRoleKey, fetchImpl })
}

class SupabaseBillingRepository implements BeeGameBillingServerRepository {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly fetchImpl: BillingFetch

  constructor(config: SupabaseBillingConfig) {
    this.baseUrl = removeTrailingSlashes(config.url)
    this.serviceRoleKey = config.serviceRoleKey
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async applyImageBilling(userId: string, input: ImageBillingInput): Promise<ImageBillingReceipt> {
    return this.rpc<ImageBillingReceipt>('beegame_image_billing', {
      p_user_id: userId, p_project_id: input.projectId, p_request_id: input.requestId,
      p_digest: input.digest, p_action: input.action, p_amount: input.amountCreditsMicro,
      p_budget: input.projectBudgetCreditsMicro, p_metadata: input.metadata ?? {},
    })
  }

  async readImageGenerationSettings(): Promise<import('@bee-game-studio/beegame-billing-core/image-billing').ImageConfigRead> {
    const source = 'supabase-platform' as const
    const databaseHost = new URL(this.baseUrl).host
    let response: Response
    try {
      response = await this.fetchImpl(this.baseUrl + '/rest/v1/beegame_image_generation_settings?id=eq.platform&select=config&limit=1', {
        headers: { apikey: this.serviceRoleKey, authorization: 'Bearer ' + this.serviceRoleKey },
        redirect: 'error',
      })
    } catch { return { source, databaseHost, code: 'database-network' } }
    const facts = { source, databaseHost, httpStatus: response.status }
    if (!response.ok) return { ...facts, code: 'database-http' }
    let rows: unknown
    try { rows = await response.json() } catch { return { ...facts, code: 'database-response' } }
    if (!Array.isArray(rows)) return { ...facts, code: 'database-response' }
    if (!rows.length || !rows[0]?.config) return { ...facts, rowExists: rows.length > 0, code: 'platform-row-missing' }
    return { ...facts, rowExists: true, config: rows[0].config }
  }

  async recordUsageForUser(
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    const result = await this.rpc<SupabaseUsageBillingResult>(
      'beegame_record_usage',
      {
        p_user_id: userId,
        p_session_id: input.sessionId,
        p_turn_id: input.turnId ?? null,
        p_project_id: input.projectId ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_usage: input.usage,
        p_metadata: input.metadata ?? {},
        p_pricing_version: input.pricingVersion ?? 'weighted-v1',
        p_usage_source: input.usageSource ?? 'runtime_snapshot',
      },
    )
    return toUsageBillingRecordResult(result)
  }

  async debitRealTimeUsageForUser(
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    const result = await this.rpc<SupabaseUsageBillingResult>(
      'beegame_debit_realtime_usage',
      {
        p_user_id: userId,
        p_session_id: input.sessionId,
        p_turn_id: input.turnId ?? null,
        p_project_id: input.projectId ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_usage: input.usage,
        p_metadata: input.metadata ?? {},
        p_pricing_version: input.pricingVersion ?? 'weighted-v1',
        p_usage_source: input.usageSource ?? 'runtime_snapshot',
      },
    )
    return toUsageBillingRecordResult(result)
  }

  async listUsageEventsPageForUser(
    userId: string,
    projectId?: string,
    from?: Date,
    to?: Date,
    offset = 0,
    limit = DEFAULT_USAGE_EVENTS_PAGE_SIZE,
  ): Promise<BeeGameUsageEventsPage> {
    const boundedOffset = normalizeUsageEventsOffset(offset)
    const boundedLimit = normalizeUsageEventsLimit(limit)
    const filters = [
      `user_id=eq.${encodeURIComponent(userId)}`,
      ...(projectId ? [`project_id=eq.${encodeURIComponent(projectId)}`] : []),
      ...(from ? [`created_at=gte.${encodeURIComponent(from.toISOString())}`] : []),
      ...(to ? [`created_at=lte.${encodeURIComponent(to.toISOString())}`] : []),
    ].join('&')
    const response = await this.restResponse(
      `/rest/v1/beegame_usage_events?${filters}&select=*&order=created_at.asc,id.asc&offset=${boundedOffset}&limit=${boundedLimit}`,
      { headers: { Prefer: 'count=exact' } },
    )
    const rows = await response.json() as SupabaseUsageBillingEventRow[]
    const totalText = response.headers.get('content-range')?.split('/')[1]
    const total = totalText && /^\d+$/.test(totalText) ? Number(totalText) : null
    return { items: rows.map(toUsageBillingEvent), total }
  }

  async getUsageSummaryForUser(
    userId: string,
    projectId?: string,
    from?: Date,
    to?: Date,
  ): Promise<BeeGameUsageSummary> {
    const row = await this.rpc<SupabaseUsageSummaryRow>('beegame_usage_summary', {
      p_user_id: userId,
      p_project_id: projectId ?? null,
      p_from: from?.toISOString() ?? null,
      p_to: to?.toISOString() ?? null,
    })
    return {
      eventsCount: normalizeNonNegativeInteger(row.events_count),
      promptTokens: normalizeNonNegativeInteger(row.prompt_tokens),
      completionTokens: normalizeNonNegativeInteger(row.completion_tokens),
      cacheReadTokens: normalizeNonNegativeInteger(row.cache_read_tokens),
      cacheCreationTokens: normalizeNonNegativeInteger(row.cache_creation_tokens),
      totalTokens: normalizeNonNegativeInteger(row.total_tokens),
      weightedTokens: normalizeNonNegativeInteger(row.weighted_tokens),
      creditsMicro: normalizeNonNegativeInteger(row.credits_micro),
    }
  }

  async getUsageWalletForUser(userId: string): Promise<BeeGameUsageWallet> {
    const rows = await this.rest<SupabaseUsageWalletRow[]>(
      `/rest/v1/beegame_usage_wallets?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
    )
    const row = rows[0] ?? {
      user_id: userId,
      included_credits_micro: 300_000_000,
      consumed_credits_micro: 0,
      updated_at: new Date().toISOString(),
    }
    return {
      userId: row.user_id,
      includedCreditsMicro: normalizeNonNegativeInteger(
        row.included_credits_micro,
      ),
      consumedCreditsMicro: normalizeNonNegativeInteger(
        row.consumed_credits_micro,
      ),
      balanceCreditsMicro: Math.max(
        0,
        normalizeNonNegativeInteger(row.included_credits_micro) -
          normalizeNonNegativeInteger(row.consumed_credits_micro) - normalizeNonNegativeInteger(row.reserved_credits_micro ?? 0),
      ),
      reservedCreditsMicro: normalizeNonNegativeInteger(row.reserved_credits_micro ?? 0),
    }
  }

  grantPaymentProviderCredits(
    _request: Request,
    targetUserId: string,
    input: BeeGameManualCreditGrantInput,
  ): Promise<BeeGameCreditGrant> {
    return this.grantCreditsWithRpc(targetUserId, input)
  }

  grantCredits(
    _request: Request,
    targetUserId: string,
    input: BeeGameManualCreditGrantInput,
  ): Promise<BeeGameCreditGrant> {
    return this.grantCreditsWithRpc(targetUserId, input)
  }

  async listBillingCreditPacks(
    _request: Request,
    options: BeeGameBillingCreditPackFilters = {},
  ): Promise<BeeGameBillingCreditPack[]> {
    const enabledFilter = options.enabledOnly ? '&enabled=eq.true' : ''
    const rows = await this.rest<SupabaseBillingCreditPackRow[]>(
      `/rest/v1/beegame_billing_credit_packs?provider=eq.stripe${enabledFilter}&select=*&order=sort_order.asc,credits.asc`,
    )
    return rows.map(rowToBillingCreditPack)
  }

  async upsertBillingCreditPack(
    _request: Request,
    input: BeeGameBillingCreditPackInput,
  ): Promise<BeeGameBillingCreditPack> {
    const priceId = trimString(input.priceId)
    if (!priceId) throw new Error('Stripe price id is required')
    const row = await this.upsert<SupabaseBillingCreditPackRow>(
      'beegame_billing_credit_packs',
      {
        provider: input.provider ?? 'stripe',
        price_id: priceId,
        credits: normalizePositiveInteger(input.credits),
        display_name: trimString(input.displayName) || null,
        enabled: input.enabled ?? true,
        sort_order: normalizeNonNegativeInteger(input.sortOrder),
        metadata: input.metadata ?? {},
      },
      'provider,price_id',
    )
    return rowToBillingCreditPack(row)
  }

  async appendBillingEvent(
    _request: Request | undefined,
    input: BeeGameBillingEventInput,
  ): Promise<void> {
    await this.insert('beegame_billing_events', {
      provider: input.provider,
      event_type: input.eventType,
      status: input.status,
      user_id: trimString(input.userId) || null,
      price_id: trimString(input.priceId) || null,
      credits:
        typeof input.credits === 'number'
          ? normalizeNonNegativeInteger(input.credits)
          : null,
      provider_event_id: trimString(input.providerEventId) || null,
      checkout_session_id: trimString(input.checkoutSessionId) || null,
      metadata: input.metadata ?? {},
      error_message: trimString(input.errorMessage) || null,
    })
  }

  async listBillingEvents(
    _request: Request,
  ): Promise<BeeGameBillingEventInput[]> {
    const rows = await this.rest<SupabaseBillingEventRow[]>(
      '/rest/v1/beegame_billing_events?select=*&order=created_at.desc&limit=200',
    )
    return rows.map(rowToBillingEvent)
  }

  private async grantCreditsWithRpc(
    targetUserId: string,
    input: BeeGameManualCreditGrantInput,
  ): Promise<BeeGameCreditGrant> {
    const grantedCredits = normalizePositiveInteger(input.credits)
    const amountMicro = grantedCredits * 1_000_000
    if (!Number.isSafeInteger(amountMicro)) throw new Error('Credit grant amount is out of range')
    const updated = await this.rpc<SupabaseUsageWalletRow>('beegame_increment_credit_wallet', {
      p_user_id: targetUserId, p_amount: amountMicro,
    })
    return {
      grantedCredits,
      balance: toCreditBalance(updated),
    }
  }

  private rpc<T = JsonObject>(
    functionName: string,
    payload: JsonObject,
  ): Promise<T> {
    return this.rest<T>(`/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  private async upsert<T = JsonObject>(
    table: string,
    payload: JsonObject,
    onConflict: string,
  ): Promise<T> {
    const rows = await this.rest<T[]>(
      `/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(payload),
      },
    )
    if (!rows[0]) throw new Error(`Supabase ${table} upsert returned no rows`)
    return rows[0]
  }

  private async insert<T = JsonObject>(
    table: string,
    payload: JsonObject,
  ): Promise<T> {
    const rows = await this.rest<T[]>(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    })
    if (!rows[0]) throw new Error(`Supabase ${table} insert returned no rows`)
    return rows[0]
  }

  private async restResponse(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `Supabase request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
      )
    }
    return response
  }

  private async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.restResponse(path, init)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

function normalizeUsageEventsOffset(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function normalizeUsageEventsLimit(value: number): number {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, MAX_USAGE_EVENTS_PAGE_SIZE)
    : DEFAULT_USAGE_EVENTS_PAGE_SIZE
}

class MissingSupabaseBillingRepository
  implements BeeGameBillingServerRepository
{
  listUsageEventsPageForUser(): Promise<BeeGameUsageEventsPage> {
    return Promise.reject(missingSupabaseError())
  }

  getUsageSummaryForUser(): Promise<BeeGameUsageSummary> {
    return Promise.reject(missingSupabaseError())
  }

  getUsageWalletForUser(): Promise<BeeGameUsageWallet> {
    return Promise.reject(missingSupabaseError())
  }
  debitRealTimeUsageForUser(): Promise<BeeGameUsageBillingRecordResult> {
    return Promise.reject(missingSupabaseError())
  }

  recordUsageForUser(): Promise<BeeGameUsageBillingRecordResult> {
    return Promise.reject(missingSupabaseError())
  }

  grantPaymentProviderCredits(): Promise<BeeGameCreditGrant> {
    return Promise.reject(missingSupabaseError())
  }

  grantCredits(): Promise<BeeGameCreditGrant> {
    return Promise.reject(missingSupabaseError())
  }

  listBillingCreditPacks(): Promise<BeeGameBillingCreditPack[]> {
    return Promise.resolve([])
  }

  upsertBillingCreditPack(): Promise<BeeGameBillingCreditPack> {
    return Promise.reject(missingSupabaseError())
  }

  appendBillingEvent(): Promise<void> {
    return Promise.resolve()
  }

  listBillingEvents(): Promise<BeeGameBillingEventInput[]> {
    return Promise.resolve([])
  }
}

const CREDIT_UNIT_WEIGHTED_TOKENS = 10_000

function toCreditBalance(row: SupabaseUsageWalletRow): BeeGameCreditBalance {
  const includedCredits = normalizeNonNegativeInteger(row.included_credits_micro) / 1_000_000
  const consumedCredits = normalizeNonNegativeInteger(row.consumed_credits_micro) / 1_000_000
  return {
    userId: row.user_id,
    plan: 'free',
    balanceCredits: Math.max(
      0,
      includedCredits - consumedCredits - normalizeNonNegativeInteger(row.reserved_credits_micro ?? 0) / 1_000_000,
    ),
    includedCredits,
    consumedCredits,
    creditUnitWeightedTokens: CREDIT_UNIT_WEIGHTED_TOKENS,
    estimates: {
      ideaIntake: { minCredits: 3, maxCredits: 3 },
      planningDocs: { minCredits: 8, maxCredits: 30 },
      smallPlayableGame: { minCredits: 80, maxCredits: 200 },
      standardGame: { minCredits: 200, maxCredits: 600 },
      complexGame: { minCredits: 600, maxCredits: 1500 },
    },
  }
}

function toUsageBillingEvent(
  event: SupabaseUsageBillingEventRow,
): BeeGameUsageBillingEvent {
  return {
    id: event.id,
    idempotencyKey: event.idempotency_key,
    userId: event.user_id,
    sessionId: event.session_id,
    ...(event.turn_id ? { turnId: event.turn_id } : {}),
    ...(event.project_id ? { projectId: event.project_id } : {}),
    pricingVersion: event.pricing_version,
    usageSource: event.usage_source,
    usage: {
      prompt_tokens: normalizeNonNegativeInteger(event.prompt_tokens),
      completion_tokens: normalizeNonNegativeInteger(event.completion_tokens),
      cache_read_tokens: normalizeNonNegativeInteger(event.cache_read_tokens),
      cache_creation_tokens: normalizeNonNegativeInteger(
        event.cache_creation_tokens,
      ),
      total_tokens: normalizeNonNegativeInteger(event.total_tokens),
    },
    delta: {
      prompt_tokens: normalizeNonNegativeInteger(event.prompt_tokens_delta),
      completion_tokens: normalizeNonNegativeInteger(
        event.completion_tokens_delta,
      ),
      cache_read_tokens: normalizeNonNegativeInteger(
        event.cache_read_tokens_delta,
      ),
      cache_creation_tokens: normalizeNonNegativeInteger(
        event.cache_creation_tokens_delta,
      ),
      total_tokens: normalizeNonNegativeInteger(event.total_tokens_delta),
    },
    weightedTokens: normalizeNonNegativeInteger(event.weighted_tokens),
    weightedTokensDelta: normalizeNonNegativeInteger(
      event.weighted_tokens_delta,
    ),
    creditsMicro: normalizeNonNegativeInteger(event.credits_micro),
    createdAt: event.created_at,
    metadata: isObject(event.metadata) ? event.metadata : {},
  }
}

function rowToBillingCreditPack(
  row: SupabaseBillingCreditPackRow,
): BeeGameBillingCreditPack {
  const displayName = trimString(row.display_name)
  return {
    provider: 'stripe',
    priceId: row.price_id,
    credits: normalizePositiveInteger(row.credits),
    ...(displayName ? { displayName } : {}),
    enabled: row.enabled,
    sortOrder: normalizeNonNegativeInteger(row.sort_order),
    metadata: isObject(row.metadata) ? row.metadata : {},
  }
}

function rowToBillingEvent(
  row: SupabaseBillingEventRow,
): BeeGameBillingEventInput {
  return {
    provider: 'stripe',
    eventType: row.event_type,
    status: toBillingEventStatus(row.status),
    ...(trimString(row.user_id) ? { userId: trimString(row.user_id) } : {}),
    ...(trimString(row.price_id) ? { priceId: trimString(row.price_id) } : {}),
    ...(typeof row.credits === 'number'
      ? { credits: normalizeNonNegativeInteger(row.credits) }
      : {}),
    ...(trimString(row.provider_event_id)
      ? { providerEventId: trimString(row.provider_event_id) }
      : {}),
    ...(trimString(row.checkout_session_id)
      ? { checkoutSessionId: trimString(row.checkout_session_id) }
      : {}),
    metadata: isObject(row.metadata) ? row.metadata : {},
    ...(trimString(row.error_message)
      ? { errorMessage: trimString(row.error_message) }
      : {}),
  }
}

function toUsageBillingRecordResult(
  result: SupabaseUsageBillingResult,
): BeeGameUsageBillingRecordResult {
  const event = result.event
  return {
    duplicate: result.duplicate === true,
    event: {
      id: event.id,
      idempotencyKey: event.idempotency_key,
      userId: event.user_id,
      sessionId: event.session_id,
      ...(event.turn_id ? { turnId: event.turn_id } : {}),
      ...(event.project_id ? { projectId: event.project_id } : {}),
      pricingVersion: event.pricing_version,
      usageSource: event.usage_source,
      usage: {
        prompt_tokens: normalizeNonNegativeInteger(event.prompt_tokens),
        completion_tokens: normalizeNonNegativeInteger(event.completion_tokens),
        cache_read_tokens: normalizeNonNegativeInteger(event.cache_read_tokens),
        cache_creation_tokens: normalizeNonNegativeInteger(
          event.cache_creation_tokens,
        ),
        total_tokens: normalizeNonNegativeInteger(event.total_tokens),
      },
      delta: {
        prompt_tokens: normalizeNonNegativeInteger(event.prompt_tokens_delta),
        completion_tokens: normalizeNonNegativeInteger(
          event.completion_tokens_delta,
        ),
        cache_read_tokens: normalizeNonNegativeInteger(
          event.cache_read_tokens_delta,
        ),
        cache_creation_tokens: normalizeNonNegativeInteger(
          event.cache_creation_tokens_delta,
        ),
        total_tokens: normalizeNonNegativeInteger(event.total_tokens_delta),
      },
      weightedTokens: normalizeNonNegativeInteger(event.weighted_tokens),
      weightedTokensDelta: normalizeNonNegativeInteger(
        event.weighted_tokens_delta,
      ),
      creditsMicro: normalizeNonNegativeInteger(
        event.credits_micro,
      ),
      createdAt: event.created_at,
      metadata: isObject(event.metadata) ? event.metadata : {},
    },
    cumulativeUsage: {
      prompt_tokens: normalizeNonNegativeInteger(
        result.cumulative_usage.prompt_tokens,
      ),
      completion_tokens: normalizeNonNegativeInteger(
        result.cumulative_usage.completion_tokens,
      ),
      cache_read_tokens: normalizeNonNegativeInteger(
        result.cumulative_usage.cache_read_tokens,
      ),
      cache_creation_tokens: normalizeNonNegativeInteger(
        result.cumulative_usage.cache_creation_tokens,
      ),
      total_tokens: normalizeNonNegativeInteger(
        result.cumulative_usage.total_tokens,
      ),
    },
    cumulativeWeightedTokens: normalizeNonNegativeInteger(
      result.cumulative_weighted_tokens,
    ),
    creditsMicro: normalizeNonNegativeInteger(
      result.credits_micro,
    ),
  }
}

function toBillingEventStatus(
  value: string,
): BeeGameBillingEventInput['status'] {
  return value === 'received' ||
    value === 'ignored' ||
    value === 'succeeded' ||
    value === 'failed'
    ? value
    : 'failed'
}

function missingSupabaseError(): Error {
  return new Error(
    'BEEGAME_SUPABASE_URL and BEEGAME_SUPABASE_SERVICE_ROLE_KEY are required for BeeGame billing server',
  )
}

function removeTrailingSlashes(value: string): string {
  let next = value
  while (next.endsWith('/')) next = next.slice(0, -1)
  return next
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeNonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

function normalizePositiveInteger(value: unknown): number {
  const normalized = normalizeNonNegativeInteger(value)
  if (normalized <= 0) throw new Error('Credit amount must be positive')
  return normalized
}
