import type { ProjectEventMessage } from '../types/message'
import { readSubagentActivity } from '@bee-game-studio/agent-workflow/subagent-activity'
import { normalizeChatAttachments } from './chatAttachments'
import { settleChatActivity } from '../utils/chatActivity'
import {
  getPayloadString, getPayloadBoolean, getPayloadRecord, getThinkingDisplayId,
  getBeeGameAssistantMessageId, getAssistantContentBlocks, type BeeGameEvent,
} from './beeGameEvent'
import { encodeArtifactId, getArtifactPath, toWorkspaceRelativePath } from './beeGameArtifactPaths'

// The adapter supplies cache-resolved user text; projection never reads
// authentication, local storage, transport cursors or cross-batch caches.
export function projectEventMessages(
  projectId: string,
  event: BeeGameEvent,
  workspacePath = '',
  userDisplayText = event.text,
  now: () => number = Date.now,
): ProjectEventMessage[] {
  const messages = eventToProjectEventMessagesBase(
    projectId,
    event,
    workspacePath,
    userDisplayText,
    now,
  )
  return messages.map(message => ({
    ...message,
    // TodoWrite replaces an agent's list across turns in the same session.
    // A turn is an update boundary, not a new task owner.
    todoScope: JSON.stringify([event.sessionId,
      getPayloadString(event, 'parentToolUseID') || getPayloadString(event, 'parent_tool_use_id')]),
    // Streaming blocks keep their first appearance order within a timestamp;
    // full createdAt remains the primary sort key across transcript files.
    sequence: typeof event.payload?.sourceSequence === 'number'
      ? event.payload.sourceSequence : event.id,
  }))
}

