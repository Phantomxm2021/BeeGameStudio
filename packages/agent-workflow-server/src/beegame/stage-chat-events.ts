export type StageChatEventType =
  | 'assistant.message'
  | 'assistant.partial'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'

export type StageChatEvent = Readonly<{
  type: StageChatEventType
  text: string
  payload?: { type: string; [key: string]: unknown }
}>

export type StageChatSink = (event: StageChatEvent) => void | Promise<void>

type NativeMessage = Record<string, any>

const object = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined

function contentBlocks(message: NativeMessage): Record<string, any>[] {
  const body = object(message.message)
  const content = body?.content ?? message.content
  if (Array.isArray(content)) return content.flatMap(value => object(value) ? [object(value)!] : [])
  const block = object(content)
  return block ? [block] : []
}

function visibleText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(visibleText).filter(Boolean).join('')
  const item = object(value)
  if (!item) return ''
  if (item.type && item.type !== 'text') return ''
  if (typeof item.text === 'string') return item.text
  return 'content' in item ? visibleText(item.content) : ''
}

function toolResultText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(toolResultText).filter(Boolean).join('\n')
  const item = object(value)
  if (!item) return ''
  if (typeof item.text === 'string') return item.text
  return 'content' in item ? toolResultText(item.content) : ''
}

/**
 * Projects the user-visible part of one native CLI invocation into Chat.
 * Hidden reasoning, usage envelopes and stream protocol noise are intentionally
 * excluded. The CLI remains the agent; this adapter only preserves its normal
 * replies and tool activity.
 */
export function createStageChatProjector(input: {
  stage: 'author' | 'reviewer' | 'game-ir'
  sink?: StageChatSink
}) {
  const tools = new Map<string, { name: string; input?: unknown }>()
  const toolResults = new Set<string>()
  const assistantMessages = new Set<string>()

  return async (message: NativeMessage): Promise<void> => {
    if (!input.sink) return
    const source = { workflowStage: input.stage }

    if (message.type === 'stream_event') {
      const event = object(message.event)
      const delta = object(event?.delta)
      if (event?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        await input.sink({ type: 'assistant.partial', text: delta.text, payload: { type: 'assistant.partial', ...source } })
      }
      return
    }

    if (message.type === 'assistant') {
      const body = object(message.message)
      const messageId = typeof body?.id === 'string' ? body.id : undefined
      for (const block of contentBlocks(message)) {
        if (block.type !== 'tool_use' || typeof block.id !== 'string') continue
        const name = typeof block.name === 'string' && block.name ? block.name : 'Tool'
        if (tools.has(block.id)) continue
        tools.set(block.id, { name, ...(block.input !== undefined ? { input: block.input } : {}) })
        await input.sink({
          type: 'tool.started',
          text: name,
          payload: { type: 'tool.started', toolUseID: block.id, toolName: name,
            ...(block.input !== undefined ? { input: block.input } : {}), ...source,
            workflowStageNativeKey: `${input.stage}:tool-start:${block.id}` },
        })
      }
      const text = visibleText(body?.content).trim()
      if (!text || (messageId && assistantMessages.has(messageId))) return
      if (messageId) assistantMessages.add(messageId)
      await input.sink({ type: 'assistant.message', text,
        payload: { type: 'assistant.message', ...(messageId ? { messageId,
          workflowStageNativeKey: `${input.stage}:assistant:${messageId}` } : {}), ...source } })
      return
    }

    if (message.type !== 'user') return
    for (const block of contentBlocks(message)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      if (toolResults.has(block.tool_use_id)) continue
      toolResults.add(block.tool_use_id)
      const cached = tools.get(block.tool_use_id)
      const name = cached?.name ?? 'Tool'
      const failed = block.is_error === true
      await input.sink({
        type: failed ? 'tool.failed' : 'tool.completed',
        text: `${name} ${failed ? 'failed' : 'completed'}`,
        payload: { type: failed ? 'tool.failed' : 'tool.completed', toolUseID: block.tool_use_id,
          toolName: name, ...(cached?.input !== undefined ? { input: cached.input } : {}),
          output: toolResultText(block.content), ...source,
          workflowStageNativeKey: `${input.stage}:tool-result:${block.tool_use_id}` },
      })
    }
  }
}
