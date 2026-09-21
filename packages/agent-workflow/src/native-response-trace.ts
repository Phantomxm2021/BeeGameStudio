import { randomUUID } from 'node:crypto'
import { once } from 'node:events'

export const NATIVE_RESPONSE_TRACE_PREFIX = 'BEEGAME_NATIVE_RESPONSE_TRACE '
type RecordValue = Record<string, any>
const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
const secretKey = /(?:^|[_-])(?:api[_-]?key|auth|authorization|auth[_-]?token|password|passwd|secret|credentials?|access[_-]?token|refresh[_-]?token|token|cookie|private[_-]?key)(?:$|[_-])/i

/** Project before transport: exclude signatures, prompts, images and arbitrary
 * provider fields. Thinking text is an explicit, redacted observability stream
 * for the project Chat, never host-generated content. */
export function projectResponseMessage(value: unknown): RecordValue | undefined {
  const message = record(value)
  if (!message) return
  if (message.type === 'system' && ['task_started', 'task_progress', 'task_notification'].includes(message.subtype)) {
    return { type: 'system', ...Object.fromEntries(
      ['subtype', 'uuid', 'session_id', 'task_id', 'tool_use_id', 'description', 'status', 'summary', 'output_file', 'last_tool_name']
        .filter(key => typeof message[key] === 'string').map(key => [key, message[key]])),
      ...(record(message.usage) ? { usage: Object.fromEntries(['total_tokens', 'tool_uses', 'duration_ms']
        .filter(key => typeof message.usage[key] === 'number').map(key => [key, message.usage[key]])) } : {}) }
  }
  if (message.type === 'stream_request_start') return { type: message.type }
  if (message.type === 'reasoning_activity' && Number.isSafeInteger(message.bytes) && message.bytes >= 0)
    return { type: message.type, bytes: message.bytes, text: typeof message.text === 'string' ? message.text : '' }
  if (message.type === 'stream_event') {
    const event = record(message.event)
    if (!event) return
    let safe: RecordValue | undefined
    if (event.type === 'message_start') safe = { type: event.type,
      message: { id: event.message?.id, model: event.message?.model, usage: event.message?.usage } }
    if (event.type === 'content_block_start') {
      const block = event.content_block
      if (block?.type === 'text') safe = { type: event.type, index: event.index, content_block: { type: 'text', text: block.text } }
      if (block?.type === 'thinking') safe = { type: event.type, index: event.index, content_block: { type: 'thinking', thinking: block.thinking ?? '' } }
      if (block?.type === 'tool_use') safe = { type: event.type, index: event.index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: block.input } }
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta')
      safe = { type: event.type, index: event.index, delta: { type: 'text_delta', text: event.delta.text } }
    if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta')
      safe = { type: event.type, index: event.index, delta: { type: 'thinking_delta', thinking: event.delta.thinking } }
    if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta')
      safe = { type: event.type, index: event.index, delta: { type: 'input_json_delta', partial_json: event.delta.partial_json } }
    if (event.type === 'message_delta') safe = { type: event.type, usage: event.usage, delta: { stop_reason: event.delta?.stop_reason } }
    if (event.type === 'content_block_stop') safe = { type: event.type, index: event.index }
    if (event.type === 'message_stop') safe = { type: event.type }
    return safe ? { type: 'stream_event', event: safe } : undefined
  }
  if (message.type === 'assistant' || message.type === 'user') {
    const body = record(message.message)
    if (!body) return
    const content = Array.isArray(body.content) ? body.content.flatMap<RecordValue>((block: any) => {
      if (message.type === 'assistant' && block.type === 'text') return [{ type: 'text', text: block.text }]
      if (message.type === 'assistant' && block.type === 'tool_use') return [{ type: 'tool_use', id: block.id, name: block.name, input: block.input }]
      if (block.type === 'tool_result') return [{ type: 'tool_result', tool_use_id: block.tool_use_id, is_error: block.is_error,
        content: typeof block.content === 'string' ? block.content : (Array.isArray(block.content)
          ? block.content.filter((part: any) => part.type === 'text').map((part: any) => ({ type: 'text', text: part.text })) : []) }]
      return []
    }) : []
    if (!content.length && !body.usage) return
    return { type: message.type, message: { id: body.id, model: body.model, usage: body.usage, content } }
  }
}

export type ResponseTraceFrame = {
  queryId: string; agentId: string; parentToolUseId?: string
  occurredAt?: string
  kind: 'query_start' | 'query_end' | 'message'
  message?: RecordValue; status?: string
}

