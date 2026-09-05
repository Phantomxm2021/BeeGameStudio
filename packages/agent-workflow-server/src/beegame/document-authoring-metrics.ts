import type { BeeGameEvent } from './session-manager'

export type DocumentAuthoringMetrics = {
  usageStatus: 'measured' | 'unavailable'
  inputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  outputTokens: number
  rawProcessedTokens: number
  nativeTurns: number
  toolCalls: Record<string, number>
  failedToolCalls: number
  permissionDenials: number
  authorityProjection?: {
    byteLength: number
    modelByteLength?: number
    promptByteLength?: number
    rangeCount: number
    projectedLineCount: number
  }
}

export type DocumentAuthoringResponseMetrics = {
  responseIndex: number
  messageId?: string
  stopReason?: string
  textBytes: number
  thinkingBytes: number
  firstTextMs?: number
  durationMs?: number
  usage?: DocumentAuthoringResponseUsage
  /** max_tokens is a truncation signal; it does not prove a continuation happened. */
  truncatedByMaxTokens: boolean
  /** True only when a later native response starts after this max_tokens response. */
  continuationFollowed: boolean
}

export type DocumentAuthoringResponseUsage = {
  usageStatus: 'measured'
  /** message_delta usage is a per-response snapshot; snapshots are component-wise maxed. */
  usageSemantics: 'response_snapshot' | 'unavailable'
  inputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  outputTokens?: number
  rawProcessedTokens: number
}

export type DocumentAuthoringTerminalUsage = {
  usageStatus: 'measured' | 'unavailable'
  usageSemantics: 'terminal_result_cumulative'
  inputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  outputTokens?: number
  rawProcessedTokens: number
}

export type DocumentAuthoringResponseObservation = {
  responses: DocumentAuthoringResponseMetrics[]
  terminalUsage?: DocumentAuthoringTerminalUsage
  usageSemantics:
    | 'terminal_result_cumulative'
    | 'stream_response_snapshots'
    | 'unavailable'
  nativeTruncationCount: number
  nativeContinuationCount: number
}

/** One line from a native `agent.raw.jsonl` file. */
export type DocumentAuthoringRawRecord = {
  message: Record<string, unknown>
  createdAt: string | Date
}

export function documentAuthoringMetrics(
  events: readonly BeeGameEvent[],
  authorityProjection?: DocumentAuthoringMetrics['authorityProjection'],
): DocumentAuthoringMetrics | undefined {
  const result = [...events].reverse().find(event => event.type === 'result')
  if (!result?.payload) return undefined
  const usage = object(result.payload.usage)
  if (!usage) return undefined
  const inputTokens = count(usage.input_tokens)
  const cacheReadTokens = count(usage.cache_read_input_tokens)
  const cacheCreationTokens = count(usage.cache_creation_input_tokens)
  const outputTokens = count(usage.output_tokens)
  const toolCalls: Record<string, number> = {}
  for (const event of events) {
    if (event.type !== 'tool.completed') continue
    const name =
      typeof event.payload?.toolName === 'string'
        ? event.payload.toolName
        : undefined
    if (name) toolCalls[name] = (toolCalls[name] ?? 0) + 1
  }
  const permissionDenials = Array.isArray(result.payload.permission_denials)
    ? result.payload.permission_denials.length
    : events.filter(
        event =>
          event.type === 'permission.resolved' &&
          (event.payload?.decision === 'deny' ||
            event.payload?.decision === 'denied'),
      ).length
  return {
    usageStatus:
      inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens > 0
        ? 'measured'
        : 'unavailable',
    inputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    outputTokens,
    rawProcessedTokens:
      inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens,
    nativeTurns: count(result.payload.num_turns),
    toolCalls,
    failedToolCalls: events.filter(event => event.type === 'tool.failed').length,
    permissionDenials,
    ...(authorityProjection ? { authorityProjection } : {}),
  }
}

/**
 * Derive bounded response observations from the raw native records retained
 * in native `agent.raw.jsonl`. This is intentionally separate from the historical
 * terminal metric shape: callers can opt into it without changing worker
 * terminal schemas or adding a live transport path.
 */
