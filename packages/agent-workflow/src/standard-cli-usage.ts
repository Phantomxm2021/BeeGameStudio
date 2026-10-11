/** Actual public CLI/SDK usage, without a private native telemetry protocol.
 * Message deltas are snapshots, not increments. Interrupted observations are
 * lower bounds; a terminal modelUsage can include internal native requests. */
export class StandardCliUsage {
  private messages = new Map<string, Record<string, number>>()
  private streams = new Map<string, string>()
  private terminal: Record<string, number> = {}
  private published = ''
  observe(message: Record<string, any>) {
    if (message.isReplay === true) return
    const lane = String(message.parent_tool_use_id ?? 'root')
    let id: string | undefined, fields: Record<string, unknown> | undefined
    if (message.type === 'stream_event') {
      const event = message.event
      if (event?.type === 'message_start' && typeof event.message?.id === 'string') {
        id = event.message.id; this.streams.set(lane, id!); fields = event.message.usage
      } else if (event?.type === 'message_delta') {
        id = this.streams.get(lane); fields = event.usage
      } else if (event?.type === 'message_stop') this.streams.delete(lane)
    } else if (message.type === 'assistant' && typeof message.message?.id === 'string') {
      id = message.message.id; fields = message.message.usage
    } else if (message.type === 'result' && message.parent_tool_use_id == null && message.modelUsage) {
      const counts: Record<string, number> = {}
      for (const row of Object.values(message.modelUsage)) {
        if (!row || typeof row !== 'object') continue
        for (const [key, source] of mappings) {
          const value = (row as Record<string, unknown>)[source]
          if (valid(value)) counts[key] = (counts[key] ?? 0) + value
        }
      }
      for (const [key, value] of Object.entries(counts)) this.terminal[key] = Math.max(this.terminal[key] ?? 0, value)
    }
    if (id && fields && typeof fields === 'object' && !Array.isArray(fields)) {
      const row = this.messages.get(id) ?? {}
      for (const [key] of mappings) if (valid(fields[key])) row[key] = Math.max(row[key] ?? 0, fields[key] as number)
      this.messages.set(id, row)
    }
    const total: Record<string, number> = {}
    for (const [key] of mappings) {
      const observed = [...this.messages.values()].reduce((sum, row) => sum + (row[key] ?? 0), 0)
      total[key] = Math.max(observed, this.terminal[key] ?? 0)
    }
    const result = { prompt_tokens: total.input_tokens!, completion_tokens: total.output_tokens!,
      cache_read_tokens: total.cache_read_input_tokens!, cache_creation_tokens: total.cache_creation_input_tokens!,
      total_tokens: Object.values(total).reduce((sum, count) => sum + count, 0) }
    if (!Number.isSafeInteger(result.total_tokens) || result.total_tokens <= 0 || JSON.stringify(result) === this.published) return
    this.published = JSON.stringify(result)
    return result
  }
}
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const mappings = [['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens'],
  ['cache_read_input_tokens', 'cacheReadInputTokens'], ['cache_creation_input_tokens', 'cacheCreationInputTokens']] as const
