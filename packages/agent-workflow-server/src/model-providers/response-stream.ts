import type { ProviderConfig } from './config'
import {
  opaqueReasoning,
  responseToolCall,
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
export async function* parseSse(response: Response): AsyncGenerator<Json> {
  if (!response.body) throw Error('Provider returned no response stream')
  const reader = response.body.getReader(),
    decoder = new TextDecoder()
  let buffer = '',
    data: string[] = [],
    eventSize = 0
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '')
        buffer = buffer.slice(end + 1)
        if (!line && data.length) {
          const value = data.join('\n')
          data = []
          eventSize = 0
          if (value === '[DONE]') return
          try {
            yield JSON.parse(value)
          } catch (error) {
            if (error instanceof SyntaxError)
              throw Error('Provider returned an invalid JSON event')
            throw error
          }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).trimStart())
          eventSize += line.length
        }
        if (eventSize + buffer.length > 64 * 1024 * 1024)
          throw Error('Provider response event exceeds the size limit')
      }
      if (chunk.done) {
        if (buffer.trim() || data.length)
          throw Error('Provider stream ended inside an event')
        return
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
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
  let reported: ProviderUsage | undefined, streamFinished = false
  const observeUsage = (value: Json) => {
    usage = { ...usage, ...value }
    reported = providerUsage(config, usage)
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
          if (chunk.usage) observeUsage(chunk.usage)
          finish = chunk.delta?.stop_reason ?? finish
        } else if (chunk.type === 'message_stop') ended = true
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
    }
    streamFinished = true
  } finally {
    // Includes stream errors and consumer cancellation. Never discard usage
    // already acknowledged by the supplier, or invent the unreported remainder.
    onUsage?.({ ...(reported ?? { input_tokens: 0, output_tokens: 0,
      cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }),
      ...(!streamFinished || !ended || !reported ? { incomplete: true as const } : {}) })
  }
  reported = providerUsage(config, usage)
  if (!ended) throw Error('Provider stream ended without a terminal event')
  const complete =
    config.protocol === 'chat-completions'
      ? ['stop', 'tool_calls'].includes(finish)
      : config.protocol === 'anthropic-messages'
        ? ['end_turn', 'tool_use', 'stop_sequence'].includes(finish)
        : finish === 'STOP'
  if (textItem) {
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
    usage: {
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
    },
    ...(!complete
      ? { incomplete_details: { reason: 'max_output_tokens' } }
      : {}),
  }
  yield {
    type: complete ? 'response.completed' : 'response.incomplete',
    response: result,
  }
}
function providerUsage(
  config: ProviderConfig,
  value: Json | undefined,
): ProviderUsage {
  if (!value) throw Error('Provider did not report final token usage')
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