function eventToProjectEventMessagesBase(
  projectId: string,
  event: BeeGameEvent,
  workspacePath = '',
  userDisplayText = event.text,
  now: () => number = Date.now,
): ProjectEventMessage[] {
  const taskId = event.sessionId
  switch (event.type) {
    case 'usage': {
      const usage = getUsageFromEventPayload(event.payload)
      return usage ? [{
        type: 'usage',
        task_id: taskId,
        project_id: projectId,
        turnId: event.turnId,
        turn_id: event.turnId,
        usage,
        timestamp: Date.parse(event.createdAt) || now(),
      } as ProjectEventMessage] : []
    }
    case 'user.message':
      if (getPayloadString(event, 'displayKind') === 'delivery_continue') return []
      return [
        baseMessage(
          'agent_message',
          { ...event, text: userDisplayText },
          projectId,
          'user',
          now,
        ),
      ]
    case 'turn.started':
      return [
        {
          type: 'status',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          status: 'running',
        } as ProjectEventMessage,
      ]
    case 'system.status': {
      const subtype = getPayloadString(event, 'subtype')
      const status = getPayloadString(event, 'status')
      if (getPayloadString(event, 'type') === 'billing.realtime_debited')
        return [{ type: 'billing_update', task_id: taskId, project_id: projectId,
          timestamp: Date.parse(event.createdAt) || now() }]
      if (subtype === 'host_evidence') {
        return [{ type: 'context_update', task_id: taskId, project_id: projectId,
          sender: 'system', message_id: `beegame-host-evidence-${event.sessionId}-${event.id}`,
          content: event.text, task_kind: 'host_evidence', timestamp: Date.parse(event.createdAt) || now(),
        }]
      }
      if (subtype === 'delivery_error') {
        return [{ type: 'context_update', task_id: taskId, project_id: projectId,
          sender: 'system', message_id: `beegame-delivery-error-${event.sessionId}-${event.id}`,
          content: event.text, task_kind: 'delivery_error', timestamp: Date.parse(event.createdAt) || now(),
        }]
      }
      if (subtype === 'delivery_phase') {
        const phase = getPayloadString(event, 'phase')
        if (!['author', 'review', 'revision', 'resources', 'content', 'implementation', 'acceptance', 'complete'].includes(phase)) return []
        return [{ type: 'context_update', task_id: taskId, project_id: projectId,
          sender: 'system', message_id: `beegame-phase-${event.sessionId}-${event.id}`,
          content: phase, task_kind: 'delivery_phase', timestamp: Date.parse(event.createdAt) || now(),
        }]
      }
      const compacting = subtype === 'status' && status === 'compacting'
      const compacted = subtype === 'compact_boundary'
      if (compacting || compacted) {
        const parentToolUseId = getPayloadString(event, 'parentToolUseID') || getPayloadString(event, 'parent_tool_use_id')
        return [{
          type: 'context_compaction',
          task_id: taskId,
          project_id: projectId,
          sender: 'system',
          message_id: `beegame-compaction-${event.sessionId}-${event.turnId || 'session'}-${parentToolUseId}`,
          turnId: event.turnId,
          turn_id: event.turnId,
          content: compacted ? 'compacted' : 'compacting',
          status: compacted ? 'finished' : 'running',
          timestamp: Date.parse(event.createdAt) || now(),
          message_type: 'system_status',
          task_kind: 'context_compaction',
        }]
      }
      if (!['task_started', 'task_progress', 'task_notification'].includes(subtype)) return []
      const id = getPayloadString(event, 'toolUseID') || getPayloadString(event, 'tool_use_id') || getPayloadString(event, 'task_id')
      if (!id) return []
      const terminal = subtype === 'task_notification'
      const type = terminal && status === 'completed' ? 'tool.completed' :
        terminal && ['failed', 'stopped', 'killed'].includes(status) ? 'tool.failed' : 'tool.progress'
      const usage = getPayloadRecord(event, 'usage')
      const activity = [getPayloadString(event, 'description'), getPayloadString(event, 'last_tool_name'),
        typeof usage.tool_uses === 'number' ? `${usage.tool_uses} tools` : '',
        typeof usage.duration_ms === 'number' ? `${Math.round(usage.duration_ms / 1000)}s` : '',
        typeof usage.total_tokens === 'number' ? `${usage.total_tokens} tokens` : '',
      ].filter(Boolean).join(' · ')
      const input = getPayloadRecord(event, 'input')
      return eventToProjectEventMessagesBase(projectId, { ...event, type,
        payload: { ...event.payload, type, toolUseID: id,
          toolName: getPayloadString(event, 'task_type') === 'local_bash' ? 'Task' : 'Agent',
          input: { ...input,
            ...(getPayloadString(event, 'prompt') ? { prompt: getPayloadString(event, 'prompt') } : {}),
            trace: [getPayloadString(event, 'subagentTrace'), activity].filter(Boolean).join('\n\n'),
          },
          output: terminal ? getPayloadString(event, 'summary') || getPayloadString(event, 'result') : '',
        },
      }, workspacePath, userDisplayText, now)
    }
    case 'assistant.partial': {
      return [
        {
          type: 'token',
          task_id: taskId,
          project_id: projectId,
          sender: 'beegame',
          content: event.text,
          content_mode: getPayloadString(event, 'contentMode') === 'snapshot' ? 'snapshot' : 'delta',
          task_kind: 'assistant_stream',
          message_id: getBeeGameAssistantMessageId(event),
          turnId: event.turnId,
          turn_id: event.turnId,
          timestamp: Date.parse(event.createdAt) || now(),
        } as ProjectEventMessage,
      ]
    }
    case 'assistant.thinking': {
      const status = getPayloadString(event, 'status')
      const thinkingStartedAtValue = getPayloadString(event, 'thinkingStartedAt')
      // A block id may be reused within a session. Include the lifecycle
      // start so a later Thought cannot mutate an earlier completed card.
      const thinkingOccurrence = thinkingStartedAtValue
        ? `-${thinkingStartedAtValue}`
        : ''
      const thinkingMessageId = `beegame-thinking-${getThinkingDisplayId(event)}${thinkingOccurrence}`
      const thinkingStartedAt = Date.parse(thinkingStartedAtValue)
      const thinkingTimestamp = Number.isFinite(thinkingStartedAt)
        ? thinkingStartedAt
        : Date.parse(event.createdAt) || now()
      const thinkingDurationMs = Number.isFinite(thinkingStartedAt)
        ? Math.max(0, Date.parse(event.createdAt) - thinkingStartedAt)
        : undefined
      if (status === 'ended') {
        const endMessage = {
            type: 'think_end',
            task_id: taskId,
            project_id: projectId,
            sender: 'beegame',
            message_id: thinkingMessageId,
            turnId: event.turnId,
            turn_id: event.turnId,
            timestamp: Date.parse(event.createdAt) || now(),
            ...(thinkingDurationMs !== undefined ? { thinking_duration_ms: thinkingDurationMs } : {}),
          } as ProjectEventMessage
        // The chat transcript endpoint compacts a complete reasoning block
        // into one terminal event. Live transport still sends text deltas plus
        // a textless end marker. Project both forms into the same canonical
        // Thought + end lifecycle so refresh and realtime are equivalent.
        if (event.text && event.text !== 'Thinking') {
          return [
            {
              type: 'thought',
              task_id: taskId,
              project_id: projectId,
              sender: 'beegame',
              content: event.text,
              content_mode: getPayloadString(event, 'contentMode') === 'snapshot' ? 'snapshot' : 'delta',
              task_kind: 'assistant_thinking',
              message_id: thinkingMessageId,
              turnId: event.turnId,
              turn_id: event.turnId,
              timestamp: thinkingTimestamp,
              ...(thinkingDurationMs !== undefined ? { thinking_duration_ms: thinkingDurationMs } : {}),
            } as ProjectEventMessage,
            endMessage,
          ]
        }
        return [endMessage]
      }
      if (event.text && event.text !== 'Thinking') {
        return [
          {
            type: 'thought',
            task_id: taskId,
            project_id: projectId,
            sender: 'beegame',
            content: event.text,
            content_mode: getPayloadString(event, 'contentMode') === 'snapshot' ? 'snapshot' : 'delta',
            task_kind: 'assistant_thinking',
            message_id: thinkingMessageId,
            turnId: event.turnId,
            turn_id: event.turnId,
            timestamp: thinkingTimestamp,
            ...(thinkingDurationMs !== undefined ? { thinking_duration_ms: thinkingDurationMs } : {}),
          } as ProjectEventMessage,
        ]
      }
      return [
        {
          type: 'think_start',
          task_id: taskId,
          project_id: projectId,
          sender: 'beegame',
          content: event.text || 'Thinking',
          task_kind: 'assistant_thinking',
          message_id: thinkingMessageId,
          turnId: event.turnId,
          turn_id: event.turnId,
          timestamp: Date.parse(event.createdAt) || now(),
        } as ProjectEventMessage,
      ]
    }
    case 'assistant.message': {
      // Native API error answers are shown by their terminal failure row.
      if (event.payload?.error || event.payload?.isApiErrorMessage === true) return []
      const usage = getUsageFromEventPayload(event.payload)
      return [
        baseMessage('agent_message', event, projectId, 'beegame', now),
        ...(usage
          ? [
              {
                type: 'usage',
                task_id: taskId,
                project_id: projectId,
                turnId: event.turnId,
                turn_id: event.turnId,
                usage,
                timestamp: Date.parse(event.createdAt) || now(),
              } as ProjectEventMessage,
            ]
          : []),
      ]
    }
    case 'result': {
      const usage = getUsageFromEventPayload(event.payload)
      return usage
        ? [
            {
              type: 'usage',
              task_id: taskId,
              project_id: projectId,
              turnId: event.turnId,
              turn_id: event.turnId,
              usage,
              timestamp: Date.parse(event.createdAt) || now(),
            } as ProjectEventMessage,
          ]
        : []
    }
    case 'tool.started': {
      if (Object.keys(getPayloadRecord(event, 'input')).length === 0) return []
      const startedInput = getPayloadRecord(event, 'input')
      const startedTool = getPayloadString(event, 'toolName') || event.text
      const startedInfo = getToolDisplayInfo(
        startedTool,
        'running',
        startedInput,
        workspacePath,
      )
      const startedArtifactPath = getArtifactPath(startedTool, startedInput)
      return [
        {
          type: 'tool_start',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          message_id: getToolMessageId(event),
          tool_use_id: getPayloadString(event, 'toolUseID'),
          tool: startedTool,
          content: formatToolContent(startedInfo),
          tool_status: startedInfo.status,
          tool_detail: startedInfo.detail,
          tool_input: startedInput,
          ...getToolDiffFields(event, startedInput),
          artifact_id: startedArtifactPath
            ? encodeArtifactId(projectId, event.sessionId, startedArtifactPath)
            : undefined,
          artifact_path: startedArtifactPath
            ? toWorkspaceRelativePath(startedArtifactPath, workspacePath)
            : undefined,
          is_subagent_tool: startedInfo.isSubagent,
          subagent_prompt: startedInfo.subagentPrompt,
          subagent_output: startedInfo.subagentOutput,
          subagent_trace: startedInfo.subagentTrace,
          subagent_activity: readSubagentActivity(event.payload?.subagentActivity),
          timestamp: Date.parse(event.createdAt) || now(),
        } as ProjectEventMessage,
      ]
    }
    case 'tool.progress': {
      const progressInput = getPayloadRecord(event, 'input')
      const progressTool = getPayloadString(event, 'toolName') || event.text
      const output =
        typeof event.payload?.output === 'string'
          ? event.payload.output
          : event.text
      const progressInfo = getToolDisplayInfo(
        progressTool,
        'running',
        progressInput,
        workspacePath,
        output,
      )
      const progressArtifactPath = getArtifactPath(progressTool, progressInput)
      return [
        {
          type: 'tool_start',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          message_id: getToolMessageId(event),
          tool_use_id: getPayloadString(event, 'toolUseID'),
          tool: progressTool,
          content: formatToolContent(progressInfo),
          tool_status: progressInfo.status,
          tool_detail: progressInfo.detail,
          tool_output: progressInfo.output,
          tool_input: progressInput,
          ...getToolDiffFields(event, progressInput),
          artifact_id: progressArtifactPath
            ? encodeArtifactId(projectId, event.sessionId, progressArtifactPath)
            : undefined,
          artifact_path: progressArtifactPath
            ? toWorkspaceRelativePath(progressArtifactPath, workspacePath)
            : undefined,
          is_subagent_tool: progressInfo.isSubagent,
          subagent_prompt: progressInfo.subagentPrompt,
          subagent_output: progressInfo.subagentOutput,
          subagent_trace: progressInfo.subagentTrace,
          subagent_activity: readSubagentActivity(event.payload?.subagentActivity),
          timestamp: Date.parse(event.createdAt) || now(),
        } as ProjectEventMessage,
      ]
    }
    case 'tool.completed':
    case 'tool.failed': {
      const finishedInput = getPayloadRecord(event, 'input')
      const finishedTool = getPayloadString(event, 'toolName') || event.text
      const backgroundResult = getPayloadRecord(event, 'nativeBackgroundTaskResult')
      const backgroundToolUseID = typeof backgroundResult.toolUseID === 'string' ? backgroundResult.toolUseID : ''
      if (finishedTool === 'TaskOutput' && backgroundToolUseID &&
          ['completed', 'failed', 'stopped', 'killed'].includes(String(backgroundResult.status))) {
        const failed = backgroundResult.status !== 'completed'
        return eventToProjectEventMessagesBase(projectId, { ...event,
          type: failed ? 'tool.failed' : 'tool.completed',
          payload: { ...event.payload, type: failed ? 'tool.failed' : 'tool.completed',
            toolName: backgroundResult.toolName === 'Task' ? 'Task' : 'Agent', toolUseID: backgroundToolUseID,
            input: getPayloadRecord(event, 'backgroundAgentInput'),
            output: typeof backgroundResult.result === 'string' ? backgroundResult.result : '',
          },
        }, workspacePath, userDisplayText, now)
      }
      const output =
        typeof event.payload?.output === 'string'
          ? event.payload.output
          : event.text
      // The tool has returned a launch receipt, not a subagent result.
      if (event.type === 'tool.completed' && ['agent', 'task'].includes(finishedTool.toLowerCase()) &&
        (event.payload?.nativeBackgroundTask || (/^agentId:\s*\S+/m.test(output) && /^output_file:\s*\S+/m.test(output)))) {
        return eventToProjectEventMessagesBase(projectId, { ...event, type: 'tool.progress',
          payload: { ...event.payload, type: 'tool.progress', output: '' } }, workspacePath, userDisplayText, now)
      }
      const finishedInfo = getToolDisplayInfo(
        finishedTool,
        event.type === 'tool.failed' ? 'failed' : 'completed',
        finishedInput,
        workspacePath,
        output,
      )
      const finishedArtifactPath = getArtifactPath(finishedTool, finishedInput)
      return [
        {
          type: 'tool_end',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          message_id: getToolMessageId(event),
          tool_use_id: getPayloadString(event, 'toolUseID'),
          tool: finishedTool,
          output,
          content: formatToolContent(finishedInfo),
          tool_status: finishedInfo.status,
          tool_detail: finishedInfo.detail,
          tool_output: finishedInfo.output,
          attachments: normalizeChatAttachments(Array.isArray(event.payload?.attachments)
            ? event.payload.attachments.map(item => item && typeof item === 'object' ? { ...item, projectId } : item) : undefined),
          tool_input: finishedInput,
          ...getToolDiffFields(event, finishedInput),
          artifact_id: finishedArtifactPath
            ? encodeArtifactId(projectId, event.sessionId, finishedArtifactPath)
            : undefined,
          artifact_path: finishedArtifactPath
            ? toWorkspaceRelativePath(finishedArtifactPath, workspacePath)
            : undefined,
          is_subagent_tool: finishedInfo.isSubagent,
          subagent_prompt: finishedInfo.subagentPrompt,
          subagent_output: finishedInfo.subagentOutput,
          subagent_trace: finishedInfo.subagentTrace,
          subagent_activity: readSubagentActivity(event.payload?.subagentActivity),
          timestamp: Date.parse(event.createdAt) || now(),
        } as ProjectEventMessage,
      ]
    }
    case 'permission.requested':
      return [
        {
          type: 'human_gate',
          task_id: taskId,
          project_id: projectId,
          message_id: getPermissionRequestMessageId(event),
          content: event.text,
          sender: 'beegame',
          task_kind: getPayloadString(event, 'parentToolUseID') || getPayloadString(event, 'parent_tool_use_id')
            ? 'subagent_permission_request' : 'permission_request',
          turnId: event.turnId,
          turn_id: event.turnId,
          requires_user_action: true,
          timestamp: Date.parse(event.createdAt) || now(),
        } as ProjectEventMessage,
      ]
    case 'permission.resolved': {
      const decision = getPayloadString(event, 'decision')
      if (decision !== 'deny') return []
      return [
        baseMessage(
          'agent_message',
          {
            ...event,
            text: describePermissionResolution(event),
          },
          projectId,
          'system',
          now,
        ),
      ]
    }
    case 'turn.completed': {
      return [
        {
          type: 'status',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          status: 'idle',
          timestamp: Date.parse(event.createdAt),
        } as ProjectEventMessage,
      ]
    }
    case 'turn.empty':
      return [
        baseMessage('agent_message', event, projectId, 'system', now),
        {
          type: 'status',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          status: 'idle',
          timestamp: Date.parse(event.createdAt),
        } as ProjectEventMessage,
      ]
    case 'session.stopped':
      // Host cleanup follows an already terminal native turn; it is not a user stop.
      if (getPayloadString(event, 'reason') === 'agent_goal_settled') return []
      return [
        { type: 'context_update', task_id: taskId, project_id: projectId,
          sender: 'system', message_id: `beegame-session-stop-${event.sessionId}-${event.id}`,
          content: 'stopped', task_kind: 'session_lifecycle', timestamp: Date.parse(event.createdAt) || now(),
        },
        {
          type: 'status',
          task_id: taskId,
          project_id: projectId,
          // A session stop cancels its unfinished work.
          status: 'stopped',
          timestamp: Date.parse(event.createdAt),
        } as ProjectEventMessage,
      ]
    case 'session.resumed':
      return [{ type: 'context_update', task_id: taskId, project_id: projectId,
        sender: 'system', message_id: `beegame-session-resume-${event.sessionId}-${event.id}`,
        content: 'resumed', task_kind: 'session_lifecycle', timestamp: Date.parse(event.createdAt) || now(),
      }]
    case 'turn.failed':
    case 'session.failed':
      return [
        {
          type: 'error',
          message_id: `beegame-failure-${event.sessionId}-${event.turnId || event.id}`,
          task_kind: 'runtime_error',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          content: event.text,
          error: event.text,
          timestamp: Date.parse(event.createdAt),
        } as ProjectEventMessage,
      ]
    default:
      return []
  }
}