export function documentAuthoringResponseMetrics(
  records: readonly DocumentAuthoringRawRecord[],
): DocumentAuthoringResponseObservation {
  const responses = deriveResponseMetrics(records)
  const terminal = [...records]
    .reverse()
    .find(record => record.message.type === 'result')
  const terminalUsage = terminal ? object(terminal.message.usage) : undefined
  const hasStreamUsage = responses.some(
    response => response.usage?.usageStatus === 'measured',
  )
  const nativeTruncationCount = responses.filter(
    response => response.truncatedByMaxTokens,
  ).length
  const nativeContinuationCount = responses.filter(
    response => response.continuationFollowed,
  ).length
  return {
    responses,
    ...(terminalUsage
      ? { terminalUsage: terminalUsageObservation(terminalUsage) }
      : {}),
    usageSemantics: terminalUsage
      ? 'terminal_result_cumulative'
      : hasStreamUsage
        ? 'stream_response_snapshots'
        : 'unavailable',
    nativeTruncationCount,
    nativeContinuationCount,
  }
}

function terminalUsageObservation(
  usage: Record<string, unknown>,
): DocumentAuthoringTerminalUsage {
  const values = usageValues(usage)
  return {
    usageStatus: values.rawProcessedTokens > 0 ? 'measured' : 'unavailable',
    usageSemantics: 'terminal_result_cumulative',
    ...values,
  }
}

type MutableResponseMetrics = {
  messageId?: string
  startedAt?: number
  endedAt?: number
  stopReason?: string
  textBytes: number
  thinkingBytes: number
  firstTextAt?: number
  blockTypes: Map<number, string>
  usage: {
    inputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    outputTokens: number
  }
  hasUsage: boolean
  observedUsageFields: Set<keyof MutableResponseMetrics['usage']>
  continuationFollowed: boolean
}

