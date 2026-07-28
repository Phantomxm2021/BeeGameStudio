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
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'

type JsonObject = Record<string, unknown>

type SupabaseBillingConfig = {
  url: string
  serviceRoleKey: string
  fetchImpl?: typeof fetch
}

type SupabaseCreditAccountRow = {
  user_id: string
  plan: 'free'
  included_credits: number
  consumed_credits: number
  reserved_credits: number
  updated_at: string
}

type SupabaseCreditGrantRow = {
  granted_credits?: number
  account: SupabaseCreditAccountRow
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
    shadow_credits_micro: number
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
  shadow_credits_micro: number
}

export function createBeeGameSupabaseBillingRepositoryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BeeGameBillingRouteRepository {
  const url = trimString(
    env.BEEGAME_SUPABASE_URL ?? env.SUPABASE_URL ?? env.VITE_SUPABASE_URL,
  )
  const serviceRoleKey = trimString(
    env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
  )
  if (!url || !serviceRoleKey) return new MissingSupabaseBillingRepository()
  return new SupabaseBillingRepository({ url, serviceRoleKey })
}

class SupabaseBillingRepository implements BeeGameBillingRouteRepository {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly fetchImpl: typeof fetch

  constructor(config: SupabaseBillingConfig) {
    this.baseUrl = removeTrailingSlashes(config.url)
    this.serviceRoleKey = config.serviceRoleKey
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async recordShadowUsageForUser(
    userId: string,
    input: BeeGameUsageBillingRecordInput,
  ): Promise<BeeGameUsageBillingRecordResult> {
    const result = await this.rpc<SupabaseUsageBillingResult>(
      'beegame_record_shadow_usage',
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

  grantPaymentProviderCredits(
    _request: Request,
    targetUserId: string,
    input: BeeGameManualCreditGrantInput,
  ): Promise<BeeGameCreditGrant> {
    return this.grantCreditsWithRpc(
      'beegame_payment_provider_grant_credits',
      targetUserId,
      input,
      { source: 'payment_provider' },
    )
  }

  grantCredits(
    _request: Request,
    targetUserId: string,
    input: BeeGameManualCreditGrantInput,
  ): Promise<BeeGameCreditGrant> {
    return this.grantCreditsWithRpc(
      'beegame_admin_grant_credits',
      targetUserId,
      input,
      { source: 'manual' },
    )
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
    rpcName: string,
    targetUserId: string,
    input: BeeGameManualCreditGrantInput,
    fallbackMetadata: JsonObject,
  ): Promise<BeeGameCreditGrant> {
    const result = await this.rpc<SupabaseCreditGrantRow>(rpcName, {
      p_target_user_id: targetUserId,
      p_credits: normalizePositiveInteger(input.credits),
      p_metadata: input.metadata ?? fallbackMetadata,
    })
    return {
      grantedCredits: normalizeNonNegativeInteger(result.granted_credits),
      balance: toCreditBalance(targetUserId, result.account),
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

  private async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

class MissingSupabaseBillingRepository
  implements BeeGameBillingRouteRepository
{
  debitRealTimeUsageForUser(): Promise<BeeGameUsageBillingRecordResult> {
    return Promise.reject(missingSupabaseError())
  }

  recordShadowUsageForUser(): Promise<BeeGameUsageBillingRecordResult> {
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

const DEFAULT_FREE_CREDITS = 300
const CREDIT_UNIT_WEIGHTED_TOKENS = 10_000

function toCreditBalance(
  userId: string,
  row: SupabaseCreditAccountRow,
): BeeGameCreditBalance {
  const includedCredits = normalizeNonNegativeInteger(
    row.included_credits,
    DEFAULT_FREE_CREDITS,
  )
  const consumedCredits = normalizeNonNegativeInteger(row.consumed_credits)
  const reservedCredits = normalizeNonNegativeInteger(row.reserved_credits)
  return {
    userId,
    plan: 'free',
    balanceCredits: Math.max(
      0,
      includedCredits - consumedCredits - reservedCredits,
    ),
    includedCredits,
    consumedCredits,
    reservedCredits,
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
      shadowCreditsMicro: normalizeNonNegativeInteger(
        event.shadow_credits_micro,
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
    shadowCreditsMicro: normalizeNonNegativeInteger(
      result.shadow_credits_micro,
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

function q(value: string): string {
  return encodeURIComponent(value)
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