function baseMessage(
  type: 'token' | 'agent_message',
  event: BeeGameEvent,
  projectId: string,
  sender: string,
  now: () => number,
): ProjectEventMessage {
  const clientMessageId =
    sender === 'user'
      ? getPayloadString(event, 'clientMessageId') ||
        getPayloadString(event, 'client_message_id')
      : ''
  const supersedesMessageId =
    sender === 'user'
      ? getPayloadString(event, 'supersedesMessageId') ||
        getPayloadString(event, 'supersedes_message_id')
      : ''
  const rewindAvailable = sender === 'user' && event.payload?.rewindAvailable === true
  const messageId =
    sender === 'beegame'
      ? getBeeGameAssistantMessageId(event)
      : clientMessageId || `beegame-event-${event.id}`
  return {
    type,
    task_id: event.sessionId,
    project_id: projectId,
    sender,
    content: event.text,
    ...(sender === 'user' ? { attachments: normalizeChatAttachments(
      Array.isArray(event.payload?.attachments) ? event.payload.attachments.map(item =>
        item && typeof item === 'object' ? { ...item, projectId } : item) : undefined,
    ) } : {}),
    content_blocks: getAssistantContentBlocks(event),
    message_id: messageId,
    ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
    ...(supersedesMessageId
      ? { supersedes_message_id: supersedesMessageId }
      : {}),
    ...(rewindAvailable ? { rewind_available: true } : {}),
    ...(getEventSources(event, 'sources') ? { sources: getEventSources(event, 'sources') } : {}),
    ...(getEventSources(event, 'citations') ? { citations: getEventSources(event, 'citations') } : {}),
    ...(event.turnId ? { turnId: event.turnId, turn_id: event.turnId } : {}),
    timestamp: Date.parse(event.createdAt) || now(),
  } as ProjectEventMessage
}

