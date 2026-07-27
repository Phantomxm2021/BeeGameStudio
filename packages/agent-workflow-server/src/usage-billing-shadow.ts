import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SHADOW_PRICING_VERSION = 'weighted-v1'
export const SHADOW_CREDIT_SCALE = 1_000_000

export const DEFAULT_SHADOW_TOKEN_WEIGHTS = {
  input: 1,
  cacheRead: 0.1,
  cacheCreation: 1.25,
  output: 5,
} as const

export type ShadowUsage = {
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
}

export type ShadowUsageDelta = ShadowUsage

export type ShadowUsageEvent = {
  id: string
  idempotencyKey: string
  userId: string
  sessionId: string
  turnId?: string
  projectId?: string
  pricingVersion: string
  usageSource: 'runtime_snapshot' | 'model_runtime_host'
  usage: ShadowUsage
  delta: ShadowUsageDelta
  weightedTokens: number
  weightedTokensDelta: number
  shadowCreditsMicro: number
  createdAt: string
  metadata: Record<string, unknown>
}

export type ShadowUsageLedger = {
  version: 1
  events: ShadowUsageEvent[]
}

export type RecordShadowUsageInput = {
  dataDir: string
  userId: string
  sessionId: string
  turnId?: string
  projectId?: string
  usage: ShadowUsage
  idempotencyKey: string
  metadata?: Record<string, unknown>
  pricingVersion?: string
  usageSource?: ShadowUsageEvent['usageSource']
  now?: Date
}

export type RecordShadowUsageResult = {
  event: ShadowUsageEvent
  duplicate: boolean
  cumulativeUsage: ShadowUsage
  cumulativeWeightedTokens: number
  shadowCreditsMicro: number
}

export type ShadowUsageSummary = {
  eventsCount: number
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  weightedTokens: number
  shadowCreditsMicro: number
}

const SHADOW_STORE_FILE = 'usage-billing-shadow.json'

export function calculateShadowWeightedTokens(usage: ShadowUsage): number {
  const hundredths =
    normalizeNonNegative(usage.prompt_tokens) *
      toHundredths(DEFAULT_SHADOW_TOKEN_WEIGHTS.input) +
    normalizeNonNegative(usage.cache_read_tokens) *
      toHundredths(DEFAULT_SHADOW_TOKEN_WEIGHTS.cacheRead) +
    normalizeNonNegative(usage.cache_creation_tokens) *
      toHundredths(DEFAULT_SHADOW_TOKEN_WEIGHTS.cacheCreation) +
    normalizeNonNegative(usage.completion_tokens) *
      toHundredths(DEFAULT_SHADOW_TOKEN_WEIGHTS.output)
  return Math.ceil(hundredths / 100)
}

export function calculateShadowCreditsMicro(weightedTokens: number): number {
  return Math.max(
    0,
    Math.round(
      (normalizeNonNegative(weightedTokens) * SHADOW_CREDIT_SCALE) / 10_000,
    ),
  )
}

export function subtractShadowUsage(
  current: ShadowUsage,
  previous: ShadowUsage,
): ShadowUsageDelta {
  return {
    prompt_tokens: Math.max(
      0,
      normalizeNonNegative(current.prompt_tokens) -
        normalizeNonNegative(previous.prompt_tokens),
    ),
    completion_tokens: Math.max(
      0,
      normalizeNonNegative(current.completion_tokens) -
        normalizeNonNegative(previous.completion_tokens),
    ),
    cache_read_tokens: Math.max(
      0,
      normalizeNonNegative(current.cache_read_tokens) -
        normalizeNonNegative(previous.cache_read_tokens),
    ),
    cache_creation_tokens: Math.max(
      0,
      normalizeNonNegative(current.cache_creation_tokens) -
        normalizeNonNegative(previous.cache_creation_tokens),
    ),
    total_tokens: Math.max(
      0,
      normalizeNonNegative(current.total_tokens) -
        normalizeNonNegative(previous.total_tokens),
    ),
  }
}

