import type { AssistantContentBlock } from '../types/message'

export type BeeGameEvent = {
  id: number
  sessionId: string
  turnId?: string
  type:
    | 'session.started'
    | 'session.resumed'
    | 'turn.started'
    | 'user.message'
    | 'assistant.message'
    | 'assistant.partial'
    | 'assistant.thinking'
    | 'tool.started'
    | 'tool.completed'
    | 'tool.failed'
    | 'tool.progress'
    | 'permission.requested'
    | 'permission.resolved'
    | 'system.status'
    | 'usage'
    | 'result'
    | 'turn.completed'
    | 'turn.empty'
    | 'turn.failed'
    | 'session.stopped'
    | 'session.failed'
  text: string
  payload?: { type: string; [key: string]: unknown }
  createdAt: string
}

const DISPLAY_MESSAGE_ID_KEY = '__displayMessageId'

export function getThinkingDisplayId(event: BeeGameEvent): string {
  return `${event.sessionId}:${getPayloadString(event, 'parentToolUseID') || getPayloadString(event, 'parent_tool_use_id')}:${getPayloadString(event, 'thinkingBlockId') || getTurnDisplayId(event)}`
}

export function getAssistantPayloadMessageId(event: BeeGameEvent): string {
  if (!event.payload) return ''
  if (typeof event.payload.messageId === 'string') return event.payload.messageId
  const message = event.payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message))
    return ''
  const id = (message as Record<string, unknown>).id
  return typeof id === 'string' ? id.trim() : ''
}

export function getAssistantContentBlocks(event: BeeGameEvent): AssistantContentBlock[] | undefined {
  if (!event.payload) return undefined
  // A canonical block already has its own lifecycle in the timeline. Do not
  // expand its terminal provider envelope into a second set of Thought/tools.
  if (typeof event.payload.assistantBlockId === 'string') return undefined
  const payloadBlocks = event.payload.contentBlocks
  if (Array.isArray(payloadBlocks)) {
    return payloadBlocks.filter(isAssistantContentBlock)
  }
  const message = event.payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return undefined
  const blocks = content.flatMap((block): AssistantContentBlock[] => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return []
    const record = block as Record<string, unknown>
    const type = record.type
    if (type !== 'thinking' && type !== 'text' && type !== 'tool_use' && type !== 'tool_result') return []
    return [{
      type,
      ...(typeof record.thinking === 'string' ? { text: record.thinking } : {}),
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
      ...(typeof record.id === 'string' ? { toolUseId: record.id } : {}),
      ...(typeof record.tool_use_id === 'string' ? { toolUseId: record.tool_use_id } : {}),
      ...(typeof record.name === 'string' ? { toolName: record.name } : {}),
      ...(record.input !== undefined ? { toolInput: record.input } : {}),
      ...(typeof record.is_error === 'boolean' ? { isError: record.is_error } : {}),
    }]
  })
  return blocks.length ? blocks : undefined
}

function isAssistantContentBlock(value: unknown): value is AssistantContentBlock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const block = value as Partial<AssistantContentBlock>
  return (
    block.type === 'thinking' ||
    block.type === 'text' ||
    block.type === 'tool_use' ||
    block.type === 'tool_result'
  )
}

export function getBeeGameAssistantMessageId(event: BeeGameEvent): string {
  const parent = getPayloadString(event, 'parentToolUseID') || getPayloadString(event, 'parent_tool_use_id')
  const scope = parent ? `:subagent:${parent}` : ''
  const displayMessageId = getPayloadString(event, DISPLAY_MESSAGE_ID_KEY)
  if (displayMessageId) return displayMessageId + scope
  const blockId = getPayloadString(event, 'assistantBlockId')
  if (blockId) return `beegame-block-${blockId}${scope}`
  const nativeId = getAssistantPayloadMessageId(event)
  if (nativeId) return `beegame-assistant-${event.sessionId}-${nativeId}${scope}`
  if (event.type === 'assistant.message')
    return getFinalAssistantMessageId(event) + scope
  if (event.type === 'assistant.partial')
    return `beegame-partial-${getTurnDisplayId(event)}-${event.id}${scope}`
  return `beegame-event-${event.id}${scope}`
}

function getFinalAssistantMessageId(event: BeeGameEvent): string {
  const upstreamMessageId = getAssistantPayloadMessageId(event)
  return upstreamMessageId
    ? `beegame-assistant-${event.sessionId}-${upstreamMessageId}`
    : `beegame-event-${event.id}`
}

function getTurnDisplayId(event: BeeGameEvent): string {
  return event.turnId || `beegame-turn-${event.sessionId}-${event.id}`
}

export function getPayloadString(event: BeeGameEvent, field: string): string {
  const value = event.payload?.[field]
  return typeof value === 'string' ? value : ''
}

export function getPayloadBoolean(event: BeeGameEvent, field: string): boolean {
  return event.payload?.[field] === true
}

export function getPayloadRecord(
  event: BeeGameEvent,
  field: string,
): Record<string, unknown> {
  const value = event.payload?.[field]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
