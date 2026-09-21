import { createNativeSubagentChatEnricher, isNativeTaskLifecycle } from './native-subagent-chat'

export type StageChatEventType =
  | 'system.status'
  | 'assistant.message'
  | 'assistant.partial'
  | 'assistant.thinking'
  | 'tool.started'
  | 'tool.progress'
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
  stage: 'author' | 'content' | 'reviewer' | 'revision'
  sink?: StageChatSink
}) {
  const tools = new Map<string, { name: string; input?: unknown }>()
  const toolResults = new Set<string>()
  const assistantMessages = new Set<string>()
  const textBlockIndexes = new Map<string, number[]>()
  const activeThinking = new Map<string, { turnId: string; startedAt?: string }>()
  const enrich = createNativeSubagentChatEnricher()
  const originalSink = input.sink
  const sink: StageChatSink | undefined = originalSink ? event => originalSink(enrich(event)) : undefined
  input = { ...input, sink }

  const closeThinking = async (blockId: string, source: Record<string, unknown>, reason: string) => {
    const active = activeThinking.get(blockId)
    if (!active || !input.sink) return
    activeThinking.delete(blockId)
    const { turnId, startedAt } = active
    await input.sink({ type: 'assistant.thinking', text: 'Thinking', turnId,
      payload: { type: 'assistant.thinking', status: 'ended', reason,
        ...source, thinkingStartedAt: startedAt,
        workflowStageNativeKey: `thinking-end:${blockId}`,
        thinkingBlockId: blockId } })
  }

  return async (message: NativeMessage): Promise<void> => {
    if (!input.sink) return
    const queryId = typeof message.queryId === 'string' ? message.queryId : undefined
    const parentToolUseID = typeof message.parent_tool_use_id === 'string' ? message.parent_tool_use_id :
      typeof message.parentToolUseId === 'string' ? message.parentToolUseId : undefined
    const nativeAgentId = typeof message.agentId === 'string' && message.agentId !== 'root' ? message.agentId : undefined
    const childScope = parentToolUseID || nativeAgentId
    const turnId = queryId ? `workflow-stage:${input.stage}:${queryId}${childScope ? `:subagent:${childScope}` : ''}` : undefined
    const messageId = typeof message.messageId === 'string' ? message.messageId : object(message.message)?.id
    const messageScope = `${turnId}:message:${messageId ?? 'unknown'}`
    const source = { chatSchemaVersion: 2, workflowStage: input.stage, ...(turnId ? { workflowStageStreamId: turnId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(typeof message.occurredAt === 'string' ? { occurredAt: message.occurredAt } : {}),
      ...(parentToolUseID ? { parentToolUseID } : {}), ...(nativeAgentId ? { nativeAgentId } : {}) }
    const closeScope = async (reason: string) => {
      for (const [id, active] of activeThinking) if (active.turnId === turnId) await closeThinking(id, source, reason)
    }

    if (isNativeTaskLifecycle(message)) {
      await input.sink({ type: 'system.status', text: message.subtype, turnId,
        payload: { ...message, type: 'system', ...source,
          workflowStageNativeKey: message.workflowStageNativeKey ||
            `${input.stage}:${queryId}:${message.uuid || `${message.task_id}:${message.subtype}:${JSON.stringify(message.usage ?? {})}`}` } })
      return
    }

    if (message.type === 'thinking_end') {
      await closeScope(message.status === 'completed' ? 'native_query_end' : 'interrupted')
      return
    }

    if (message.type === 'stream_event') {
      const event = object(message.event)
      const delta = object(event?.delta)
      const blockId = `${turnId}:message:${messageId ?? 'unknown'}:block:${event?.index ?? -1}`
      if (typeof event?.index === 'number' && (event.content_block?.type === 'text' || delta?.type === 'text_delta')) {
        const indexes = textBlockIndexes.get(messageScope) ?? []
        if (!indexes.includes(event.index)) indexes.push(event.index)
        textBlockIndexes.set(messageScope, indexes)
      }
      const blockSource = { ...source, contentBlockIndex: event?.index,
        assistantBlockId: blockId,
        ...(message.contentMode ? { contentMode: message.contentMode } : {}) }
      if (event?.type === 'content_block_start' && event.content_block?.type === 'thinking') {
        const startedAt = message.startedAt ?? message.occurredAt
        if (turnId) activeThinking.set(blockId, { turnId, startedAt })
        await input.sink({ type: 'assistant.thinking', text: 'Thinking', turnId,
          payload: { type: 'assistant.thinking', ...blockSource, status: 'started', thinkingBlockId: blockId,
            thinkingStartedAt: startedAt, workflowStageNativeKey: `thinking-start:${blockId}` } })
      }
      if (event?.type === 'content_block_stop') await closeThinking(blockId, blockSource, 'content_block_stop')
      if (event?.type === 'message_stop') await closeScope('message_stop')
      if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        await closeScope('tool_started')
        const block = event.content_block
        if (!tools.has(block.id)) {
          tools.set(block.id, { name: block.name, input: block.input })
          await input.sink({ type: 'tool.started', text: block.name, turnId,
            payload: { type: 'tool.started', ...blockSource, toolUseID: block.id, toolName: block.name, input: block.input ?? {},
              workflowStageNativeKey: `${input.stage}:tool-start:${block.id}` } })
        }
      }
      if (event?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        await closeScope('visible_output_started')
        if (assistantMessages.has(blockId)) return
        await input.sink({ type: 'assistant.partial', text: delta.text, turnId,
          payload: { type: 'assistant.partial', ...blockSource, workflowStageNativeKey: message.workflowStageNativeKey } })
      }
      if (event?.type === 'content_block_delta' && delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
        const nativeKey = typeof message.workflowStageNativeKey === 'string' ? message.workflowStageNativeKey : undefined
        if (turnId && !activeThinking.has(blockId)) activeThinking.set(blockId, { turnId, startedAt: message.startedAt ?? message.occurredAt })
        await input.sink({ type: 'assistant.thinking', text: delta.thinking, turnId,
          payload: { type: 'assistant.thinking', status: 'streaming', ...blockSource,
            thinkingBlockId: blockId, thinkingStartedAt: activeThinking.get(blockId)?.startedAt,
            ...(nativeKey ? { workflowStageNativeKey: nativeKey } : {}) } })
      }
      return
    }

    if (message.type === 'assistant') {
      for (const [index, block] of contentBlocks(message).entries()) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text) {
          // SDK assistant receipts can contain only the completed block, so
          // their array index is NOT the original stream block index.
          const indexes = textBlockIndexes.get(messageScope) ?? []
          const blockIndex = indexes.find(value => !assistantMessages.has(`${messageScope}:block:${value}`)) ?? indexes.at(-1) ?? index
          const id = `${turnId}:message:${messageId ?? 'unknown'}:block:${blockIndex}`
          if (assistantMessages.has(id)) continue
          assistantMessages.add(id)
          await closeScope('visible_output_started')
          await input.sink({ type: 'assistant.message', text: block.text, turnId,
            payload: { type: 'assistant.message', ...source, contentBlockIndex: blockIndex, assistantBlockId: id,
              workflowStageNativeKey: `assistant:${id}` } })
          continue
        }
        if (block.type !== 'tool_use' || typeof block.id !== 'string') continue
        const name = typeof block.name === 'string' && block.name ? block.name : 'Tool'
        const alreadyStarted = tools.has(block.id)
        tools.set(block.id, { name, ...(block.input !== undefined ? { input: block.input } : {}) })
        await closeScope('tool_started')
        await input.sink({
          type: alreadyStarted ? 'tool.progress' : 'tool.started',
          turnId,
          text: name,
          payload: { type: 'tool.started', toolUseID: block.id, toolName: name,
            ...(block.input !== undefined ? { input: block.input } : {}), ...source,
            workflowStageNativeKey: `${input.stage}:tool-${alreadyStarted ? 'input' : 'start'}:${block.id}` },
        })
      }
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