/** Capture ALL query loops, including detached agents whose events never reach
 * parent stdout. Stderr is a dedicated opt-in wire channel; the host owns files. */
export async function* traceNativeQuery<T, R>(source: AsyncGenerator<T, R>,
  scope: { agentId?: string; parentToolUseId?: string; signal?: AbortSignal }): AsyncGenerator<T, R> {
  if (process.env.BEEGAME_NATIVE_RESPONSE_TRACE !== '1') return yield* source
  const identity = { queryId: randomUUID(), agentId: scope.agentId ?? 'root', parentToolUseId: scope.parentToolUseId }
  const emit = async (frame: Omit<ResponseTraceFrame, keyof typeof identity>) => {
    // No user content except the strict response projection travels here.
    if (!process.stderr.write(NATIVE_RESPONSE_TRACE_PREFIX + JSON.stringify({ ...identity, ...frame, occurredAt: new Date().toISOString() }) + '\n'))
      await once(process.stderr, 'drain')
  }
  let finished = false, failed = false
  try {
    await emit({ kind: 'query_start' })
    while (true) {
      const next = await source.next()
      if (next.done) { finished = true; return next.value }
      const message = projectResponseMessage(next.value)
      if (message) await emit({ kind: 'message', message })
      yield next.value
    }
  } catch (error) { failed = true; throw error }
  finally {
    try { if (!finished) await source.return(undefined as R) }
    finally { await emit({ kind: 'query_end', status: scope.signal?.aborted ? 'aborted' : failed ? 'failed' : finished ? 'completed' : 'interrupted' }) }
  }
}

