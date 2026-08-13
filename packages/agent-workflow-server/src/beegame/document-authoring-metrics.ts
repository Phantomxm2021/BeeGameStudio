import type { BeeGameEvent } from './session-manager'

export type DocumentAuthoringMetrics = {
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
    rangeCount: number
    projectedLineCount: number
  }
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

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}
