import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const USAGE_PRICING_VERSION = 'weighted-v1'
export const USAGE_CREDIT_SCALE = 1_000_000

export const DEFAULT_USAGE_TOKEN_WEIGHTS = {
  input: 1,
  cacheRead: 0.25,
  cacheCreation: 1.25,
  output: 5,
} as const

export type Usage = {
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
}

export type UsageDelta = Usage

export type UsageEvent = {
  id: string
  idempotencyKey: string
  userId: string
  sessionId: string
  turnId?: string
  projectId?: string
  pricingVersion: string
  usageSource: 'runtime_snapshot' | 'model_runtime_host'
  usage: Usage
  delta: UsageDelta
  weightedTokens: number
  weightedTokensDelta: number
  creditsMicro: number
  createdAt: string
  metadata: Record<string, unknown>
}

export type UsageLedger = {
  version: 1
  events: UsageEvent[]
}

export type RecordUsageInput = {
  dataDir: string
  userId: string
  sessionId: string
  turnId?: string
  projectId?: string
  usage: Usage
  idempotencyKey: string
  metadata?: Record<string, unknown>
  pricingVersion?: string
  usageSource?: UsageEvent['usageSource']
  now?: Date
}

export type RecordUsageResult = {
  event: UsageEvent
  duplicate: boolean
  cumulativeUsage: Usage
  cumulativeWeightedTokens: number
  creditsMicro: number
}

export type UsageSummary = {
  eventsCount: number
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  weightedTokens: number
  creditsMicro: number
}

const USAGE_STORE_FILE = 'usage-billing-events.json'

export function calculateWeightedTokens(usage: Usage): number {
  const hundredths =
    normalizeNonNegative(usage.prompt_tokens) *
      toHundredths(DEFAULT_USAGE_TOKEN_WEIGHTS.input) +
    normalizeNonNegative(usage.cache_read_tokens) *
      toHundredths(DEFAULT_USAGE_TOKEN_WEIGHTS.cacheRead) +
    normalizeNonNegative(usage.cache_creation_tokens) *
      toHundredths(DEFAULT_USAGE_TOKEN_WEIGHTS.cacheCreation) +
    normalizeNonNegative(usage.completion_tokens) *
      toHundredths(DEFAULT_USAGE_TOKEN_WEIGHTS.output)
  return Math.ceil(hundredths / 100)
}

export function calculateCreditsMicro(weightedTokens: number): number {
  return Math.max(
    0,
    Math.round(
      (normalizeNonNegative(weightedTokens) * USAGE_CREDIT_SCALE) / 10_000,
    ),
  )
}

export function subtractUsage(
  current: Usage,
  previous: Usage,
): UsageDelta {
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

export function addUsage(
  left: Usage,
  right: Usage,
): Usage {
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

export function recordUsage(
  input: RecordUsageInput,
): RecordUsageResult {
  const idempotencyKey = input.idempotencyKey.trim()
  if (!idempotencyKey)
    throw new Error('Usage idempotency key is required')
  const ledger = loadUsageLedger(input.dataDir)
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
      creditsMicro: sumCredits(
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
  const usage = normalizeUsage(input.usage)
  const reset = isUsageReset(usage, previousUsage)
  const delta = reset ? usage : subtractUsage(usage, previousUsage)
  const weightedTokens = calculateWeightedTokens(usage)
  const previousWeightedTokens = calculateWeightedTokens(previousUsage)
  const weightedTokensDelta = reset
    ? weightedTokens
    : Math.max(0, weightedTokens - previousWeightedTokens)
  const event: UsageEvent = {
    id: randomUUID(),
    idempotencyKey,
    userId: input.userId,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    pricingVersion: input.pricingVersion ?? USAGE_PRICING_VERSION,
    usageSource: input.usageSource ?? 'runtime_snapshot',
    usage,
    delta,
    weightedTokens,
    weightedTokensDelta,
    creditsMicro: calculateCreditsMicro(weightedTokensDelta),
    createdAt: (input.now ?? new Date()).toISOString(),
    metadata: input.metadata ?? {},
  }
  ledger.events.push(event)
  saveUsageLedger(input.dataDir, ledger)
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
    creditsMicro: sumCredits(
      ledger.events,
      input.userId,
      input.sessionId,
    ),
  }
}

export function listUsageEvents(
  dataDir: string,
  filters: { userId?: string; sessionId?: string; projectId?: string } = {},
): UsageEvent[] {
  return loadUsageLedger(dataDir).events.filter(
    event =>
      (!filters.userId || event.userId === filters.userId) &&
      (!filters.sessionId || event.sessionId === filters.sessionId) &&
      (!filters.projectId || event.projectId === filters.projectId),
  )
}

export function summarizeUsage(
  events: UsageEvent[],
): UsageSummary {
  const usage = events.reduce(
    (total, event) => addUsage(total, event.delta),
    emptyUsage(),
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
    creditsMicro: events.reduce(
      (total, event) => total + event.creditsMicro,
      0,
    ),
  }
}

function emptyUsage(): Usage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_tokens: 0,
  }
}

