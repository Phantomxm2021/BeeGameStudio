import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { ProviderConfig } from './config'
import {
  opaqueReasoning,
  responseToolCall,
  normalizeNativeToolArguments,
  UnknownProviderToolError,
  UNKNOWN_TOOL_FEEDBACK,
  type Json,
  type MappedTool,
} from './messages'

export type ProviderToolErrorHandler = (callId: string, diagnostic: string) => void | Promise<void>

export type ProviderUsage = {
  /** Known lower bound; the supplier did not deliver a complete usage receipt. */
  incomplete?: true
  input_tokens: number
  output_tokens: number
  /** Supplier-reported subset of output_tokens; absence means unknown. */
  reasoning_tokens?: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
}

const MAX_EVENT_SIZE = 64 * 1024 * 1024

export class ProviderSseError extends Error {}
export class ProviderToolArgumentsError extends ProviderSseError {}

// The native bridge observes receipt boundaries before forwarding each chunk.
// Share the existing bounded SSE decoder instead of a second protocol parser.
export class ProviderSseParser {
  done = false
  private decoder = new TextDecoder()
  private buffer = ''
  private data: string[] = []
  private eventSize = 0
  private skipLf = false;

  *feed(chunk?: Uint8Array, final = false): Generator<Json> {
    if (this.done) return
    let text = this.decoder.decode(chunk, { stream: !final })
    // SSE permits CR, LF and CRLF; a CRLF pair may cross read boundaries.
    if (this.skipLf && text.length) {
      if (text.startsWith('\n')) text = text.slice(1)
      this.skipLf = false
    }
    this.buffer += text
    let end: number
    while ((end = this.buffer.search(/[\r\n]/)) >= 0) {
      const line = this.buffer.slice(0, end), cr = this.buffer[end] === '\r'
      this.skipLf = cr && end === this.buffer.length - 1
      this.buffer = this.buffer.slice(end + (cr && this.buffer[end + 1] === '\n' ? 2 : 1))
      if (!line && this.data.length) {
        const value = this.data.join('\n')
        this.data = []
        this.eventSize = 0
        if (value === '[DONE]') { this.done = true; return }
        try {
          yield JSON.parse(value)
        } catch (error) {
          if (error instanceof SyntaxError)
            throw new ProviderSseError('Provider returned an invalid JSON event')
          throw error
        }
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(5).trimStart())
        this.eventSize += line.length
      }
      if (this.eventSize + this.buffer.length > MAX_EVENT_SIZE)
        throw new ProviderSseError('Provider response event exceeds the size limit')
    }
    // A provider may keep a malformed event on one very large line. The
    // line loop above cannot enforce the bound until a delimiter arrives.
    if (this.eventSize + this.buffer.length > MAX_EVENT_SIZE)
      throw new ProviderSseError('Provider response event exceeds the size limit')
    if (final) {
      if (this.buffer.trim() || this.data.length)
        throw new ProviderSseError('Provider stream ended inside an event')
      this.done = true
    }
  }
}

