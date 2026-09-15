export type ReviewNativeUsage = { prompt_tokens: number; completion_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; total_tokens: number }
export type ReviewUsageEvent = { type: 'result' | 'usage'; payload: Record<string, unknown>; messageId?: string }

export function getLatestRuntimeUsage(
  events: ReviewUsageEvent[],
): ReviewNativeUsage {
  // The native SDK result.modelUsage is cumulative while one accounting
  // epoch remains active. A resumed/compacted native session may start a new
  // epoch whose counters are lower than the previous terminal snapshot. Keep
  // only the latest snapshot inside each monotonic epoch, then add the epochs;
  // summing every result double-counts while taking only the final result loses
  // all usage before a native counter reset.
  const modelUsage = aggregateCumulativeModelUsage(events)
  if (modelUsage) {
    // A turn can still be in flight after the previous result. Add only the
    // stream usage emitted after the latest modelUsage result; stream usage
    // before that result is already included in its cumulative counters.
    const inFlight = latestCumulativeUsageEvent(
      events,
      findLastModelUsageEventIndex(events),
    )
    addRuntimeUsage(modelUsage, inFlight)
    return modelUsage
  }

  // Before a terminal result exists, message_delta is the only authoritative
  // usage source exposed by the streaming transport.
  const streamedUsage = latestCumulativeUsageEvent(events, -1)
  if (streamedUsage.total_tokens > 0) return streamedUsage

  return emptyRuntimeUsage()
}

function findLastModelUsageEventIndex(events: ReviewUsageEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      event?.type === 'result' &&
      getModelUsageFromEventPayload(event.payload)
    ) {
      return index
    }
  }
  return -1
}

function latestCumulativeUsageEvent(
  events: ReviewUsageEvent[],
  afterIndex: number,
): ReviewNativeUsage {
  // Counters are cumulative WITHIN a message, not across native model turns.
  // Replayed assistant snapshots share their message id with stream frames.
  // Legacy callers without ids retain the previous single-message behavior.
  const messages = new Map<string, ReviewNativeUsage>()
  for (const event of events.slice(afterIndex + 1)) {
    if (event.type !== 'usage') continue
    const key = event.messageId ?? 'legacy-unidentified-message'
    const latest = messages.get(key) ?? emptyRuntimeUsage()
    const usage = getUsageFromEventPayload(event.payload)
    latest.prompt_tokens = Math.max(latest.prompt_tokens, usage.prompt_tokens)
    latest.completion_tokens = Math.max(
      latest.completion_tokens,
      usage.completion_tokens,
    )
    latest.cache_read_tokens = Math.max(
      latest.cache_read_tokens,
      usage.cache_read_tokens,
    )
    latest.cache_creation_tokens = Math.max(
      latest.cache_creation_tokens,
      usage.cache_creation_tokens,
    )
    latest.total_tokens = latest.prompt_tokens + latest.completion_tokens + latest.cache_read_tokens + latest.cache_creation_tokens
    messages.set(key, latest)
  }
  return [...messages.values()].reduce((total, message) => { addRuntimeUsage(total, message); return total }, emptyRuntimeUsage())
}

function getUsageFromEventPayload(
  payload: Record<string, unknown> | undefined,
): ReviewNativeUsage {
  const usage = getUsageRecord(payload)
  if (!usage) {
    return emptyRuntimeUsage()
  }
  const promptTokens = normalizeFiniteNumber(
    usage.input_tokens ?? usage.prompt_tokens,
  )
  const completionTokens = normalizeFiniteNumber(
    usage.output_tokens ?? usage.completion_tokens,
  )
  const cacheReadTokens = normalizeFiniteNumber(
    usage.cache_read_input_tokens ?? usage.cache_read_tokens,
  )
  const cacheCreationTokens = normalizeFiniteNumber(
    usage.cache_creation_input_tokens ?? usage.cache_creation_tokens,
  )
  const totalTokens = normalizeFiniteNumber(
    usage.total_tokens,
    promptTokens + completionTokens + cacheReadTokens + cacheCreationTokens,
  )
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheCreationTokens,
    total_tokens: totalTokens,
  }
}