type EventSource = { id?: string; title?: string; domain?: string; url?: string }

function getEventSources(event: BeeGameEvent, key: 'sources' | 'citations'): EventSource[] | undefined {
  const payload = event.payload
  const nested = payload?.message && typeof payload.message === 'object' && !Array.isArray(payload.message)
    ? payload.message as Record<string, unknown>
    : undefined
  const value = payload?.[key] ?? nested?.[key]
  if (!Array.isArray(value)) return undefined
  const sources = value.flatMap((entry): EventSource[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (!title) return []
    return [{
      ...(typeof record.id === 'string' ? { id: record.id } : {}),
      title,
      ...(typeof record.domain === 'string' ? { domain: record.domain } : {}),
      ...(typeof record.url === 'string' ? { url: record.url } : {}),
    }]
  })
  return sources.length > 0 ? sources : undefined
}

function describePermissionResolution(event: BeeGameEvent): string {
  const toolName = getPayloadString(event, 'toolName') || 'tool'
  const reason = getPayloadString(event, 'reason')
  if (getPayloadBoolean(event, 'autoDenied')) {
    return reason
      ? `BeeGame blocked ${toolName}: ${reason}`
      : `BeeGame blocked ${toolName}.`
  }
  return reason ? `${toolName} denied: ${reason}` : `${toolName} denied.`
}

