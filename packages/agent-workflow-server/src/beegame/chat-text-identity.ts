import type { BeeGameEvent } from './session-manager'

/** Older transcripts omitted the native message ID on text deltas. Recover
 * an identity from the contiguous text block and its terminal receipt, not
 * from the wording or from a whole turn (which may contain many messages).
 * Original transcript files and project cursor IDs remain unchanged. */
export function createChatTextIdentity() {
  const pending = new Map<string, { id: string; index: unknown }>()
  return (event: BeeGameEvent): BeeGameEvent => {
    const p = event.payload ?? { type: event.type }
    const scope = `${p.workflowSourceSessionId ?? p.projectSourceSessionId ?? event.sessionId}:${event.turnId ?? ''}:${p.parentToolUseID ?? p.parent_tool_use_id ?? ''}`
    const body = p.message as { id?: string } | undefined
    const stream = p.event as { index?: number } | undefined
    if (event.type === 'assistant.partial' && !p.assistantBlockId && !p.messageId && !body?.id) {
      let block = pending.get(scope)
      if (!block || block.index !== stream?.index) {
        block = { id: `legacy-text:${scope}:${event.id}`, index: stream?.index }
        pending.set(scope, block)
      }
      return { ...event, payload: { ...p, assistantBlockId: block.id } }
    }
    if (event.type === 'assistant.message') {
      const block = pending.get(scope)
      pending.delete(scope)
      if (block && !p.assistantBlockId)
        return { ...event, payload: { ...p, assistantBlockId: block.id } }
    } else if (event.type === 'assistant.thinking' || event.type === 'user.message' ||
      event.type.startsWith('turn.') || event.type.startsWith('tool.')) {
      pending.delete(scope)
    }
    return event
  }
}