export async function* parseSse(response: Response): AsyncGenerator<Json> {
  if (!response.body) throw Error('Provider returned no response stream')
  const reader = response.body.getReader(), parser = new ProviderSseParser()
  try {
    while (!parser.done) {
      const chunk = await reader.read()
      yield* parser.feed(chunk.value, chunk.done)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Local compaction replaces retained history. Do not let an empty response or
 * the observed unparsed tool-call text become its replacement summary. */
export async function checkedLocalCompaction(response: Response, streaming: boolean): Promise<Response> {
  if (!response.ok) return response
  const valid = (items: Json[]) => {
    if (!Array.isArray(items) || items.some(item => item?.type === 'function_call')) return false
    const message = items.findLast(item => item?.type === 'message' && item.role === 'assistant')
    if (!Array.isArray(message?.content)) return false
    const text = message.content.filter((part: Json) => part?.type === 'output_text' && typeof part.text === 'string')
      .map((part: Json) => part.text).join('').trim()
    return Boolean(text) && !/^<｜｜DSML｜｜\s+(?:calls|invoke)\b/u.test(text)
  }
  const incomplete = (value: Json = {}) => ({ ...value,
    id: value.id ?? 'resp_' + crypto.randomUUID(), object: 'response', status: 'incomplete', output: [],
    incomplete_details: { reason: 'invalid_compaction_summary' },
  })
  const headers = new Headers(response.headers)
  for (const name of ['content-length', 'content-encoding', 'connection', 'transfer-encoding']) headers.delete(name)
  // 204/205 cannot carry the rejection event. A missing compaction body is
  // an invalid summary, so return a normal protocol envelope with that error.
  const status = [204,205].includes(response.status) ? 200 : response.status
  headers.set('Content-Type', streaming ? 'text/event-stream' : 'application/json')
  if (!streaming) {
    const value = response.body ? await response.json() as Json : incomplete()
    return Response.json(!['incomplete', 'failed'].includes(value.status) &&
      !(value.status === 'completed' && valid(value.output ?? [])) ? incomplete(value) : value,
      { status, headers })
  }
  const reader = response.body?.getReader(), parser = new ProviderSseParser()
  const encode = (event: Json) => new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n')
  let progress: Json = { id: 'resp_' + crypto.randomUUID(), object: 'response', status: 'in_progress', output: [] }
  let cancelled = false
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      const events: Json[] = [], items: Json[] = []
      let terminal: Json | undefined
      try {
        try {
          while (reader && !parser.done && !terminal) {
            const chunk = await reader.read()
            for (const event of parser.feed(chunk.value, chunk.done)) {
              if (event.type === 'response.created' || event.type === 'response.in_progress') {
                progress = { ...event.response, status: 'in_progress', output: [] }
                controller.enqueue(encode(event.type === 'response.created' ? event : { type: event.type, response: progress }))
              } else {
                events.push(event)
                // Keep native's idle timer informed by actual upstream activity,
                // while withholding summary text until its receipt is checked.
                if (typeof event.type === 'string' && event.type.endsWith('.delta'))
                  controller.enqueue(encode({ type: 'response.in_progress', response: progress }))
              }
              if (event.type === 'response.output_item.done') items.push(event.item)
              if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) {
                terminal = event
                break
              }
            }
          }
        } catch (error) { if (!(error instanceof ProviderSseError)) throw error }
        if (cancelled) return
        if (!terminal || terminal.type === 'response.completed' &&
            !valid(terminal.response?.output?.length ? terminal.response.output : items)) {
          events.splice(0, events.length, { type: 'response.incomplete', response: incomplete(terminal?.response) })
        }
        controller.enqueue(new TextEncoder().encode(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('')))
        controller.close()
      } catch (error) { if (!cancelled) controller.error(error) }
      finally { await reader?.cancel().catch(() => {}); reader?.releaseLock() }
    },
    async cancel() { cancelled = true; await reader?.cancel() },
  }), { status, headers })
}

// Responses receipts use the same per-request accounting as converted protocols.
// Match the usage fields consumed by native and bgsUsage. Native discards
// response.failed and content_filter usage, even when the fields are present.
const tokenCount = z.number().int().nonnegative()
const nativeUsageReceipt = z.object({
  type: z.enum(['response.completed', 'response.incomplete']),
  response: z.object({
    id: z.string(),
    incomplete_details: z.object({ reason: z.string().optional() }).nullish(),
    usage: z.object({
      input_tokens: tokenCount,
      output_tokens: tokenCount,
      total_tokens: tokenCount,
      input_tokens_details: z.object({
        cached_tokens: tokenCount,
        cache_write_tokens: tokenCount.optional(),
      }).nullish(),
      output_tokens_details: z.object({ reasoning_tokens: tokenCount }).nullish(),
    }),
  }),
})

function nativeReceiptUsage(event: unknown): ProviderUsage | undefined {
  const parsed = nativeUsageReceipt.safeParse(event)
  if (!parsed.success) return undefined
  const { type, response } = parsed.data
  if (type === 'response.incomplete' && response.incomplete_details?.reason === 'content_filter') return undefined
  const usage = response.usage, read = usage.input_tokens_details?.cached_tokens ?? 0,
    write = usage.input_tokens_details?.cache_write_tokens ?? 0,
    reasoning = usage.output_tokens_details?.reasoning_tokens
  if (read + write > usage.input_tokens || reasoning !== undefined && reasoning > usage.output_tokens) return undefined
  return { input_tokens: usage.input_tokens - read - write, output_tokens: usage.output_tokens,
    cache_read_tokens: read, cache_creation_tokens: write,
    total_tokens: usage.input_tokens + usage.output_tokens,
    ...(reasoning === undefined ? {} : { reasoning_tokens: reasoning }) }
}