function getPermissionRequestMessageId(event: BeeGameEvent): string {
  const toolUseID = getPayloadString(event, 'toolUseID')
  if (toolUseID) return `beegame-permission-${event.sessionId}-${toolUseID}`
  return `beegame-permission-${event.sessionId}-${event.id}`
}

function getToolMessageId(event: BeeGameEvent): string {
  const toolUseId = getPayloadString(event, 'toolUseID')
  if (toolUseId) return `beegame-tool-${event.sessionId}-${toolUseId}`
  return `beegame-event-${event.id}`
}

type ToolDisplayInfo = {
  name: string
  status: 'running' | 'completed' | 'failed'
  detail: string
  output: string
  isSubagent: boolean
  subagentPrompt?: string
  subagentOutput?: string
  subagentTrace?: string
}

function getToolDiffFields(
  event: BeeGameEvent,
  input: Record<string, unknown>,
): Pick<ProjectEventMessage, 'tool_diff' | 'tool_patch' | 'tool_before' | 'tool_after' | 'structured_patch'> {
  const payload: Record<string, unknown> = event.payload || {}
  const output = payload.output && typeof payload.output === 'object' && !Array.isArray(payload.output)
    ? payload.output as Record<string, unknown>
    : undefined
  const result = payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)
    ? payload.result as Record<string, unknown>
    : undefined
  const readString = (key: string): string | undefined => {
    for (const source of [payload, input, output, result]) {
      const value = source?.[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return undefined
  }
  const diff = readString('diff') || readString('gitDiff') || readString('git_diff')
  const patch = readString('patch')
  const before = readString('before') || readString('oldContent') || readString('old_content') || readString('originalFile') || readString('original_file')
  const after = readString('after') || readString('newContent') || readString('new_content')
  const readUnknown = (key: string): unknown => {
    for (const source of [payload, input, output, result]) {
      const value = source?.[key]
      if (value !== undefined) return value
    }
    return undefined
  }
  const structuredPatch = readUnknown('structuredPatch') ?? readUnknown('structured_patch')
  return {
    ...(diff ? { tool_diff: diff } : {}),
    ...(patch ? { tool_patch: patch } : {}),
    ...(before !== undefined ? { tool_before: before } : {}),
    ...(after !== undefined ? { tool_after: after } : {}),
    ...(structuredPatch !== undefined ? { structured_patch: structuredPatch } : {}),
  }
}

function getToolDisplayInfo(
  toolName: string,
  status: 'running' | 'completed' | 'failed',
  input: Record<string, unknown>,
  workspacePath: string,
  output = '',
): ToolDisplayInfo {
  const normalizedTool = toolName.toLowerCase()
  const isSubagent = normalizedTool === 'agent' || normalizedTool === 'task'
  const description = String(input.description || '').trim()
  const subagentType = String(
    input.subagent_type || input.agent_type || '',
  ).trim()
  const prompt = String(input.prompt || '').trim()
  const trace = String(input.trace || input.trace_output || '').trim()
  const name = isSubagent ? description || toolName : toolName
  const details: string[] = []
  if (isSubagent && subagentType) {
    details.push(`Type: ${subagentType}`)
  }
  if (isSubagent && prompt) {
    details.push(
      `Prompt: ${prompt.length > 220 ? `${prompt.slice(0, 220)}...` : prompt}`,
    )
  }
  const command = String(input.command || '').trim()
  const targetPath = String(
    input.file_path || input.path || input.notebook_path || '',
  ).trim()
  if (!isSubagent && command) {
    details.push(`Command: ${command}`)
  } else if (!isSubagent && targetPath) {
    details.push(
      `Target: ${formatWorkspaceRelativePath(targetPath, workspacePath)}`,
    )
  }
  const outputSummary =
    output.length > 160 ? `${output.slice(0, 160)}...` : output
  return {
    name,
    status,
    detail: details.join(' · '),
    output: outputSummary,
    isSubagent,
    ...(isSubagent && prompt ? { subagentPrompt: prompt } : {}),
    ...(isSubagent && output ? { subagentOutput: output } : {}),
    ...(isSubagent && trace ? { subagentTrace: trace } : {}),
  }
}

function formatToolContent(info: ToolDisplayInfo): string {
  const lines = info.isSubagent
    ? [`Subagent: ${info.name}`, `Status: ${info.status}`]
    : [`Tool: ${info.name}`, `Status: ${info.status}`]
  if (info.detail) {
    lines.push(info.detail)
  }
  if (info.output) {
    lines.push(`Output: ${info.output}`)
  }
  return lines.join('\n')
}

function formatWorkspaceRelativePath(
  path: string,
  workspacePath: string,
): string {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedWorkspace = workspacePath
    .replaceAll('\\', '/')
    .replace(/\/+$/, '')
  if (
    normalizedWorkspace &&
    normalizedPath.startsWith(`${normalizedWorkspace}/`)
  ) {
    return normalizedPath.slice(normalizedWorkspace.length + 1)
  }
  return normalizedPath.split('/').filter(Boolean).slice(-2).join('/') || path
}

export function getUsageFromEventPayload(payload?: Record<string, unknown>): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
} | null {
  const usage = getUsageRecord(payload)
  if (!usage) return null
  const promptTokens = normalizePositiveNumber(
    usage.input_tokens ?? usage.prompt_tokens,
  )
  const completionTokens = normalizePositiveNumber(
    usage.output_tokens ?? usage.completion_tokens,
  )
  const cacheReadTokens = normalizePositiveNumber(usage.cache_read_input_tokens ?? usage.cache_read_tokens)
  const cacheCreationTokens = normalizePositiveNumber(usage.cache_creation_input_tokens ?? usage.cache_creation_tokens)
  const totalTokens = normalizePositiveNumber(
    usage.total_tokens,
    promptTokens + completionTokens + cacheReadTokens + cacheCreationTokens,
  )
  if (!promptTokens && !completionTokens && !cacheReadTokens && !cacheCreationTokens && !totalTokens) return null
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheCreationTokens,
  }
}

