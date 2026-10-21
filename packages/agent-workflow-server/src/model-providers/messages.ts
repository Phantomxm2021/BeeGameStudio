import { createHash } from 'node:crypto'
import type { ModelApiProtocol } from '@bee-game-studio/agent-workflow'

export type Json = Record<string, any>
export type MappedTool = {
  alias: string
  name: string
  namespace?: string
  custom: boolean
  description: string
  schema: Json
}
export class UnknownProviderToolError extends Error {
  constructor(alias: string, tools: MappedTool[], parts: string[] = []) {
    // Never put arbitrary model output (or its arguments) in diagnostics.
    const native = tools.find(tool => alias === tool.name || alias === `${tool.namespace}.${tool.name}`)
    const repeated = tools.find(tool => alias.length > tool.alias.length &&
      alias.length % tool.alias.length === 0 && alias === tool.alias.repeat(alias.length / tool.alias.length))
    const partial = tools.filter(tool => alias && tool.alias.startsWith(alias))
    const kind = native ? `native-name:${native.name}` : repeated ? `repeated-name:${repeated.name}` :
      partial.length === 1 ? `partial-name:${partial[0]!.name}` : 'unmapped'
    const chunks = parts.map(part => {
      const exact = tools.find(tool => tool.alias === part)
      const prefixes = tools.filter(tool => part && tool.alias.startsWith(part))
      return `${part.length}:${exact ? 'alias-' + exact.name : prefixes.length === 1 ? 'prefix-' + prefixes[0]!.name : 'other'}`
    }).join(',')
    super(`Provider returned an unknown tool name (${kind}; length=${alias.length}; sha256=${createHash('sha256').update(alias).digest('hex')}; chunks=${chunks})`)
  }
}
export function mapTools(definitions: Json[] = []): MappedTool[] {
  const result: MappedTool[] = []
  function visit(tool: Json, namespace?: string) {
    if (tool.type === 'namespace') {
      for (const child of tool.tools ?? []) visit(child, tool.name)
      return
    }
    if (!['function', 'custom'].includes(tool.type))
      throw Error(
        'This provider protocol does not support the native tool: ' + tool.type,
      )
    if (typeof tool.name !== 'string')
      throw Error('Invalid model tool definition')
    const custom = tool.type === 'custom'
    const description = [
      tool.description,
      custom &&
        tool.format?.definition &&
        'Required input grammar:\n' + tool.format.definition,
    ]
      .filter(Boolean)
      .join('\n')
    result.push({
      alias: toolAlias(tool.name, namespace),
      name: tool.name,
      namespace,
      custom,
      description,
      schema: custom
        ? {
            type: 'object',
            properties: { input: { type: 'string' } },
            required: ['input'],
            additionalProperties: false,
          }
        : (tool.parameters ?? { type: 'object', properties: {} }),
    })
  }
  for (const tool of definitions) visit(tool)
  if (new Set(result.map(tool => tool.alias)).size !== result.length)
    throw Error('Provider tool names collide after protocol conversion')
  return result
}
export function toolAlias(name: string, namespace?: string) {
  // Bgs treats an absent namespace as `functions`. Keep ordinary native
  // identities so Skill/instruction references name the advertised tool.
  const owner = namespace ?? 'functions'
  if (owner === 'functions' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)) return name
  const readable = `bgs_${owner}__${name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 31)
  const hash = createHash('sha256').update(JSON.stringify([owner, name])).digest('hex').slice(0, 32)
  return `${readable}_${hash}`
}
export function responseToolCall(
  tool: MappedTool,
  id: string,
  args: string,
): Json {
  if (tool.custom) {
    const parsed = JSON.parse(args)
    if (typeof parsed.input !== 'string')
      throw Error('Custom tool arguments must contain input text')
    return {
      type: 'custom_tool_call',
      id: 'ctc_' + id,
      call_id: id,
      name: tool.name,
      ...(tool.namespace ? { namespace: tool.namespace } : {}),
      input: parsed.input,
      status: 'completed',
    }
  }
  JSON.parse(args)
  return {
    type: 'function_call',
    id: 'fc_' + id,
    call_id: id,
    name: tool.name,
    ...(tool.namespace ? { namespace: tool.namespace } : {}),
    arguments: args,
    status: 'completed',
  }
}
export function nativeCall(item: Json) {
  return {
    id: item.call_id,
    name: toolAlias(item.name, item.namespace),
    args:
      item.type === 'custom_tool_call'
        ? JSON.stringify({ input: item.input })
        : item.arguments,
  }
}

// Provider signatures/reasoning remain opaque private thread data. They are
// returned verbatim on the next request, never fabricated or shown as a tool.
const OPAQUE_PREFIX = 'bgs-provider-v1:'
export function opaqueReasoning(protocol: ModelApiProtocol, raw: Json): Json {
  return {
    type: 'reasoning',
    id: 'rs_' + crypto.randomUUID().replaceAll('-', ''),
    summary: [],
    encrypted_content:
      OPAQUE_PREFIX +
      Buffer.from(JSON.stringify({ protocol, raw })).toString('base64'),
  }
}
function rawReasoning(
  item: Json,
  protocol: ModelApiProtocol,
): Json | undefined {
  if (
    typeof item.encrypted_content !== 'string' ||
    !item.encrypted_content.startsWith(OPAQUE_PREFIX)
  )
    return
  const data = JSON.parse(
    Buffer.from(
      item.encrypted_content.slice(OPAQUE_PREFIX.length),
      'base64',
    ).toString(),
  )
  return data.protocol === protocol && data.raw && typeof data.raw === 'object'
    ? data.raw
    : undefined
}
export const UNKNOWN_TOOL_FEEDBACK = 'Tool call rejected: its name does not match any tool advertised in the current request. No action was executed. Use an exact tool name from the current tool list, or respond directly if no tool is needed.'

export type ConversationItem =
  | { role: 'user' | 'assistant'; content: Json[]; raw?: Json }
  | { role: 'tool'; id: string; content: Json[] }
export function conversation(
  body: Json,
  protocol: ModelApiProtocol,
): { system: string; messages: ConversationItem[] } {
  if (body.previous_response_id)
    throw Error(
      'The provider bridge requires full conversation input, not previous_response_id',
    )
  const input =
    typeof body.input === 'string'
      ? [{ role: 'user', content: body.input }]
      : (body.input ?? [])
  const system: string[] = body.instructions ? [body.instructions] : [],
    messages: ConversationItem[] = [],
    pending: Json[] = []
  function flush() {
    if (!pending.length) return
    const raw = pending
      .filter(item => item.type === 'reasoning')
      .map(item => rawReasoning(item, protocol))
      .filter(Boolean)
    if (raw.length)
      for (const item of raw)
        messages.push({ role: 'assistant', content: [], raw: item })
    else {
      const content: Json[] = []
      for (const item of pending) {
        if (['function_call', 'custom_tool_call'].includes(item.type))
          content.push({ type: 'call', ...nativeCall(item) })
        else if (item.role === 'assistant') content.push(...parts(item.content))
      }
      if (content.length) messages.push({ role: 'assistant', content })
    }
    pending.length = 0
  }
  const rejectedCalls = new Set<string>()
  for (const item of input) {
    if (item.type === 'function_call' && item.namespace === 'bgs_provider_errors' && item.name === 'unknown_tool')
      rejectedCalls.add(item.call_id)
    if (
      ['reasoning', 'function_call', 'custom_tool_call'].includes(item.type) ||
      item.role === 'assistant'
    ) {
      pending.push(item)
      continue
    }
    flush()
    if (item.role === 'developer' || item.role === 'system')
      system.push(
        parts(item.content)
          .map(part => part.text ?? '')
          .join('\n'),
      )
    else if (
      ['function_call_output', 'custom_tool_call_output'].includes(item.type)
    )
      messages.push({
        role: 'tool',
        id: item.call_id,
        // The native rejection already happened; expose its reason instead of the internal marker name.
        content: parts(rejectedCalls.has(item.call_id) ? UNKNOWN_TOOL_FEEDBACK : item.output),
      })
    else if (item.role === 'user')
      messages.push({ role: 'user', content: parts(item.content) })
    else throw Error('Unsupported conversation input: ' + String(item.type))
  }
  flush()
  return { system: system.join('\n\n'), messages }
}
export function parts(value: any): Json[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  if (!Array.isArray(value)) throw Error('Unsupported model content')
  return value.map(part => {
    if (
      ['input_text', 'output_text', 'text'].includes(part.type) &&
      typeof part.text === 'string'
    )
      return { type: 'text', text: part.text }
    if (['input_image', 'image_url'].includes(part.type)) {
      const url =
        typeof part.image_url === 'string'
          ? part.image_url
          : (part.image_url?.url ?? part.url)
      if (typeof url !== 'string')
        throw Error('Provider image input requires a URL or inline image')
      return { type: 'image', url }
    }
    throw Error('Unsupported model content part: ' + String(part.type))
  })
}
export function inlineImage(url: string) {
  const match = /^data:(image\/[A-Za-z0-9.+-]+);base64,([\s\S]+)$/.exec(url)
  return match ? { mimeType: match[1]!, data: match[2]! } : undefined
}
export function textParts(content: Json[]) {
  return content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}
export function toolChoice(
  body: Json,
  tools: MappedTool[],
  protocol: ModelApiProtocol,
): any {
  const value = body.tool_choice
  if (!value || value === 'auto')
    return protocol === 'gemini' ? { mode: 'AUTO' } : 'auto'
  if (value === 'none')
    return protocol === 'gemini'
      ? { mode: 'NONE' }
      : protocol === 'anthropic-messages'
        ? { type: 'none' }
        : 'none'
  if (value === 'required')
    return protocol === 'gemini'
      ? { mode: 'ANY' }
      : protocol === 'anthropic-messages'
        ? { type: 'any' }
        : 'required'
  const tool = tools.find(
    tool => tool.name === value.name && tool.namespace === value.namespace,
  )
  if (!tool) throw Error('Requested tool is unavailable')
  return protocol === 'gemini'
    ? { mode: 'ANY', allowedFunctionNames: [tool.alias] }
    : protocol === 'anthropic-messages'
      ? { type: 'tool', name: tool.alias }
      : { type: 'function', function: { name: tool.alias } }
}