export function addShadowUsage(
  left: ShadowUsage,
  right: ShadowUsage,
): ShadowUsage {
  return {
    prompt_tokens:
      normalizeNonNegative(left.prompt_tokens) +
      normalizeNonNegative(right.prompt_tokens),
    completion_tokens:
      normalizeNonNegative(left.completion_tokens) +
      normalizeNonNegative(right.completion_tokens),
    cache_read_tokens:
      normalizeNonNegative(left.cache_read_tokens) +
      normalizeNonNegative(right.cache_read_tokens),
    cache_creation_tokens:
      normalizeNonNegative(left.cache_creation_tokens) +
      normalizeNonNegative(right.cache_creation_tokens),
    total_tokens:
      normalizeNonNegative(left.total_tokens) +
      normalizeNonNegative(right.total_tokens),
  }
}

export function recordShadowUsage(
  input: RecordShadowUsageInput,
): RecordShadowUsageResult {
  const idempotencyKey = input.idempotencyKey.trim()
  if (!idempotencyKey)
    throw new Error('Shadow usage idempotency key is required')
  const ledger = loadShadowUsageLedger(input.dataDir)
  const existing = ledger.events.find(
    event =>
      event.userId === input.userId && event.idempotencyKey === idempotencyKey,
  )
  if (existing) {
    return {
      event: existing,
      duplicate: true,
      cumulativeUsage: cumulativeUsageForSession(
        ledger.events,
        input.userId,
        input.sessionId,
      ),
      cumulativeWeightedTokens: cumulativeWeightedTokensForSession(
        ledger.events,
        input.userId,
        input.sessionId,
      ),
      shadowCreditsMicro: sumShadowCredits(
        ledger.events,
        input.userId,
        input.sessionId,
      ),
    }
  }

  const previousUsage = latestUsageForSession(
    ledger.events,
    input.userId,
    input.sessionId,
  )
  const usage = normalizeShadowUsage(input.usage)
  const reset = isShadowUsageReset(usage, previousUsage)
  const delta = reset ? usage : subtractShadowUsage(usage, previousUsage)
  const weightedTokens = calculateShadowWeightedTokens(usage)
  const previousWeightedTokens = calculateShadowWeightedTokens(previousUsage)
  const weightedTokensDelta = reset
    ? weightedTokens
    : Math.max(0, weightedTokens - previousWeightedTokens)
  const event: ShadowUsageEvent = {
    id: randomUUID(),
    idempotencyKey,
    userId: input.userId,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    pricingVersion: input.pricingVersion ?? SHADOW_PRICING_VERSION,
    usageSource: input.usageSource ?? 'runtime_snapshot',
    usage,
    delta,
    weightedTokens,
    weightedTokensDelta,
    shadowCreditsMicro: calculateShadowCreditsMicro(weightedTokensDelta),
    createdAt: (input.now ?? new Date()).toISOString(),
    metadata: input.metadata ?? {},
  }
  ledger.events.push(event)
  saveShadowUsageLedger(input.dataDir, ledger)
  return {
    event,
    duplicate: false,
    cumulativeUsage: cumulativeUsageForSession(
      ledger.events,
      input.userId,
      input.sessionId,
    ),
    cumulativeWeightedTokens: cumulativeWeightedTokensForSession(
      ledger.events,
      input.userId,
      input.sessionId,
    ),
    shadowCreditsMicro: sumShadowCredits(
      ledger.events,
      input.userId,
      input.sessionId,
    ),
  }
}

export function listShadowUsageEvents(
  dataDir: string,
  filters: { userId?: string; sessionId?: string; projectId?: string } = {},
): ShadowUsageEvent[] {
  return loadShadowUsageLedger(dataDir).events.filter(
    event =>
      (!filters.userId || event.userId === filters.userId) &&
      (!filters.sessionId || event.sessionId === filters.sessionId) &&
      (!filters.projectId || event.projectId === filters.projectId),
  )
}

export function summarizeShadowUsage(
  events: ShadowUsageEvent[],
): ShadowUsageSummary {
  const usage = events.reduce(
    (total, event) => addShadowUsage(total, event.delta),
    emptyShadowUsage(),
  )
  return {
    eventsCount: events.length,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    cacheReadTokens: usage.cache_read_tokens,
    cacheCreationTokens: usage.cache_creation_tokens,
    totalTokens: usage.total_tokens,
    weightedTokens: events.reduce(
      (total, event) => total + event.weightedTokensDelta,
      0,
    ),
    shadowCreditsMicro: events.reduce(
      (total, event) => total + event.shadowCreditsMicro,
      0,
    ),
  }
}