/** Preserve native Responses data while adapting declared tool identities and schema-safe argument spellings.
 * Completed receipts are recorded before enqueue; missing or cancelled receipts remain incomplete. */
export async function nativeResponses(response: Response, request: Json,
  onUsage?: (usage: ProviderUsage) => void, onToolArgumentsError?: (message: string) => void): Promise<Response> {
  if (!response.ok) return response
  let reported = false
  const observe = (event: unknown) => {
    if (reported) return
    const usage = nativeReceiptUsage(event)
    if (usage) { reported = true; onUsage?.(usage) }
  }
  const missing = () => {
    if (!reported) {
      reported = true
      onUsage?.({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
        cache_creation_tokens: 0, total_tokens: 0, incomplete: true })
    }
  }
  const definitions: Json[] = request.tools ?? []
  const directNames = new Set(definitions.filter(tool => tool.type !== 'namespace').map(tool => tool.name))
  type NativeTool = Pick<MappedTool, 'name' | 'namespace'> & { schema?: Json }
  const identities = new Map<string, NativeTool>()
  const returnedNames = new Map<string, NativeTool | null>()
  const key = (name: string, namespace?: string) => JSON.stringify([namespace ?? null, name])
  const register = (name: string, tool: NativeTool) =>
    returnedNames.set(name, returnedNames.has(name) ? null : tool)
  for (const tool of definitions) {
    if (tool.type === 'function') {
      identities.set(key(tool.name), { name: tool.name, schema: tool.parameters })
      continue
    }
    if (tool.type !== 'namespace') continue
    for (const child of tool.tools ?? []) {
      if (child.type !== 'function') continue
      const declared = { name: child.name, namespace: tool.name, schema: child.parameters }
      identities.set(key(child.name, tool.name), declared)
      // A provider can return either a qualified or bare name. Resolve only a
      // unique declaration in this request; literal top-level names take priority.
      register(tool.name + '.' + child.name, declared)
      register(child.name, declared)
    }
  }
  const normalize = identities.size > 0
  const item = (value: Json, complete = true): Json => {
    if (value?.type !== 'function_call') return value
    const declared = value.namespace == null && !directNames.has(value.name) ? returnedNames.get(value.name) : undefined
    const call = declared ? { ...value, name: declared.name, namespace: declared.namespace } : value
    return complete && typeof call.arguments === 'string'
      ? { ...call, arguments: normalizeNativeToolArguments(call.name, call.namespace, call.arguments,
          identities.get(key(call.name, call.namespace))?.schema) } : call
  }
  const output = (value: Json): Json => normalize && Array.isArray(value?.output)
    ? { ...value, output: value.output.map((entry: Json) => item(entry)) } : value
  const headers = new Headers(response.headers)
  for (const name of ['content-length', 'content-encoding', 'connection', 'transfer-encoding']) headers.delete(name)
  if (!response.body) { missing(); return response }
  if (request.stream !== true) {
    try {
      const value = await response.json() as Json
      observe({ type: value.object === 'response.compaction' ? 'response.completed' : 'response.' + value.status, response: value })
      return Response.json(output(value), { status: response.status, headers })
    } finally { missing() }
  }
  const reader = response.body.getReader(), parser = new ProviderSseParser(), encoder = new TextEncoder()
  type StreamCall = NativeTool & { callId: string; snapshot?: string; delta: string; deltaBytes: number }
  // One response only. Never source parameters from replayed input or another call.
  const calls = new Map<string, StreamCall>()
  const callItems = new Map<string, string>()
  const emptyArguments = (value: unknown) => value === undefined || typeof value === 'string' && !value.trim()
  const objectArguments = (value: string) => {
    try { const parsed = JSON.parse(value); return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) }
    catch { return false }
  }
  const sameArguments = (left: string, right: string) => {
    if (left === right) return true
    // Compare values without rewriting their original text. JS parsing loses
    // large-integer precision, so those snapshots must agree byte-for-byte.
    const exactNumbers = (value: unknown): boolean => typeof value === 'number'
      ? !Number.isInteger(value) || Number.isSafeInteger(value)
      : value !== null && typeof value === 'object' ? Object.values(value).every(exactNumbers) : true
    try {
      const a = JSON.parse(left), b = JSON.parse(right)
      return exactNumbers(a) && exactNumbers(b) && isDeepStrictEqual(a, b)
    } catch { return false }
  }
  const snapshot = (call: StreamCall, args: unknown) => {
    if (typeof args !== 'string' || !args.trim()) return
    if (call.snapshot !== undefined && !sameArguments(call.snapshot, args))
      throw new ProviderToolArgumentsError('Provider returned conflicting function-call arguments')
    call.snapshot = args
  }
  const checkDelta = (call: StreamCall) => {
    if (call.snapshot !== undefined && objectArguments(call.delta) && !sameArguments(call.delta, call.snapshot))
      throw new ProviderToolArgumentsError('Provider returned conflicting function-call arguments')
  }
  const rememberItem = (value: Json, complete: boolean) => {
    const normalized = item(value, false)
    if (normalized?.type !== 'function_call' || typeof normalized.id !== 'string' || typeof normalized.call_id !== 'string') return
    let call = calls.get(normalized.id)
    if (call && (call.callId !== normalized.call_id || key(call.name, call.namespace) !== key(normalized.name, normalized.namespace)))
      throw new ProviderToolArgumentsError('Provider changed a function-call identity')
    const declared = identities.get(key(normalized.name, normalized.namespace))
    if (!declared) return
    if (!call) {
      if (callItems.has(normalized.call_id) && callItems.get(normalized.call_id) !== normalized.id)
        throw new ProviderToolArgumentsError('Provider changed a function-call identity')
      callItems.set(normalized.call_id, normalized.id)
      const delta = !complete && typeof normalized.arguments === 'string' ? normalized.arguments : ''
      call = { ...declared, callId: normalized.call_id, delta, deltaBytes: Buffer.byteLength(delta) }
      calls.set(normalized.id, call)
    }
    if (complete) { snapshot(call, normalized.arguments); checkDelta(call) }
  }
  const remember = (value: Json) => {
    if (value?.type === 'response.output_item.added' || value?.type === 'response.output_item.done')
      rememberItem(value.item, value.type === 'response.output_item.done')
    if (value?.type === 'response.function_call_arguments.delta' || value?.type === 'response.function_call_arguments.done') {
      const call = calls.get(value.item_id)
      if (call) {
        if (value.call_id !== undefined && value.call_id !== call.callId)
          throw new ProviderToolArgumentsError('Provider changed a function-call identity')
        if (value.type === 'response.function_call_arguments.done') snapshot(call, value.arguments)
        else if (typeof value.delta === 'string') {
          call.deltaBytes += Buffer.byteLength(value.delta)
          if (call.deltaBytes > MAX_EVENT_SIZE) throw new ProviderToolArgumentsError('Provider function-call arguments exceed the size limit')
          call.delta += value.delta
        }
      }
    }
    if (value?.type === 'response.completed' && Array.isArray(value.response?.output))
      for (const entry of value.response.output) rememberItem(entry, true)
  }
  const completedItem = (value: Json): Json => {
    const normalized = item(value, false), call = normalized?.type === 'function_call' ? calls.get(normalized.id) : undefined
    if (!call || !emptyArguments(normalized.arguments)) return item(value)
    const args = call.snapshot ?? call.delta
    if (!args.trim()) return item(value) // Real missing fields stay missing for native/MCP validation.
    if (!objectArguments(args)) throw new ProviderToolArgumentsError('Provider returned incomplete function-call arguments')
    return item({ ...normalized, arguments: args })
  }
  const event = (value: Json, recover = true): Json => {
    if (value?.type === 'response.output_item.added') return { ...value, item: item(value.item, false) }
    if (value?.type === 'response.output_item.done') return { ...value, item: recover ? completedItem(value.item) : item(value.item) }
    if (value?.type === 'response.function_call_arguments.done' && calls.has(value.item_id) && typeof value.arguments === 'string') {
      const call = calls.get(value.item_id)!
      return { ...value, arguments: normalizeNativeToolArguments(call.name, call.namespace, value.arguments, call.schema) }
    }
    return recover && value?.type === 'response.completed' && Array.isArray(value.response?.output)
      ? { ...value, response: { ...value.response, output: value.response.output.map(completedItem) } }
      : value?.response ? { ...value, response: output(value.response) } : value
  }
  let observing = true, doneSent = false, pending: Json[] | undefined, pendingBytes = 0
  const encodeEvent = (value: Json) => 'data: ' + JSON.stringify(value) + '\n\n'
  const forward = (value: Json): string => {
    remember(value)
    // Native executes output_item.done. Hold empty declared completions and their
    // tail until terminal snapshots agree, preserving event order and cancellation.
    if (pending || value?.type === 'response.output_item.done' && calls.has(value.item?.id) && emptyArguments(value.item.arguments)) {
      pending ??= []
      pendingBytes += Buffer.byteLength(JSON.stringify(value))
      if (pendingBytes > MAX_EVENT_SIZE) throw new ProviderToolArgumentsError('Provider pending function-call events exceed the size limit')
      pending.push(value)
      if (!['response.completed', 'response.incomplete', 'response.failed'].includes(value.type)) return ''
      const complete = value.type === 'response.completed' && !['incomplete', 'failed'].includes(value.response?.status)
      const result = pending.filter(entry => complete || entry.type !== 'response.output_item.done' || entry.item?.type !== 'function_call')
        .map(entry => encodeEvent(event(entry, complete))).join('')
      pending = undefined; pendingBytes = 0
      return result
    }
    return encodeEvent(event(value))
  }
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // A heartbeat or partial SSE event produces no downstream chunk. Keep
        // reading within this pull; returning empty can stall a pending read.
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) {
            if (pending) throw new ProviderToolArgumentsError('Provider stream ended before pending function calls completed')
            missing(); controller.close(); return
          }
          let forwarded = ''
          if (observing) {
            try {
              for (const value of parser.feed(chunk.value)) {
                observe(value)
                if (normalize) forwarded += forward(value)
              }
              if (normalize && parser.done && !doneSent) {
                if (pending) throw new ProviderToolArgumentsError('Provider stream ended before pending function calls completed')
                forwarded += 'data: [DONE]\n\n'; doneSent = true
              }
            } catch (error) {
              if (!(error instanceof ProviderSseError) || normalize) throw error
              // Ordinary Responses stays byte-transparent even for malformed input.
              observing = false
              missing()
            }
          }
          if (!normalize) { controller.enqueue(chunk.value); return }
          if (forwarded) { controller.enqueue(encoder.encode(forwarded)); return }
        }
      } catch (error) {
        if (error instanceof ProviderToolArgumentsError) onToolArgumentsError?.(error.message)
        pending = undefined; calls.clear(); callItems.clear(); missing()
        await reader.cancel(error).catch(() => {}); controller.error(error)
      }
    },
    async cancel() { pending = undefined; calls.clear(); callItems.clear(); missing(); await reader.cancel() },
  }), { status: response.status, headers })
}

