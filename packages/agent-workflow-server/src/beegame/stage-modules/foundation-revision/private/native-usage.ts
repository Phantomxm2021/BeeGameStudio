import { revisionCanonicalJson } from './json-digest'

export type RevisionNativeUsage = {
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
}

/**
 * A captured native usage observation. `usage` is always a complete,
 * normalized snapshot; the presence of an event is significant even when all
 * counters are zero for a wire usage observation. A zero modelUsage snapshot
 * is not a cumulative result, matching the old runtime. No native message
 * body, model name, or credential is retained.
 */
export type RevisionUsageEvent = {
  type: 'result' | 'usage'
  usage: RevisionNativeUsage
}

const WIRE_USAGE_KEYS = [
  ['input_tokens', 'prompt_tokens'],
  ['output_tokens', 'completion_tokens'],
  ['cache_read_input_tokens', 'cache_read_tokens'],
  ['cache_creation_input_tokens', 'cache_creation_tokens'],
] as const

const MODEL_USAGE_KEYS = [
  ['inputTokens', 'input_tokens'],
  ['outputTokens', 'output_tokens'],
  ['cacheReadInputTokens', 'cache_read_input_tokens'],
  ['cacheCreationInputTokens', 'cache_creation_input_tokens'],
] as const

/**
 * Capture only the usage fields needed by the Revision reducer. Undefined
 * means this native message carried no usable counter observation. A native
 * message which explicitly reports zero wire counters returns a zero event,
 * so callers can distinguish measured zero from no observation.
 */
export function captureRevisionUsageEvent(message: unknown): RevisionUsageEvent | undefined {
  let captured: unknown
  try {
    captured = JSON.parse(revisionCanonicalJson(message)) as unknown
  } catch {
    return undefined
  }
  if (!captured || typeof captured !== 'object' || Array.isArray(captured)) return undefined
  const record = captured as Record<string, unknown>

  const modelUsage = record.type === 'result' ? objectField(record, 'modelUsage') : undefined
  if (modelUsage) {
    const aggregate = emptyRuntimeUsage()
    let positive = false
    for (const value of Object.values(modelUsage)) {
      const model = objectField(value)
      if (!model) continue
      const counters = countersFromRecord(model, MODEL_USAGE_KEYS)
      if (counters?.overflow) return undefined
      if (!counters) continue
      if (counters.usage.total_tokens <= 0) continue
      positive = true
      if (!addRuntimeUsage(aggregate, counters.usage)) return undefined
    }
    if (positive) return { type: 'result', usage: aggregate }
  }

  const usage = findUsageRecord(record)
  if (!usage) return undefined
  const counters = countersFromRecord(usage, WIRE_USAGE_KEYS)
  return counters && !counters.overflow ? { type: 'usage', usage: counters.usage } : undefined
}

/**
 * Reproduce the old runtime's cumulative model epochs and in-flight stream
 * maximums over already-captured Revision observations.
 */
export function getLatestRevisionRuntimeUsage(events: readonly RevisionUsageEvent[]): RevisionNativeUsage {
  const capturedEvents = validateUsageEvents(events)
  const modelUsage = aggregateCumulativeModelUsage(capturedEvents)
  if (modelUsage) {
    const inFlight = latestCumulativeUsageEvent(capturedEvents, findLastModelUsageEventIndex(capturedEvents))
    addOrThrow(modelUsage, inFlight)
    return modelUsage
  }

  const streamedUsage = latestCumulativeUsageEvent(capturedEvents, -1)
  if (streamedUsage.total_tokens > 0) return streamedUsage
  return emptyRuntimeUsage()
}

function findUsageRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = objectField(record, 'usage')
  if (direct) return direct
  const event = objectField(record, 'event')
  const eventUsage = event ? objectField(event, 'usage') : undefined
  if (eventUsage) return eventUsage
  const eventMessage = event ? objectField(event, 'message') : undefined
  const nestedEventUsage = eventMessage ? objectField(eventMessage, 'usage') : undefined
  if (nestedEventUsage) return nestedEventUsage
  const message = objectField(record, 'message')
  return message ? objectField(message, 'usage') : undefined
}

function countersFromRecord(
  record: Record<string, unknown>,
  keys: readonly (readonly [string, string])[],
): { usage: RevisionNativeUsage; overflow: boolean } | undefined {
  let observed = false
  const valueFor = (index: number): number => {
    const [key, alternate] = keys[index]!
    const candidate = record[key] ?? record[alternate]
    const normalized = finiteNonNegative(candidate)
    if (candidate !== undefined && normalized !== undefined) observed = true
    return normalized ?? 0
  }
  const prompt = valueFor(0)
  const completion = valueFor(1)
  const cacheRead = valueFor(2)
  const cacheCreation = valueFor(3)
  if (!observed) return undefined
  const total = prompt + completion + cacheRead + cacheCreation
  if (!Number.isFinite(total)) return { usage: emptyRuntimeUsage(), overflow: true }
  return { usage: {
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
    total_tokens: total,
  }, overflow: false }
}