function deriveResponseMetrics(
  records: readonly DocumentAuthoringRawRecord[],
): DocumentAuthoringResponseMetrics[] {
  const responses: MutableResponseMetrics[] = []
  const byMessageId = new Map<string, MutableResponseMetrics>()
  const seenUuids = new Set<string>()
  let active: MutableResponseMetrics | undefined
  let last: MutableResponseMetrics | undefined

  const response = (at: number, messageId?: string): MutableResponseMetrics => {
    const existing = messageId ? byMessageId.get(messageId) : undefined
    if (existing) {
      active = existing
      last = existing
      return existing
    }
    const created: MutableResponseMetrics = {
      ...(messageId ? { messageId } : {}),
      startedAt: at,
      textBytes: 0,
      thinkingBytes: 0,
      blockTypes: new Map(),
      usage: {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      hasUsage: false,
      observedUsageFields: new Set(),
      continuationFollowed: false,
    }
    const previous = responses.at(-1)
    if (previous && previous.stopReason === 'max_tokens')
      previous.continuationFollowed = true
    responses.push(created)
    if (messageId) byMessageId.set(messageId, created)
    active = created
    last = created
    return created
  }

  const timestamp = (record: DocumentAuthoringRawRecord): number | undefined => {
    const value =
      record.createdAt instanceof Date
        ? record.createdAt.getTime()
        : Date.parse(record.createdAt)
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  const addText = (target: MutableResponseMetrics, text: string, at: number) => {
    if (!text) return
    target.textBytes += byteLength(text)
    target.firstTextAt ??= at
  }
  const addThinking = (target: MutableResponseMetrics, text: string) => {
    if (text) target.thinkingBytes += byteLength(text)
  }
  const rememberUsage = (
    target: MutableResponseMetrics,
    value: unknown,
  ): void => {
    const usage = object(value)
    if (!usage) return
    const next = {
      inputTokens: usage.input_tokens,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens,
      outputTokens: usage.output_tokens,
    }
    for (const [field, value] of Object.entries(next) as Array<
      [keyof typeof next, unknown]
    >) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        continue
      target.observedUsageFields.add(field)
      target.usage[field] = Math.max(target.usage[field], Math.floor(value))
    }
    target.hasUsage = target.observedUsageFields.size > 0
    // Providers may emit more than one partial usage snapshot. Taking the
    // component-wise maximum avoids charging the same cumulative snapshot twice.
  }

  for (const record of records) {
    const at = timestamp(record)
    if (at === undefined) continue
    const payload = record.message
    const uuid = typeof payload.uuid === 'string' ? payload.uuid : undefined
    if (uuid) {
      if (seenUuids.has(uuid)) continue
      seenUuids.add(uuid)
    }
    if (payload.type === 'stream_event') {
      const stream = object(payload.event) ?? payload
      const streamType = typeof stream.type === 'string' ? stream.type : ''
      if (streamType === 'message_start') {
        const message = object(stream.message)
        const messageId = typeof message?.id === 'string' ? message.id : undefined
        const target = response(at, messageId)
        if (message) rememberUsage(target, message.usage)
        continue
      }
      if (streamType === 'message_stop') {
        if (active) active.endedAt = at
        active = undefined
        continue
      }
      const target = active ?? response(at)
      if (streamType === 'content_block_start') {
        const index = integer(stream.index)
        const block = object(stream.content_block)
        if (index !== undefined && block && typeof block.type === 'string')
          target.blockTypes.set(index, block.type)
        continue
      }
      if (streamType === 'content_block_delta') {
        const index = integer(stream.index)
        const delta = object(stream.delta)
        const deltaType = typeof delta?.type === 'string' ? delta.type : ''
        const text = typeof delta?.text === 'string' ? delta.text : undefined
        const thinking =
          typeof delta?.thinking === 'string' ? delta.thinking : undefined
        if (deltaType === 'text_delta' && text !== undefined) addText(target, text, at)
        else if (deltaType === 'thinking_delta' && thinking !== undefined)
          addThinking(target, thinking)
        else if (index !== undefined && target.blockTypes.get(index) === 'thinking' && thinking !== undefined)
          addThinking(target, thinking)
        continue
      }
      if (streamType === 'message_delta') {
        const delta = object(stream.delta)
        const stopReason = typeof delta?.stop_reason === 'string' ? delta.stop_reason : undefined
        if (stopReason) target.stopReason = stopReason
        rememberUsage(target, stream.usage)
        continue
      }
      continue
    }
    if (payload.type === 'result') {
      if (last && typeof payload.stop_reason === 'string')
        last.stopReason = payload.stop_reason
    }
  }

  if (responses.length === 0) return []
  return responses.map((item, responseIndex) => {
    const hasUsage = item.hasUsage
    const durationMs =
      item.startedAt !== undefined && item.endedAt !== undefined
        ? Math.max(0, item.endedAt - item.startedAt)
        : undefined
    const firstTextMs =
      item.startedAt !== undefined && item.firstTextAt !== undefined
        ? Math.max(0, item.firstTextAt - item.startedAt)
        : undefined
    return {
      responseIndex,
      ...(item.messageId ? { messageId: item.messageId } : {}),
      ...(item.stopReason ? { stopReason: item.stopReason } : {}),
      textBytes: item.textBytes,
      thinkingBytes: item.thinkingBytes,
      ...(firstTextMs !== undefined ? { firstTextMs } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(hasUsage
        ? {
            usage: {
              usageStatus: 'measured' as const,
              usageSemantics: 'response_snapshot' as const,
              ...observedUsage(item),
              rawProcessedTokens: Object.values(item.usage).reduce(
                (sum, value) => sum + value,
                0,
              ),
            },
          }
        : {}),
      truncatedByMaxTokens: item.stopReason === 'max_tokens',
      continuationFollowed: item.continuationFollowed,
    }
  })
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function observedUsage(
  item: MutableResponseMetrics,
): Pick<DocumentAuthoringResponseUsage, 'inputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'outputTokens'> {
  const observed = {} as Pick<
    DocumentAuthoringResponseUsage,
    'inputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'outputTokens'
  >
  for (const field of item.observedUsageFields) observed[field] = item.usage[field]
  return observed
}

function usageValues(usage: Record<string, unknown>): {
  inputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  outputTokens?: number
  rawProcessedTokens: number
} {
  const values = {
    ...(typeof usage.input_tokens === 'number' && Number.isFinite(usage.input_tokens)
      ? { inputTokens: Math.max(0, Math.floor(usage.input_tokens)) }
      : {}),
    ...(typeof usage.cache_read_input_tokens === 'number' && Number.isFinite(usage.cache_read_input_tokens)
      ? { cacheReadTokens: Math.max(0, Math.floor(usage.cache_read_input_tokens)) }
      : {}),
    ...(typeof usage.cache_creation_input_tokens === 'number' && Number.isFinite(usage.cache_creation_input_tokens)
      ? { cacheCreationTokens: Math.max(0, Math.floor(usage.cache_creation_input_tokens)) }
      : {}),
    ...(typeof usage.output_tokens === 'number' && Number.isFinite(usage.output_tokens)
      ? { outputTokens: Math.max(0, Math.floor(usage.output_tokens)) }
      : {}),
  }
  return { ...values, rawProcessedTokens: Object.values(values).reduce((sum, value) => sum + value, 0) }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