export function createResponseRedactor(environment: Record<string, string | undefined>) {
  const secrets = Object.entries(environment).filter(([key, value]) => secretKey.test(key) && value && value.length >= 4)
    .map(([, value]) => value!).sort((a, b) => b.length - a.length)
  const text = (value: string) => {
    let result = value
    for (const secret of secrets) result = result.split(secret).join('[REDACTED]')
    // Also redact credential-shaped text inside commands and partially streamed
    // JSON. Snapshots are redacted as a WHOLE, so splitting a key/value across
    // network chunks cannot bypass this filter.
    result = result.replace(/\bBearer\s+[^\s"'\\,}]+/gi, 'Bearer [REDACTED]')
      .replace(/((?:api[_-]?key|auth(?:orization|[_-]?token)?|password|passwd|secret|access[_-]?token|refresh[_-]?token|cookie)["']?\s*[:=]\s*["']?)([^"'\r\n,}]*)(["']?)/gi, '$1[REDACTED]$3')
      .replace(/\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]+/g, '[REDACTED]')
    // Do not expose a prefix of a configured secret on an unfinished snapshot.
    for (const secret of secrets) for (let size = Math.min(secret.length - 1, result.length); size >= 4; size--)
      if (result.endsWith(secret.slice(0, size))) { result = result.slice(0, -size) + '[REDACTED_PARTIAL]'; break }
    return result
  }
  const redact = (value: any): any => {
    if (typeof value === 'string') return text(value)
    if (Array.isArray(value)) return value.map(redact)
    if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[REDACTED]' : redact(item)]))
    return value
  }
  return redact
}

/** Cumulative, redacted checkpoints deliberately replace raw JSON fragments.
 * They preserve partial Write bodies on interruption without leaking a secret
 * split across deltas. This is durable Chat content, not a capped diagnostic
 * buffer: silently discarding it would make refresh and live output diverge. */
export function createNativeResponseTraceLog(log: (event: string, data: unknown) => Promise<void>,
  environment: Record<string, string | undefined>,
  onUsage?: (message: RecordValue) => Promise<void>) {
  const redact = createResponseRedactor(environment)
  const queries = new Map<string, { identity: RecordValue; messageId?: string; blocks: Map<number, {
    type: string; name?: string; toolId?: string; text: string; bytes: number; saved: number; startedAt: string; updatedAt: string
  }> }>()
  const write = async (event: string, data: unknown) => {
    await log(event, redact(data))
  }
  async function flushQuery(query: (typeof queries extends Map<any, infer V> ? V : never), interrupted = false) {
    for (const [index, block] of query.blocks) if (block.bytes !== block.saved) {
      await write('response.content_snapshot', { ...query.identity, messageId: query.messageId, index,
        type: block.type, tool: block.name, toolId: block.toolId, content: block.text,
        receivedBytes: block.bytes, interrupted, cumulative: true,
        startedAt: block.startedAt, occurredAt: block.updatedAt })
      block.saved = block.bytes
    }
  }
  return {
    async accept(value: unknown) {
      const frame = record(value)
      if (!frame || typeof frame.queryId !== 'string' || typeof frame.agentId !== 'string' ||
          !['query_start', 'query_end', 'message'].includes(frame.kind)) return
      const identity = { queryId: frame.queryId, agentId: frame.agentId,
        parentToolUseId: typeof frame.parentToolUseId === 'string' ? frame.parentToolUseId : undefined }
      const occurredAt = typeof frame.occurredAt === 'string' && Number.isFinite(Date.parse(frame.occurredAt))
        ? frame.occurredAt : new Date().toISOString()
      let query = queries.get(frame.queryId)
      if (!query) { query = { identity, blocks: new Map() }; queries.set(frame.queryId, query) }
      if (frame.kind === 'query_start') { await write('response.query_start', identity); return }
      if (frame.kind === 'query_end') {
        await flushQuery(query, frame.status !== 'completed')
        await write('response.query_end', { ...identity, status: frame.status, occurredAt })
        queries.delete(frame.queryId); return
      }
      const message = projectResponseMessage(frame.message)
      if (!message) return
      if (message.type === 'reasoning_activity') {
        // Providers without content blocks still get a message-scoped block.
        let block = query.blocks.get(-1)
        if (!block) {
          block = { type: 'thinking', text: '', bytes: 0, saved: -1, startedAt: occurredAt, updatedAt: occurredAt }
          query.blocks.set(-1, block)
        }
        block.bytes += message.bytes
        const text = typeof message.text === 'string' ? message.text : ''
        block.text += text
        block.updatedAt = occurredAt
        return
      }
      // Usage is kept separate from diagnostic content and never truncated.
      if (message.event?.type === 'message_start' || message.event?.type === 'message_delta' || message.message?.usage)
        await onUsage?.({ ...message, nativeTraceAgentId: frame.agentId, nativeTraceQueryId: frame.queryId })
      if (message.type === 'stream_request_start') { await write('response.request_start', identity); return }
      const event = message.event
      if (!event) {
        // Persist pending text BEFORE its final snapshot, never after it.
        await flushQuery(query)
        await write('response.message', { ...identity, ...message, occurredAt }); return
      }
      if (event.type === 'message_start') {
        await flushQuery(query, true); query.blocks.clear(); query.messageId = event.message.id
        await write('response.message_start', { ...identity, ...event.message }); return
      }
      if (event.type === 'content_block_start') {
        const block = event.content_block
        const initial = block.type === 'thinking' ? block.thinking ?? '' : block.type === 'text' ? block.text ?? '' : Object.keys(block.input ?? {}).length ? JSON.stringify(block.input) : ''
        query.blocks.set(event.index, { type: block.type, name: block.name, toolId: block.id,
          text: initial, bytes: Buffer.byteLength(initial), saved: -1, startedAt: occurredAt, updatedAt: occurredAt })
        await write('response.content_start', { ...identity, messageId: query.messageId, index: event.index, type: block.type, tool: block.name, toolId: block.id, occurredAt })
      } else if (event.type === 'content_block_delta') {
        const block = query.blocks.get(event.index)
        if (!block) return
        const text = event.delta.text ?? event.delta.thinking ?? event.delta.partial_json ?? ''
        block.updatedAt = occurredAt
        block.bytes += Buffer.byteLength(text)
        block.text += text
      } else if (event.type === 'content_block_stop') {
        await flushQuery(query)
        query.blocks.delete(event.index)
        await write('response.content_end', { ...identity, messageId: query.messageId, index: event.index, occurredAt })
      } else if (event.type === 'message_delta' || event.type === 'message_stop') {
        if (event.type === 'message_stop') await flushQuery(query)
        await write('response.' + event.type, { ...identity, messageId: query.messageId, ...event, occurredAt })
      }
    },
    async flush(interrupted = false) { for (const query of queries.values()) await flushQuery(query, interrupted) },
    async close() {
      for (const query of queries.values()) {
        await flushQuery(query, true)
        await write('response.query_end', { ...query.identity, status: 'process_closed_without_query_end', occurredAt: new Date().toISOString() })
      }
      queries.clear()
    },
  }
}