function getUsageRecord(
  payload?: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!payload) return null
  const directUsage = payload.usage
  if (
    directUsage &&
    typeof directUsage === 'object' &&
    !Array.isArray(directUsage)
  ) {
    return directUsage as Record<string, unknown>
  }
  const streamEvent = payload.event
  if (streamEvent && typeof streamEvent === 'object' && !Array.isArray(streamEvent)) {
    const eventUsage = (streamEvent as Record<string, unknown>).usage
    if (eventUsage && typeof eventUsage === 'object' && !Array.isArray(eventUsage))
      return eventUsage as Record<string, unknown>
    const streamMessage = (streamEvent as Record<string, unknown>).message
    if (streamMessage && typeof streamMessage === 'object' && !Array.isArray(streamMessage)) {
      const messageUsage = (streamMessage as Record<string, unknown>).usage
      if (messageUsage && typeof messageUsage === 'object' && !Array.isArray(messageUsage))
        return messageUsage as Record<string, unknown>
    }
  }
  const message = payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message))
    return null
  const messageUsage = (message as Record<string, unknown>).usage
  if (
    messageUsage &&
    typeof messageUsage === 'object' &&
    !Array.isArray(messageUsage)
  ) {
    return messageUsage as Record<string, unknown>
  }
  return null
}

function normalizePositiveNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  if (Number.isFinite(number) && number > 0) return number
  return Math.max(0, fallback)
}

/** Assemble display history without changing the caller's projected messages. */
export function projectHistoryMessages(
  projectedMessages: readonly ProjectEventMessage[],
  turnCompletedAt: ReadonlyMap<string, number>,
  now: () => number = Date.now,
): unknown[] {
  const historyMessages = projectedMessages.map(message => ({ ...message }))
  const thoughtMessages = new Map<string, ProjectEventMessage>()
  const toolMessages = new Map<string, ProjectEventMessage>()
  const compactionMessages = new Map<string, ProjectEventMessage>()
  const thinkingStartedAtByMessage = new Map<string, number>()
  const endedThoughts = new Set<string>()
  const messages = historyMessages.flatMap(message => {
    // Billing receipts refresh account data in the live channel; they are not chat content.
    if (message.type === 'billing_update') return []
    // Keep the live human_gate notification (it refreshes the approval panel),
    // but its record is already displayed inside the owning subagent.
    if (message.type === 'human_gate' && message.task_kind === 'subagent_permission_request') return []
    if (message.type === 'context_compaction' && message.message_id) {
      const existing = compactionMessages.get(message.message_id)
      if (existing) {
        existing.content = message.content
        existing.status = message.status
        return []
      }
      compactionMessages.set(message.message_id, message)
      return [message]
    }
    if ((message.type === 'tool_start' || message.type === 'tool_end') && message.message_id) {
      const existing = toolMessages.get(message.message_id)
      if (existing) {
        const firstSequence = existing.sequence
        const firstTimestamp = existing.timestamp
        Object.assign(existing, Object.fromEntries(Object.entries(message).filter(([, value]) => value !== undefined)))
        existing.sequence = firstSequence
        existing.timestamp = firstTimestamp
        return []
      }
      toolMessages.set(message.message_id, message)
      return [message]
    }
    if (message.type === 'think_start') {
      if (message.message_id) {
        thinkingStartedAtByMessage.set(message.message_id, message.timestamp || 0)
      }
      return []
    }
    if (message.type === 'think_end') {
      if (message.message_id) endedThoughts.add(message.message_id)
      const thought = message.message_id
        ? thoughtMessages.get(message.message_id)
        : undefined
      // The end event owns the authoritative wall-clock duration. Keep the
      // visible Thought card, but transfer that value before suppressing the
      // lifecycle marker from the history UI.
      if (thought && typeof message.thinking_duration_ms === 'number') {
        thought.thinking_duration_ms = message.thinking_duration_ms
      }
      if (message.message_id) thinkingStartedAtByMessage.delete(message.message_id)
      return []
    }
    if (message.type !== 'thought' || !message.message_id) return [message]
    const existing = thoughtMessages.get(message.message_id)
    if (existing) {
      existing.content = message.content_mode === 'snapshot' ? message.content : `${existing.content || ''}${message.content || ''}`
      if (typeof message.thinking_duration_ms === 'number') {
        existing.thinking_duration_ms = message.thinking_duration_ms
      }
      return []
    }
    const thinkingStartedAt = thinkingStartedAtByMessage.get(message.message_id)
    if (thinkingStartedAt !== undefined) message.timestamp = thinkingStartedAt
    thoughtMessages.set(message.message_id, message)
    return [message]
  })
  let history = messages.map(message => ({
    id:
      message.message_id || `${message.type}-${message.task_id}-${now()}`,
    message_id: message.message_id,
    client_message_id: message.client_message_id,
    supersedes_message_id: message.supersedes_message_id,
    sender: message.sender || 'system',
    content: message.content || '',
    contentBlocks: message.content_blocks,
    task_id: message.task_id,
    turnId: message.turnId || message.turn_id,
    turn_id: message.turn_id || message.turnId,
    timestamp: message.timestamp || now(),
    ...(turnCompletedAt.has(message.turnId || message.turn_id || '')
      ? { turnCompletedAt: turnCompletedAt.get(message.turnId || message.turn_id || '') }
      : {}),
    sequence: message.sequence,
    streamStatus: message.type === 'token' || (message.type === 'thought' && !endedThoughts.has(message.message_id || '')) || (message.type === 'context_compaction' && message.status === 'running') ? 'streaming' : 'complete',
    thinkingDurationMs: message.thinking_duration_ms,
    type:
      message.type === 'agent_message' || message.type === 'token'
        ? 'text'
        : message.type === 'error'
          ? 'error'
        : message.type === 'context_compaction'
          ? 'system_status'
        : message.type === 'thought'
          ? 'thought'
        : message.type === 'tool_start' || message.type === 'tool_end'
          ? 'tool'
          : 'normal',
    renderHint: message.render_hint,
    artifactType: message.artifact_type,
    taskKind: message.task_kind,
    nextAction: message.next_action,
    requiresUserAction: message.requires_user_action,
    toolName: message.tool,
    toolUseId: message.tool_use_id,
    toolStatus: message.tool_status,
    toolDetail: message.tool_detail,
    toolOutput: message.tool_output,
    toolInput: message.tool_input,
    todoScope: message.todoScope,
    toolDiff: message.tool_diff,
    toolPatch: message.tool_patch,
    toolBefore: message.tool_before,
    toolAfter: message.tool_after,
    toolStructuredPatch: message.structured_patch,
    subagentPrompt: message.subagent_prompt,
    subagentOutput: message.subagent_output,
    subagentTrace: message.subagent_trace,
    subagentActivity: message.subagent_activity,
    sources: message.sources,
    attachments: message.attachments,
    citations: message.citations,
    artifactId: message.artifact_id,
    isSubagentTool: message.is_subagent_tool,
  }))
  for (const message of projectedMessages) {
    const status = message.status
    if (message.type !== 'error' && !(message.type === 'status' && ['idle', 'finished', 'stopped', 'failed'].includes(status || ''))) continue
    history = settleChatActivity(history, { taskId: message.task_id, turnId: message.turnId || message.turn_id,
      at: message.timestamp || now(), reason: message.type === 'error' || status === 'failed' ? 'failed' : status === 'stopped' ? 'stopped' : 'incomplete' })
  }
  return history
}