type Call = {
  id: string
  alias: string
  args: string
  nameParts: string[]
  item?: Json
  index?: number
}
export async function* responseEvents(
  config: ProviderConfig,
  response: Response,
  tools: MappedTool[],
  onUsage?: (usage: ProviderUsage) => void,
  onToolError?: ProviderToolErrorHandler,
): AsyncGenerator<Json> {
  if (!response.ok) {
    await response.body?.cancel()
    throw Object.assign(
      Error('Model provider request failed (' + response.status + ')'),
      { status: response.status },
    )
  }
  const id = 'resp_' + crypto.randomUUID().replaceAll('-', ''),
    output: Json[] = [],
    calls = new Map<number, Call>(),
    blocks = new Map<number, Json>()
  const model = config.model ?? '',
    created_at = Math.floor(Date.now() / 1000)
  let textItem: Json | undefined,
    textIndex = 0,
    ended = false,
    finish = '',
    usage: Json | undefined,
    raw: Json = {}
  const envelope = (status: string) => ({
    id,
    object: 'response',
    model,
    created_at,
    status,
    output,
  })
  let reported: ProviderUsage | undefined,
    streamFinished = false,
    terminalUsageReported = false,
    usageIncomplete = false
  const observeUsage = (value: Json, terminal = config.protocol !== 'anthropic-messages') => {
    usage = { ...usage, ...value }
    reported = providerUsage(config, usage)
    terminalUsageReported ||= terminal && (
      config.protocol !== 'anthropic-messages' || hasAnthropicTerminalUsage(value)
    )
  }
  try {
    yield {
      type: 'response.created',
      response: { ...envelope('in_progress'), output: [] },
    }
    function* addText(text: string) {
      if (!text) return
      if (!textItem) {
        textIndex = output.length
        textItem = {
          id: 'msg_' + crypto.randomUUID().replaceAll('-', ''),
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [{ type: 'output_text', text: '', annotations: [] }],
        }
        output.push(textItem)
        yield {
          type: 'response.output_item.added',
          output_index: textIndex,
          item: { ...textItem, content: [] },
        }
        yield {
          type: 'response.content_part.added',
          item_id: textItem.id,
          output_index: textIndex,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        }
      }
      textItem.content[0].text += text
      yield {
        type: 'response.output_text.delta',
        item_id: textItem.id,
        output_index: textIndex,
        content_index: 0,
        delta: text,
      }
    }
    function* updateCall(
      index: number,
      id: string | undefined,
      name: string | undefined,
      args: string,
    ) {
      let call = calls.get(index)
      if (!call) {
        call = {
          id: id || 'call_' + crypto.randomUUID().replaceAll('-', ''),
          alias: '',
          args: '',
          nameParts: [],
        }
        calls.set(index, call)
      }
      if (id) call.id = id
      if (name) { call.alias += name; call.nameParts.push(name) }
      const previous = call.args
      call.args += args
      const tool = tools.find(tool => tool.alias === call.alias)
      if (tool && !call.item) {
        call.index = output.length
        call.item = {
          type: tool.custom ? 'custom_tool_call' : 'function_call',
          id: (tool.custom ? 'ctc_' : 'fc_') + call.id,
          call_id: call.id,
          name: tool.name,
          ...(tool.namespace ? { namespace: tool.namespace } : {}),
          status: 'in_progress',
          ...(tool.custom ? { input: '' } : { arguments: '' }),
        }
        output.push(call.item)
        yield {
          type: 'response.output_item.added',
          output_index: call.index,
          item: { ...call.item },
        }
        if (!tool.custom && previous)
          yield {
            type: 'response.function_call_arguments.delta',
            item_id: call.item.id,
            output_index: call.index,
            delta: previous,
          }
      }
      if (call.item && !tool?.custom && args)
        yield {
          type: 'response.function_call_arguments.delta',
          item_id: call.item.id,
          output_index: call.index,
          delta: args,
        }
    }
    for await (const chunk of parseSse(response)) {
      if (chunk.error || chunk.type === 'error')
        throw Error('Model provider reported a stream error')
      if (config.protocol === 'chat-completions') {
        if (chunk.usage) observeUsage(chunk.usage)
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta ?? {}
        yield* addText(delta.content ?? '')
        yield* addText(delta.refusal ?? '')
        if (delta.reasoning_content)
          raw.reasoning_content =
            (raw.reasoning_content ?? '') + delta.reasoning_content
        for (const tool of delta.tool_calls ?? [])
          yield* updateCall(
            tool.index,
            tool.id,
            tool.function?.name,
            tool.function?.arguments ?? '',
          )
        if (choice.finish_reason) {
          ended = true
          finish = choice.finish_reason
        }
      } else if (config.protocol === 'anthropic-messages') {
        if (chunk.type === 'message_start' && chunk.message?.usage) observeUsage(chunk.message.usage)
        else if (chunk.type === 'content_block_start') {
          blocks.set(chunk.index, { ...chunk.content_block })
          if (chunk.content_block.type === 'text')
            yield* addText(chunk.content_block.text ?? '')
          if (chunk.content_block.type === 'tool_use')
            yield* updateCall(
              chunk.index,
              chunk.content_block.id,
              chunk.content_block.name,
              '',
            )
        } else if (chunk.type === 'content_block_delta') {
          const block = blocks.get(chunk.index)
          if (!block) throw Error('Provider delta has no content block')
          const delta = chunk.delta
          if (delta.type === 'text_delta') {
            block.text += delta.text
            yield* addText(delta.text)
          } else if (delta.type === 'input_json_delta')
            yield* updateCall(
              chunk.index,
              undefined,
              undefined,
              delta.partial_json,
            )
          else if (delta.type === 'thinking_delta')
            block.thinking = (block.thinking ?? '') + delta.thinking
          else if (delta.type === 'signature_delta')
            block.signature = (block.signature ?? '') + delta.signature
        } else if (chunk.type === 'message_delta') {
          if (chunk.usage) observeUsage(chunk.usage, true)
          finish = chunk.delta?.stop_reason ?? finish
        } else if (chunk.type === 'message_stop') {
          ended = true
          break // This is the terminal event; HTTP EOF carries no further usage.
        }
      } else if (config.protocol === 'gemini') {
        if (chunk.usageMetadata) observeUsage(chunk.usageMetadata)
        const candidate = chunk.candidates?.[0]
        if (chunk.promptFeedback?.blockReason)
          throw Error('Gemini rejected the model request')
        if (!candidate) continue
        const parts = (raw.parts ??= [])
        for (const part of candidate.content?.parts ?? []) {
          if (part.functionCall) {
            const index = calls.size,
              callId =
                part.functionCall.id ||
                'call_' + crypto.randomUUID().replaceAll('-', '')
            // Keep the generated identity with the exact signature-bearing part.
            parts.push({
              ...part,
              functionCall: { ...part.functionCall, id: callId },
            })
            yield* updateCall(
              index,
              callId,
              part.functionCall.name,
              JSON.stringify(part.functionCall.args ?? {}),
            )
          } else {
            parts.push(part)
            if (typeof part.text === 'string' && !part.thought)
              yield* addText(part.text)
          }
        }
        if (candidate.finishReason) {
          ended = true
          finish = candidate.finishReason
        }
      }
      // Native SSE idle detection must observe real upstream activity even when
      // the chunk contains only private reasoning, signatures or a provider ping.
      yield { type: 'response.in_progress', response: { ...envelope('in_progress'), output: [] } }
    }
    streamFinished = true
  } finally {
    // Includes stream errors and consumer cancellation. Never discard usage
    // already acknowledged by the supplier, or invent the unreported remainder.
    usageIncomplete = !streamFinished || !ended || !reported ||
      config.protocol === 'anthropic-messages' && !terminalUsageReported
    onUsage?.({ ...(reported ?? { input_tokens: 0, output_tokens: 0,
      cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }),
      ...(usageIncomplete ? { incomplete: true as const } : {}) })
  }
  if (!ended) throw Error('Provider stream ended without a terminal event')
  const complete =
    config.protocol === 'chat-completions'
      ? ['stop', 'tool_calls'].includes(finish)
      : config.protocol === 'anthropic-messages'
        ? ['end_turn', 'tool_use', 'stop_sequence'].includes(finish)
        : finish === 'STOP'
  const incompleteReason = ['length', 'max_tokens', 'MAX_TOKENS'].includes(finish)
    ? 'max_output_tokens'
    : ['content_filter', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(finish)
      ? 'content_filter'
      : 'provider_stop'
  if (textItem) {
    // Text accompanying tool calls is progress, not the turn's final answer.
    // Preserve this distinction for consumers that validate structured finals.
    textItem.phase = calls.size ? 'commentary' : 'final_answer'
    textItem.status = 'completed'
    yield {
      type: 'response.output_text.done',
      item_id: textItem.id,
      output_index: textIndex,
      content_index: 0,
      text: textItem.content[0].text,
    }
    yield {
      type: 'response.content_part.done',
      item_id: textItem.id,
      output_index: textIndex,
      content_index: 0,
      part: textItem.content[0],
    }
    yield {
      type: 'response.output_item.done',
      output_index: textIndex,
      item: textItem,
    }
  }
  for (const call of calls.values()) {
    if (!complete) continue
    const tool = tools.find(tool => tool.alias === call.alias)
    if (!tool) {
      if (!tools.length || tools.some(tool => tool.namespace === 'bgs_provider_errors'))
        throw new UnknownProviderToolError(call.alias, tools, call.nameParts)
      // Preserve Bgs's ordinary unknown-tool feedback path. This reserved,
      // unregistered namespace cannot dispatch a real tool; no fuzzy alias
      // resolution or host execution is permitted. Keep arbitrary provider
      // names/arguments only in the opaque native history below.
      const diagnostic = new UnknownProviderToolError(call.alias, tools, call.nameParts).message
      await onToolError?.(call.id, UNKNOWN_TOOL_FEEDBACK + ' ' + diagnostic)
      const item = { type: 'function_call', id: 'fc_' + call.id, call_id: call.id,
        name: 'unknown_tool', namespace: 'bgs_provider_errors',
        arguments: JSON.stringify({ error: diagnostic }), status: 'completed' }
      const index = call.index ?? output.length
      if (call.index === undefined) {
        output.push(item)
        yield { type: 'response.output_item.added', output_index: index, item: { ...item, status: 'in_progress' } }
      } else output[index] = item
      yield { type: 'response.output_item.done', output_index: index, item }
      continue
    }
    if (!call.item || call.index === undefined) throw Error('Provider tool stream has no output item')
    const args =
      call.args ||
      (config.protocol === 'anthropic-messages'
        ? JSON.stringify(
            blocks.get([...calls].find(([, value]) => value === call)![0])
              ?.input ?? {},
          )
        : '{}')
    const item = responseToolCall(tool, call.id, args)
    output[call.index] = item
    if (!tool.custom)
      yield {
        type: 'response.function_call_arguments.done',
        item_id: item.id,
        output_index: call.index,
        arguments: item.arguments,
      }
    yield { type: 'response.output_item.done', output_index: call.index, item }
  }
  if (config.protocol === 'chat-completions')
    raw = {
      role: 'assistant',
      content: textItem?.content[0].text ?? null,
      ...raw,
      ...(calls.size
        ? {
            tool_calls: [...calls.values()].map(call => ({
              id: call.id,
              type: 'function',
              function: { name: call.alias, arguments: call.args || '{}' },
            })),
          }
        : {}),
    }
  else if (config.protocol === 'anthropic-messages') {
    if (complete)
      for (const [index, call] of calls) {
        const block = blocks.get(index)!
        block.input = JSON.parse(call.args || JSON.stringify(block.input ?? {}))
      }
    raw = { role: 'assistant', content: [...blocks.values()] }
  } else raw = { role: 'model', parts: raw.parts ?? [] }
  if (complete) {
    const opaque = opaqueReasoning(config.protocol, raw),
      index = output.length
    output.push(opaque)
    yield {
      type: 'response.output_item.added',
      output_index: index,
      item: opaque,
    }
    yield {
      type: 'response.output_item.done',
      output_index: index,
      item: opaque,
    }
  }
  const result = {
    ...envelope(complete ? 'completed' : 'incomplete'),
    // Completion follows the provider's terminal event. Missing accounting is
    // retained in both the callback receipt and the response consumed by the
    // runtime worker; never synthesize a zero receipt.
    ...(reported ? { usage: {
      input_tokens:
        reported.input_tokens +
        reported.cache_read_tokens +
        reported.cache_creation_tokens,
      output_tokens: reported.output_tokens,
      total_tokens: reported.total_tokens,
      input_tokens_details: {
        cached_tokens: reported.cache_read_tokens,
        cache_creation_tokens: reported.cache_creation_tokens,
      },
      ...(reported.reasoning_tokens !== undefined
        ? { output_tokens_details: { reasoning_tokens: reported.reasoning_tokens } }
        : {}),
      ...(usageIncomplete ? { incomplete: true as const } : {}),
    } } : {}),
    ...(!complete
      ? { incomplete_details: { reason: incompleteReason } }
      : {}),
  }
  yield {
    type: complete ? 'response.completed' : 'response.incomplete',
    response: result,
  }
}
function providerUsage(
  config: ProviderConfig,
  value: Json,
): ProviderUsage {
  let input: number,
    output: number,
    reasoning: number | undefined,
    read = 0,
    write = 0
  if (config.protocol === 'chat-completions') {
    input = value.prompt_tokens
    output = value.completion_tokens
    reasoning = value.completion_tokens_details?.reasoning_tokens ?? undefined
    read = value.prompt_tokens_details?.cached_tokens ?? 0
    write = value.prompt_tokens_details?.cache_creation_tokens ?? 0
  } else if (config.protocol === 'anthropic-messages') {
    read = value.cache_read_input_tokens ?? 0
    write = value.cache_creation_input_tokens ?? 0
    input = value.input_tokens + read + write
    output = value.output_tokens
  } else {
    input = value.promptTokenCount
    output =
      value.candidatesTokenCount === undefined
        ? value.totalTokenCount - input
        : value.candidatesTokenCount + (value.thoughtsTokenCount ?? 0)
    read = value.cachedContentTokenCount ?? 0
    reasoning = value.thoughtsTokenCount ?? undefined
  }
  if (
    [input, output, read, write].some(
      value => !Number.isSafeInteger(value) || value < 0,
    ) ||
    read + write > input ||
    reasoning !== undefined && (!Number.isSafeInteger(reasoning) || reasoning < 0 || reasoning > output)
  )
    throw Error('Provider reported invalid token usage')
  return {
    input_tokens: input - read - write,
    output_tokens: output,
    ...(reasoning !== undefined ? { reasoning_tokens: reasoning } : {}),
    cache_read_tokens: read,
    cache_creation_tokens: write,
    total_tokens: input + output,
  }
}

function hasAnthropicTerminalUsage(value: Json): boolean {
  return typeof value.output_tokens === 'number' &&
    Number.isSafeInteger(value.output_tokens) && value.output_tokens >= 0
}
