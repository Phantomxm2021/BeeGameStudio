export type StageChatEventType =
  | 'assistant.message'
  | 'assistant.partial'
  | 'assistant.thinking'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'

export type StageChatEvent = Readonly<{
  type: StageChatEventType
  text: string
  /** Stable native invocation identity. Keeps streamed blocks separate. */
  turnId?: string
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
 * The CLI remains the agent. This adapter preserves its visible replies, tool
 * activity, and explicitly emitted thinking deltas for the Chat UI.
 */
export function createStageChatProjector(input: {
  stage: 'author' | 'content' | 'reviewer' | 'revision' | 'game-ir'
  sink?: StageChatSink
}) {
  const tools = new Map<string, { name: string; input?: unknown }>()
  const toolResults = new Set<string>()
  const assistantMessages = new Set<string>()
  const activeThinking = new Set<string>()

  const closeThinking = async (turnId: string | undefined, reason: string) => {
    if (!turnId || !activeThinking.delete(turnId) || !input.sink) return
    await input.sink({ type: 'assistant.thinking', text: 'Thinking', turnId,
      payload: { type: 'assistant.thinking', status: 'ended', reason,
        workflowStage: input.stage, workflowStageStreamId: turnId,
        thinkingBlockId: turnId } })
  }

  return async (message: NativeMessage): Promise<void> => {
    if (!input.sink) return
    const queryId = typeof message.queryId === 'string' ? message.queryId : undefined
    const turnId = queryId ? `workflow-stage:${input.stage}:${queryId}` : undefined
    const source = { workflowStage: input.stage, ...(turnId ? { workflowStageStreamId: turnId } : {}) }

    if (message.type === 'thinking_end') {
      await closeThinking(turnId, 'native_query_end')
      return
    }

    if (message.type === 'stream_event') {
      const event = object(message.event)
      const delta = object(event?.delta)
      if (event?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        await closeThinking(turnId, 'visible_output_started')
        await input.sink({ type: 'assistant.partial', text: delta.text, turnId,
          payload: { type: 'assistant.partial', ...source } })
      }
      if (event?.type === 'content_block_delta' && delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
        const nativeKey = typeof message.workflowStageNativeKey === 'string' ? message.workflowStageNativeKey : undefined
        if (turnId) activeThinking.add(turnId)
        await input.sink({ type: 'assistant.thinking', text: delta.thinking, turnId,
          payload: { type: 'assistant.thinking', status: 'streaming', ...source,
            ...(turnId ? { thinkingBlockId: turnId } : {}),
            ...(nativeKey ? { workflowStageNativeKey: nativeKey } : {}) } })
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
        await closeThinking(turnId, 'tool_started')
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
      await closeThinking(turnId, 'visible_output_started')
      if (messageId) assistantMessages.add(messageId)
      await input.sink({ type: 'assistant.message', text, turnId,
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
