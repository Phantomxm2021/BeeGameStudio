import type {
  BeeGameUsageBillingClient,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
  BeeGameUsageBillingUsage,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'

/** The version of the deliberately small stage-facing billing protocol. */
export const USAGE_BILLING_PROTOCOL_VERSION = 1 as const
export const USAGE_BILLING_PRICING_VERSION = 'weighted-v1' as const
export const USAGE_BILLING_SOURCE = 'runtime_snapshot' as const

export type UsageBillingUsage = BeeGameUsageBillingUsage

/**
 * Facts a stage may submit.  `eventId` is the durable identity of one
 * terminal usage fact; the adapter passes it through as the billing
 * authority's existing idempotency key.
 */
export type UsageBillingInput = {
  ownerId: string
  projectId?: string
  sessionId: string
  turnId?: string
  eventId: string
  usage: UsageBillingUsage
  metadata?: Readonly<Record<string, unknown>>
}

export type UsageBillingReceipt = {
  protocolVersion: typeof USAGE_BILLING_PROTOCOL_VERSION
  ownerId: string
  eventId: string
  idempotencyKey: string
  pricingVersion: typeof USAGE_BILLING_PRICING_VERSION
  usageSource: typeof USAGE_BILLING_SOURCE
  usage: UsageBillingUsage
  duplicate: boolean
  recorded: {
    eventId: string
    duplicate: boolean
    weightedTokensDelta: number
    creditsMicro: number
  }
  debited: {
    eventId: string
    duplicate: boolean
    weightedTokensDelta: number
    creditsMicro: number
  }
}

/** Receipt returned when the legacy session-manager zero-token guard applies. */
export type UsageBillingSkippedReceipt = {
  protocolVersion: typeof USAGE_BILLING_PROTOCOL_VERSION
  ownerId: string
  eventId: string
  idempotencyKey: string
  pricingVersion: typeof USAGE_BILLING_PRICING_VERSION
  usageSource: typeof USAGE_BILLING_SOURCE
  usage: UsageBillingUsage
  skipped: true
  duplicate: false
}

export type UsageBillingSubmission =
  | UsageBillingReceipt
  | UsageBillingSkippedReceipt

export type UsageBillingClient = Readonly<{
  readonly protocolVersion: typeof USAGE_BILLING_PROTOCOL_VERSION
  readonly ownerId: string
  submitUsage(input: UsageBillingInput): Promise<UsageBillingSubmission>
}>

export type UsageBillingClientFactoryOptions = {
  ownerId: string
  billingClient: BeeGameUsageBillingClient
}

/**
 * Bind one owner to the canonical billing client.  This is an adapter only:
 * it creates no ledger, price calculation, retry queue, or stage state.
 */
export function createUsageBillingClient(
  options: UsageBillingClientFactoryOptions,
): UsageBillingClient
export function createUsageBillingClient(
  options: UsageBillingClientFactoryOptions,
): UsageBillingClient {
  assertExactKeys(options, FACTORY_OPTION_FIELDS, 'factory options')
  const ownerId = options.ownerId
  const billingClient = options.billingClient
  assertNonEmpty(ownerId, 'ownerId')
  if (!billingClient) {
    throw new TypeError('billingClient is required')
  }
  if (
    typeof billingClient.recordUsage !== 'function' ||
    typeof billingClient.debitRealTimeUsage !== 'function'
  ) {
    throw new TypeError('billingClient must implement recordUsage and debitRealTimeUsage')
  }

  const client: UsageBillingClient = {
    protocolVersion: USAGE_BILLING_PROTOCOL_VERSION,
    ownerId,
    submitUsage(input) {
      return submitBoundUsage(ownerId, billingClient, input)
    },
  }
  return Object.freeze(client)
}

async function submitBoundUsage(
  boundOwnerId: string,
  billingClient: BeeGameUsageBillingClient,
  input: UsageBillingInput,
): Promise<UsageBillingSubmission> {
  assertUsageInput(input)
  if (input.ownerId !== boundOwnerId) {
    throw new Error('Usage billing ownerId does not match the bound owner')
  }

  // Snapshot all caller-owned values before the first authority await.  The
  // per-call builders below then give record/debit independent copies, so a
  // mutating backend cannot alter a later debit or the returned receipt.
  const snapshotEventId = input.eventId
  const snapshotSessionId = input.sessionId
  const snapshotProjectId = input.projectId
  const snapshotTurnId = input.turnId
  const snapshotUsage = cloneUsage(input.usage)
  const snapshotMetadata = input.metadata === undefined
    ? undefined
    : cloneJsonRecord(input.metadata)
  const makeBillingInput = (): BeeGameUsageBillingRecordInput => ({
    sessionId: snapshotSessionId,
    ...(snapshotTurnId === undefined ? {} : { turnId: snapshotTurnId }),
    ...(snapshotProjectId === undefined ? {} : { projectId: snapshotProjectId }),
    usage: cloneUsage(snapshotUsage),
    // The public event identity is intentionally the existing authority key.
    idempotencyKey: snapshotEventId,
    ...(snapshotMetadata === undefined
      ? {}
      : { metadata: cloneJsonRecord(snapshotMetadata) }),
    pricingVersion: USAGE_BILLING_PRICING_VERSION,
    usageSource: USAGE_BILLING_SOURCE,
  })

  // Match the old session manager's terminal usage guard.  The caller owns
  // replay/outbox policy; a skipped zero-token fact is not sent to billing.
  if (snapshotUsage.total_tokens === 0) {
    return {
      protocolVersion: USAGE_BILLING_PROTOCOL_VERSION,
      ownerId: boundOwnerId,
      eventId: snapshotEventId,
      idempotencyKey: snapshotEventId,
      pricingVersion: USAGE_BILLING_PRICING_VERSION,
      usageSource: USAGE_BILLING_SOURCE,
      usage: cloneUsage(snapshotUsage),
      skipped: true,
      duplicate: false,
    }
  }

  // Do not catch or retry here.  If debit fails after record succeeds, a
  // caller retrying this same eventId replays record as a duplicate and then
  // retries the debit with the same authority key.
  let recorded: BeeGameUsageBillingRecordResult
  try {
    recorded = await billingClient.recordUsage(boundOwnerId, makeBillingInput())
  } catch {
    throw new Error('Usage billing submission failed')
  }
  let debited: BeeGameUsageBillingRecordResult
  try {
    debited = await billingClient.debitRealTimeUsage(boundOwnerId, makeBillingInput())
  } catch {
    throw new Error('Usage billing submission failed')
  }
  return toReceipt(boundOwnerId, snapshotEventId, snapshotUsage, recorded, debited)
}

function toReceipt(
  ownerId: string,
  eventId: string,
  usage: UsageBillingUsage,
  recorded: BeeGameUsageBillingRecordResult,
  debited: BeeGameUsageBillingRecordResult,
): UsageBillingReceipt {
  return {
    protocolVersion: USAGE_BILLING_PROTOCOL_VERSION,
    ownerId,
    eventId,
    idempotencyKey: eventId,
    pricingVersion: USAGE_BILLING_PRICING_VERSION,
    usageSource: USAGE_BILLING_SOURCE,
    usage: cloneUsage(usage),
    duplicate: recorded.duplicate || debited.duplicate,
    recorded: {
      eventId: recorded.event.id,
      duplicate: recorded.duplicate,
      weightedTokensDelta: recorded.event.weightedTokensDelta,
      creditsMicro: recorded.event.creditsMicro,
    },
    debited: {
      eventId: debited.event.id,
      duplicate: debited.duplicate,
      weightedTokensDelta: debited.event.weightedTokensDelta,
      creditsMicro: debited.event.creditsMicro,
    },
  }
}

function assertUsageInput(input: UsageBillingInput): void {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Usage billing input is required')
  }
  assertExactKeys(input, INPUT_FIELDS, 'usage input')
  assertNonEmpty(input.ownerId, 'ownerId')
  assertNonEmpty(input.sessionId, 'sessionId')
  assertNonEmpty(input.eventId, 'eventId')
  for (const [name, value] of Object.entries(input.usage ?? {})) {
    if (!USAGE_FIELDS.has(name as keyof UsageBillingUsage)) {
      throw new TypeError(`Unexpected usage field: ${name}`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer`)
    }
  }
  for (const name of USAGE_FIELDS) {
    const value = input.usage?.[name as keyof UsageBillingUsage]
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer`)
    }
  }
  for (const [name, value] of [
    ['projectId', input.projectId],
    ['turnId', input.turnId],
  ] as const) {
    if (value !== undefined) assertNonEmpty(value, name)
  }
  if (input.metadata !== undefined) cloneJsonRecord(input.metadata)
}