function getModelUsageFromEventPayload(
  payload: Record<string, unknown> | undefined,
): ReviewNativeUsage | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null
  const modelUsage = payload.modelUsage
  if (
    !modelUsage ||
    typeof modelUsage !== 'object' ||
    Array.isArray(modelUsage)
  )
    return null
  const total = emptyRuntimeUsage()
  let found = false
  for (const value of Object.values(modelUsage)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const usage = value as Record<string, unknown>
    const promptTokens = normalizeFiniteNumber(
      usage.inputTokens ?? usage.input_tokens,
    )
    const completionTokens = normalizeFiniteNumber(
      usage.outputTokens ?? usage.output_tokens,
    )
    const cacheReadTokens = normalizeFiniteNumber(
      usage.cacheReadInputTokens ?? usage.cache_read_input_tokens,
    )
    const cacheCreationTokens = normalizeFiniteNumber(
      usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens,
    )
    const totalTokens =
      promptTokens + completionTokens + cacheReadTokens + cacheCreationTokens
    if (totalTokens <= 0) continue
    found = true
    addRuntimeUsage(total, {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cache_read_tokens: cacheReadTokens,
      cache_creation_tokens: cacheCreationTokens,
      total_tokens: totalTokens,
    })
  }
  return found ? total : null
}

function aggregateCumulativeModelUsage(
  events: ReviewUsageEvent[],
): ReviewNativeUsage | null {
  const epochs: ReviewNativeUsage[] = []
  let latestInEpoch: ReviewNativeUsage | null = null
  for (const event of events) {
    if (event.type !== 'result') continue
    const snapshot = getModelUsageFromEventPayload(event.payload)
    if (!snapshot) continue
    if (latestInEpoch && hasCumulativeCounterReset(latestInEpoch, snapshot)) {
      epochs.push(latestInEpoch)
    }
    latestInEpoch = snapshot
  }
  if (latestInEpoch) epochs.push(latestInEpoch)
  if (epochs.length === 0) return null
  return epochs.reduce((total, usage) => {
    addRuntimeUsage(total, usage)
    return total
  }, emptyRuntimeUsage())
}

function hasCumulativeCounterReset(
  previous: ReviewNativeUsage,
  current: ReviewNativeUsage,
): boolean {
  return (
    current.prompt_tokens < previous.prompt_tokens ||
    current.completion_tokens < previous.completion_tokens ||
    current.cache_read_tokens < previous.cache_read_tokens ||
    current.cache_creation_tokens < previous.cache_creation_tokens
  )
}

function emptyRuntimeUsage(): ReviewNativeUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_tokens: 0,
  }
}

function addRuntimeUsage(
  target: ReviewNativeUsage,
  value: ReviewNativeUsage,
): void {
  target.prompt_tokens += value.prompt_tokens
  target.completion_tokens += value.completion_tokens
  target.cache_read_tokens += value.cache_read_tokens
  target.cache_creation_tokens += value.cache_creation_tokens
  target.total_tokens += value.total_tokens
}

function getUsageRecord(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const directUsage = payload.usage
  if (
    directUsage &&
    typeof directUsage === 'object' &&
    !Array.isArray(directUsage)
  ) {
    return directUsage as Record<string, unknown>
  }
  const event = payload.event
  if (event && typeof event === 'object' && !Array.isArray(event)) {
    const eventRecord = event as Record<string, unknown>
    const eventUsage = eventRecord.usage
    if (
      eventUsage &&
      typeof eventUsage === 'object' &&
      !Array.isArray(eventUsage)
    ) {
      return eventUsage as Record<string, unknown>
    }
    const eventMessage = eventRecord.message
    if (
      eventMessage &&
      typeof eventMessage === 'object' &&
      !Array.isArray(eventMessage)
    ) {
      const eventMessageUsage = (eventMessage as Record<string, unknown>).usage
      if (
        eventMessageUsage &&
        typeof eventMessageUsage === 'object' &&
        !Array.isArray(eventMessageUsage)
      ) {
        return eventMessageUsage as Record<string, unknown>
      }
    }
  }
  const message = payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null
  }
  const messageUsage = (message as Record<string, unknown>).usage
  if (
    messageUsage &&
    typeof messageUsage === 'object' &&
    !Array.isArray(messageUsage)
  ) {
    return messageUsage as Record<string, unknown>
  }
  return null
}

function normalizeFiniteNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  if (Number.isFinite(number) && number > 0) return number
  return Math.max(0, fallback)
}
