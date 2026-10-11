import type { SdkWorkflowProgress } from '../../types/tools.js'
import { enqueueSdkEvent } from '../sdkEventQueue.js'
import type { Message } from '../../types/message.js'
import type { StdoutMessage } from '../../entrypoints/sdk/controlTypes.js'
import { toSDKMessages } from '../messages/mappers.js'
import { getSessionId } from '../../bootstrap/state.js'
import { isEnvTruthy } from '../envUtils.js'

// Preserve the native Remote/container gate and 30-second cadence for both
// foreground and background delivery. No new polling or model messages.
const toolProgressLastSentTime = new Map<string, number>()
/** Native delegates otherwise discard query deltas. Honor the caller's public
 * SDK flag and preserve immediate parent ownership without changing history. */
export function emitSubagentStreamEvent(message: { type: string; event?: unknown; uuid?: string },
  parentToolUseId: string | undefined, enabled: boolean): void {
  if (!enabled || !parentToolUseId || message.type !== 'stream_event' || !message.event) return
  enqueueSdkEvent({ type: 'stream_event', event: message.event as any,
    parent_tool_use_id: parentToolUseId, session_id: getSessionId(), uuid: message.uuid ?? crypto.randomUUID() })
}

export function normalizeShellProgress(message: Message, parentToolUseId?: string): Extract<StdoutMessage, { type: 'tool_progress' }> | undefined {
  if (message.type !== 'progress') return
  const data = message.data as { type?: string; elapsedTimeSeconds?: number; taskId?: string }
  if (!['bash_progress', 'powershell_progress'].includes(data.type ?? '') ||
    (!isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) && !process.env.CLAUDE_CODE_CONTAINER_ID)) return
  const trackingKey = parentToolUseId ? `${parentToolUseId}:${message.parentToolUseID}` : String(message.parentToolUseID)
  const now = Date.now()
  if (now - (toolProgressLastSentTime.get(trackingKey) ?? 0) < 30_000) return
  if (toolProgressLastSentTime.size >= 100) {
    const oldest = toolProgressLastSentTime.keys().next().value
    if (oldest !== undefined) toolProgressLastSentTime.delete(oldest)
  }
  toolProgressLastSentTime.set(trackingKey, now)
  return { type: 'tool_progress',
    tool_use_id: (parentToolUseId ? message.parentToolUseID : message.toolUseID) as string,
    tool_name: data.type === 'bash_progress' ? 'Bash' : 'PowerShell',
    parent_tool_use_id: parentToolUseId ?? message.parentToolUseID as string,
    elapsed_time_seconds: data.elapsedTimeSeconds!, task_id: data.taskId,
    session_id: getSessionId(), uuid: message.uuid }
}

/** Background workers have no live parent onProgress iterator. Publish their
 * visible text and tool blocks to the existing SDK output queue, never model history.
 * This avoids racing the batched transcript flush. Private thinking is omitted. */
export function emitSubagentVisibleMessage(message: Message, parentToolUseId: string | undefined): void {
  if (!parentToolUseId) return
  if (message.type === 'progress') {
    const data = message.data as { type?: string; message?: Message } | undefined
    if (data?.type === 'agent_progress' && data.message && typeof message.parentToolUseID === 'string')
      emitSubagentVisibleMessage(data.message, message.parentToolUseID)
    const shell = normalizeShellProgress(message, parentToolUseId)
    if (shell) enqueueSdkEvent(shell)
    return
  }
  if (message.type === 'system' && message.subtype === 'compact_boundary') {
    for (const event of toSDKMessages([message])) {
      if (event.type === 'system' && event.subtype === 'compact_boundary')
        enqueueSdkEvent({ ...event as Extract<StdoutMessage, { type: 'system'; subtype: 'compact_boundary' }>, parent_tool_use_id: parentToolUseId })
    }
    return
  }
  if (!parentToolUseId || (message.type !== 'assistant' && message.type !== 'user')) return
  const content = message.message?.content
  if (!Array.isArray(content)) return
  const visible = content.filter(block => block.type === 'tool_use' || block.type === 'tool_result' ||
    (message.type === 'assistant' && block.type === 'text'))
  if (!visible.length) return
  for (const event of toSDKMessages([{ ...message, message: { ...message.message, content: visible } } as Message])) {
    // The public SDKMessage type is an open envelope. The mapper returns a
    // canonical assistant/user message for the two input types above.
    if (event.type === 'assistant' || event.type === 'user') {
      const toolEvent = event as Extract<StdoutMessage, { type: 'assistant' | 'user' }>
      enqueueSdkEvent({ ...toolEvent, parent_tool_use_id: parentToolUseId })
    }
  }
}

/**
 * Emit a `task_progress` SDK event. Shared by background agents (per tool_use
 * in runAsyncAgentLifecycle) and workflows (per flushProgress batch). Accepts
 * already-computed primitives so callers can derive them from their own state
 * shapes (ProgressTracker for agents, LocalWorkflowTaskState for workflows).
 */
export function emitTaskProgress(params: {
  taskId: string
  toolUseId: string | undefined
  description: string
  startTime: number
  totalTokens: number
  toolUses: number
  lastToolName?: string
  summary?: string
  workflowProgress?: SdkWorkflowProgress[]
}): void {
  enqueueSdkEvent({
    type: 'system',
    subtype: 'task_progress',
    task_id: params.taskId,
    tool_use_id: params.toolUseId,
    description: params.description,
    usage: {
      total_tokens: params.totalTokens,
      tool_uses: params.toolUses,
      duration_ms: Date.now() - params.startTime,
    },
    last_tool_name: params.lastToolName,
    summary: params.summary,
    workflow_progress: params.workflowProgress,
  })
}