const USAGE_FIELDS = new Set<keyof UsageBillingUsage>([
  'prompt_tokens',
  'completion_tokens',
  'cache_read_tokens',
  'cache_creation_tokens',
  'total_tokens',
])

const FACTORY_OPTION_FIELDS = new Set(['ownerId', 'billingClient'])
const INPUT_FIELDS = new Set([
  'ownerId',
  'projectId',
  'sessionId',
  'turnId',
  'eventId',
  'usage',
  'metadata',
])

function assertExactKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  name: string,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain object`)
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Unexpected ${name} field: ${key}`)
  }
}

function cloneUsage(usage: UsageBillingUsage): UsageBillingUsage {
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_creation_tokens: usage.cache_creation_tokens,
    total_tokens: usage.total_tokens,
  }
}

function cloneJsonRecord(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const cloned = cloneJsonValue(value, new WeakSet<object>())
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
    throw new TypeError('metadata must be a JSON object')
  }
  return cloned as Record<string, unknown>
}

function cloneJsonValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('metadata numbers must be finite')
    return value
  }
  if (typeof value !== 'object') {
    throw new TypeError('metadata must contain JSON values')
  }
  if (seen.has(value)) throw new TypeError('metadata must not contain cycles')
  seen.add(value)
  if (Array.isArray(value)) {
    const array = value.map(item => cloneJsonValue(item, seen))
    seen.delete(value)
    return array
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('metadata must contain plain JSON objects')
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = cloneJsonValue(item, seen)
  }
  seen.delete(value)
  return result
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`)
  }
}