function aggregateCumulativeModelUsage(events: readonly RevisionUsageEvent[]): RevisionNativeUsage | null {
  const epochs: RevisionNativeUsage[] = []
  let latestInEpoch: RevisionNativeUsage | null = null
  for (const event of events) {
    if (event.type !== 'result') continue
    if (latestInEpoch && hasCumulativeCounterReset(latestInEpoch, event.usage)) epochs.push(latestInEpoch)
    latestInEpoch = event.usage
  }
  if (latestInEpoch) epochs.push(latestInEpoch)
  if (epochs.length === 0) return null
  return epochs.reduce((total, usage) => {
    addOrThrow(total, usage)
    return total
  }, emptyRuntimeUsage())
}

function findLastModelUsageEventIndex(events: readonly RevisionUsageEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'result') return index
  }
  return -1
}

function latestCumulativeUsageEvent(events: readonly RevisionUsageEvent[], afterIndex: number): RevisionNativeUsage {
  const latest = emptyRuntimeUsage()
  for (const event of events.slice(afterIndex + 1)) {
    if (event.type !== 'usage') continue
    latest.prompt_tokens = Math.max(latest.prompt_tokens, event.usage.prompt_tokens)
    latest.completion_tokens = Math.max(latest.completion_tokens, event.usage.completion_tokens)
    latest.cache_read_tokens = Math.max(latest.cache_read_tokens, event.usage.cache_read_tokens)
    latest.cache_creation_tokens = Math.max(latest.cache_creation_tokens, event.usage.cache_creation_tokens)
  }
  latest.total_tokens = latest.prompt_tokens + latest.completion_tokens + latest.cache_read_tokens + latest.cache_creation_tokens
  if (!Number.isFinite(latest.total_tokens)) throw new Error('Revision native usage total overflow')
  return latest
}

function hasCumulativeCounterReset(previous: RevisionNativeUsage, current: RevisionNativeUsage): boolean {
  return current.prompt_tokens < previous.prompt_tokens ||
    current.completion_tokens < previous.completion_tokens ||
    current.cache_read_tokens < previous.cache_read_tokens ||
    current.cache_creation_tokens < previous.cache_creation_tokens
}

function objectField(value: unknown, key?: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (key === undefined) return value as Record<string, unknown>
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field) ? field as Record<string, unknown> : undefined
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function validateUsageEvents(events: readonly RevisionUsageEvent[]): RevisionUsageEvent[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(revisionCanonicalJson(events)) as unknown
  } catch (error) {
    throw error instanceof Error ? error : new Error('Revision native usage events are not JSON')
  }
  if (!Array.isArray(parsed)) throw new Error('Revision native usage events must be an array')
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Revision native usage event ${index} is invalid`)
    const event = item as Record<string, unknown>
    if (!hasExactKeys(event, ['type', 'usage']) || (event.type !== 'result' && event.type !== 'usage'))
      throw new Error(`Revision native usage event ${index} has an invalid shape`)
    const usageValue = event.usage
    if (!usageValue || typeof usageValue !== 'object' || Array.isArray(usageValue)) throw new Error(`Revision native usage event ${index} has invalid usage`)
    const usage = usageValue as Record<string, unknown>
    if (!hasExactKeys(usage, ['prompt_tokens', 'completion_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'total_tokens']))
      throw new Error(`Revision native usage event ${index} has extra usage fields`)
    const values = ['prompt_tokens', 'completion_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'total_tokens']
      .map(key => usage[key])
    if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0))
      throw new Error(`Revision native usage event ${index} has invalid counters`)
    const [prompt, completion, cacheRead, cacheCreation, total] = values as number[]
    if (prompt + completion + cacheRead + cacheCreation !== total || !Number.isFinite(total))
      throw new Error(`Revision native usage event ${index} has inconsistent total`)
    if (event.type === 'result' && total <= 0)
      throw new Error(`Revision native usage event ${index} has an empty result snapshot`)
    return {
      type: event.type,
      usage: { prompt_tokens: prompt, completion_tokens: completion, cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreation, total_tokens: total },
    }
  })
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function emptyRuntimeUsage(): RevisionNativeUsage {
  return { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }
}

function addRuntimeUsage(target: RevisionNativeUsage, value: RevisionNativeUsage): boolean {
  const prompt = target.prompt_tokens + value.prompt_tokens
  const completion = target.completion_tokens + value.completion_tokens
  const cacheRead = target.cache_read_tokens + value.cache_read_tokens
  const cacheCreation = target.cache_creation_tokens + value.cache_creation_tokens
  const total = target.total_tokens + value.total_tokens
  if (![prompt, completion, cacheRead, cacheCreation, total].every(Number.isFinite)) return false
  target.prompt_tokens = prompt
  target.completion_tokens = completion
  target.cache_read_tokens = cacheRead
  target.cache_creation_tokens = cacheCreation
  target.total_tokens = total
  return true
}

function addOrThrow(target: RevisionNativeUsage, value: RevisionNativeUsage): void {
  if (!addRuntimeUsage(target, value)) throw new Error('Revision native usage total overflow')
}