function normalizeUsage(usage: Usage): Usage {
  return {
    prompt_tokens: normalizeNonNegative(usage.prompt_tokens),
    completion_tokens: normalizeNonNegative(usage.completion_tokens),
    cache_read_tokens: normalizeNonNegative(usage.cache_read_tokens),
    cache_creation_tokens: normalizeNonNegative(usage.cache_creation_tokens),
    total_tokens: normalizeNonNegative(usage.total_tokens),
  }
}

function isUsageReset(
  current: Usage,
  previous: Usage,
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
  events: UsageEvent[],
  userId: string,
  sessionId: string,
): Usage {
  const sessionEvents = events.filter(
    event => event.userId === userId && event.sessionId === sessionId,
  )
  return sessionEvents.length
    ? sessionEvents[sessionEvents.length - 1].usage
    : emptyUsage()
}

function cumulativeUsageForSession(
  events: UsageEvent[],
  userId: string,
  sessionId: string,
): Usage {
  return events
    .filter(event => event.userId === userId && event.sessionId === sessionId)
    .reduce(
      (total, event) => addUsage(total, event.delta),
      emptyUsage(),
    )
}

function cumulativeWeightedTokensForSession(
  events: UsageEvent[],
  userId: string,
  sessionId: string,
): number {
  return events
    .filter(event => event.userId === userId && event.sessionId === sessionId)
    .reduce((total, event) => total + event.weightedTokensDelta, 0)
}

function sumCredits(
  events: UsageEvent[],
  userId: string,
  sessionId: string,
): number {
  return events
    .filter(event => event.userId === userId && event.sessionId === sessionId)
    .reduce((total, event) => total + event.creditsMicro, 0)
}

function normalizeNonNegative(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function toHundredths(value: number): number {
  return Math.round(value * 100)
}

function getUsageStorePath(dataDir: string): string {
  return join(dataDir, USAGE_STORE_FILE)
}

function loadUsageLedger(dataDir: string): UsageLedger {
  const path = getUsageStorePath(dataDir)
  try {
    const parsed = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as Partial<UsageLedger>
    return {
      version: 1,
      events: Array.isArray(parsed.events)
        ? parsed.events.filter(isUsageEvent)
        : [],
    }
  } catch {
    return { version: 1, events: [] }
  }
}

function saveUsageLedger(
  dataDir: string,
  ledger: UsageLedger,
): void {
  mkdirSync(dirname(getUsageStorePath(dataDir)), { recursive: true })
  const path = getUsageStorePath(dataDir)
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(ledger, null, 2))
  renameSync(temporaryPath, path)
}

function isUsageEvent(value: unknown): value is UsageEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Partial<UsageEvent>
  return (
    typeof event.id === 'string' &&
    typeof event.idempotencyKey === 'string' &&
    typeof event.userId === 'string' &&
    typeof event.sessionId === 'string' &&
    typeof event.pricingVersion === 'string' &&
    typeof event.weightedTokensDelta === 'number' &&
    typeof event.creditsMicro === 'number' &&
    typeof event.usage === 'object' &&
    typeof event.delta === 'object'
  )
}