function emptyShadowUsage(): ShadowUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_tokens: 0,
  }
}

function normalizeShadowUsage(usage: ShadowUsage): ShadowUsage {
  return {
    prompt_tokens: normalizeNonNegative(usage.prompt_tokens),
    completion_tokens: normalizeNonNegative(usage.completion_tokens),
    cache_read_tokens: normalizeNonNegative(usage.cache_read_tokens),
    cache_creation_tokens: normalizeNonNegative(usage.cache_creation_tokens),
    total_tokens: normalizeNonNegative(usage.total_tokens),
  }
}

function isShadowUsageReset(
  current: ShadowUsage,
  previous: ShadowUsage,
): boolean {
  return (
    current.prompt_tokens < previous.prompt_tokens ||
    current.completion_tokens < previous.completion_tokens ||
    current.cache_read_tokens < previous.cache_read_tokens ||
    current.cache_creation_tokens < previous.cache_creation_tokens ||
    current.total_tokens < previous.total_tokens
  )
}

function latestUsageForSession(
  events: ShadowUsageEvent[],
  userId: string,
  sessionId: string,
): ShadowUsage {
  const sessionEvents = events.filter(
    event => event.userId === userId && event.sessionId === sessionId,
  )
  return sessionEvents.length
    ? sessionEvents[sessionEvents.length - 1].usage
    : emptyShadowUsage()
}

function cumulativeUsageForSession(
  events: ShadowUsageEvent[],
  userId: string,
  sessionId: string,
): ShadowUsage {
  return events
    .filter(event => event.userId === userId && event.sessionId === sessionId)
    .reduce(
      (total, event) => addShadowUsage(total, event.delta),
      emptyShadowUsage(),
    )
}

function cumulativeWeightedTokensForSession(
  events: ShadowUsageEvent[],
  userId: string,
  sessionId: string,
): number {
  return events
    .filter(event => event.userId === userId && event.sessionId === sessionId)
    .reduce((total, event) => total + event.weightedTokensDelta, 0)
}

function sumShadowCredits(
  events: ShadowUsageEvent[],
  userId: string,
  sessionId: string,
): number {
  return events
    .filter(event => event.userId === userId && event.sessionId === sessionId)
    .reduce((total, event) => total + event.shadowCreditsMicro, 0)
}

function normalizeNonNegative(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function toHundredths(value: number): number {
  return Math.round(value * 100)
}

function getShadowStorePath(dataDir: string): string {
  return join(dataDir, SHADOW_STORE_FILE)
}

function loadShadowUsageLedger(dataDir: string): ShadowUsageLedger {
  const path = getShadowStorePath(dataDir)
  try {
    const parsed = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as Partial<ShadowUsageLedger>
    return {
      version: 1,
      events: Array.isArray(parsed.events)
        ? parsed.events.filter(isShadowUsageEvent)
        : [],
    }
  } catch {
    return { version: 1, events: [] }
  }
}

function saveShadowUsageLedger(
  dataDir: string,
  ledger: ShadowUsageLedger,
): void {
  mkdirSync(dirname(getShadowStorePath(dataDir)), { recursive: true })
  const path = getShadowStorePath(dataDir)
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(ledger, null, 2))
  renameSync(temporaryPath, path)
}

function isShadowUsageEvent(value: unknown): value is ShadowUsageEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Partial<ShadowUsageEvent>
  return (
    typeof event.id === 'string' &&
    typeof event.idempotencyKey === 'string' &&
    typeof event.userId === 'string' &&
    typeof event.sessionId === 'string' &&
    typeof event.pricingVersion === 'string' &&
    typeof event.weightedTokensDelta === 'number' &&
    typeof event.shadowCreditsMicro === 'number' &&
    typeof event.usage === 'object' &&
    typeof event.delta === 'object'
  )
}
