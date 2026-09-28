import type {
  BuildReportPayload,
  ContextVisibilityPayload,
  PendingToolPermissionItem,
  ProjectBaselineStatusPayload,
} from '../services/api'
import { normalizeChatSources } from '../utils/chatSources'
import type { Message } from '../types/message'

export type ChatDisplaySource = {
  id: string
  title: string
  domain?: string
  url?: string
}

export type ChatDisplayMessage = Pick<
  Message,
  | 'id' | 'messageId' | 'clientMessageId' | 'supersedesMessageId' | 'rewindAvailable' | 'dedupeKey'
  | 'sender' | 'content' | 'attachments' | 'timestamp' | 'turnCompletedAt' | 'sequence' | 'type'
  | 'isDocument' | 'documentTitle' | 'thought' | 'thinkingDurationMs'
  | 'streamStatus' | 'completionReason' | 'contentBlocks' | 'taskId' | 'todoScope'
  | 'turnId' | 'turn_id' | 'artifactId' | 'artifactPath' | 'renderHint'
  | 'artifactType' | 'taskKind' | 'nextAction' | 'requiresUserAction'
  | 'errorDetails' | 'toolName' | 'toolUseId' | 'toolStatus' | 'toolDetail'
  | 'toolOutput' | 'toolDiff' | 'toolPatch' | 'toolBefore' | 'toolAfter'
  | 'toolStructuredPatch' | 'toolInput' | 'isSubagentTool' | 'subagentPrompt'
  | 'subagentOutput' | 'subagentTrace' | 'subagentActivity'
> & {
  sources?: ChatDisplaySource[]
  citations?: ChatDisplaySource[]
}

export interface PermissionDisplaySummary {
  block_reason?: string
  next_action?: string
}

export interface BuildReportCheckDisplay {
  name?: string
  status?: string
  detail?: string
  path?: string
}

export interface BuildReportDisplayModel {
  status?: string
  entrypoint?: string
  report_path?: string
  build_url?: string
  agents: string[]
  generated_paths: string[]
  checks: BuildReportCheckDisplay[]
  summary?: string
  failure_reason?: string
  created_at?: string
}

export interface PermissionDisplayModel {
  gate_id: string
  type: 'BEEGAME_PERMISSION'
  title?: string
  permission_tool_name?: string
  task_id?: string | null
  artifact?: Record<string, unknown>
  summary?: PermissionDisplaySummary
  raw?: PendingToolPermissionItem
}

export interface ProjectRuntimeDisplayModel {
  project_id: string
  phase?: string
  delivery_phase?: string
  active_subagents?: string[]
  blocked?: boolean
  blocked_reason?: string | null
  blocked_reason_code?: string | null
  blocked_reason_diagnostic_id?: string | null
  next_action?: string
  acceptance?: ProjectBaselineStatusPayload['acceptance']
  context?: ContextVisibilityPayload
  build_report?: BuildReportDisplayModel
}

const trimString = (value: unknown): string => String(value ?? '').trim()

const normalizeBuildReportDisplay = (
  payload?: BuildReportPayload | null,
): BuildReportDisplayModel | undefined => {
  if (!payload) return undefined
  const buildReport: BuildReportDisplayModel = {
    status: trimString(payload.status) || undefined,
    entrypoint: trimString(payload.entrypoint) || undefined,
    report_path: trimString(payload.report_path) || undefined,
    build_url: trimString(payload.build_url) || undefined,
    agents: Array.isArray(payload.agents)
      ? payload.agents.map(trimString).filter(Boolean)
      : [],
    generated_paths: Array.isArray(payload.generated_paths)
      ? payload.generated_paths.map(trimString).filter(Boolean)
      : [],
    checks: Array.isArray(payload.checks)
      ? payload.checks.map(item => ({
          name: trimString(item?.name) || undefined,
          status: trimString(item?.status) || undefined,
          detail: trimString(item?.detail) || undefined,
          path: trimString(item?.path) || undefined,
        })).filter(item => Object.values(item).some(value => value !== undefined))
      : [],
    summary: trimString(payload.summary) || undefined,
    failure_reason: trimString(payload.failure_reason) || undefined,
    created_at: trimString(payload.created_at) || undefined,
  }
  return Object.values(buildReport).some(value => Array.isArray(value)
    ? value.length > 0
    : value !== undefined) ? buildReport : undefined
}

const normalizeDisplaySources = (
  value: Message['sources'] | Message['citations'],
): ChatDisplaySource[] | undefined => {
  const normalized = normalizeChatSources(value)
  if (!normalized) return undefined
  const sources = normalized.flatMap(source => {
    if (!source || typeof source !== 'object') return []
    const title = String(source.title || '').trim()
    if (!title) return []
    return [{
      id: String(source.id || source.url || JSON.stringify([title, source.domain || ''])),
      title,
      ...(source.domain ? { domain: String(source.domain) } : {}),
      ...(source.url ? { url: String(source.url) } : {}),
    }]
  })
  return sources.length ? sources : undefined
}

export const toChatDisplayMessage = (message: Message): ChatDisplayMessage => ({
  id: message.id,
  messageId: message.messageId,
  clientMessageId: message.clientMessageId,
  supersedesMessageId: message.supersedesMessageId,
  rewindAvailable: message.rewindAvailable,
  dedupeKey: message.dedupeKey,
  sender: message.sender,
  content: message.content,
  attachments: message.attachments,
  timestamp: message.timestamp,
  turnCompletedAt: message.turnCompletedAt,
  sequence: message.sequence,
  type: message.type,
  isDocument: message.isDocument,
  documentTitle: message.documentTitle,
  thought: message.thought,
  thinkingDurationMs: message.thinkingDurationMs,
  streamStatus: message.streamStatus,
  completionReason: message.completionReason,
  contentBlocks: message.contentBlocks,
  taskId: message.taskId,
  todoScope: message.todoScope,
  turnId: message.turnId || message.turn_id,
  turn_id: message.turn_id || message.turnId,
  artifactId: message.artifactId,
  artifactPath: message.artifactPath,
  renderHint: message.renderHint,
  artifactType: message.artifactType,
  taskKind: message.taskKind,
  nextAction: message.nextAction,
  requiresUserAction: message.requiresUserAction,
  errorDetails: message.errorDetails,
  toolName: message.toolName,
  toolUseId: message.toolUseId,
  toolStatus: message.toolStatus,
  toolDetail: message.toolDetail,
  toolOutput: message.toolOutput,
  toolDiff: message.toolDiff,
  toolPatch: message.toolPatch,
  toolBefore: message.toolBefore,
  toolAfter: message.toolAfter,
  toolStructuredPatch: message.toolStructuredPatch,
  toolInput: message.toolInput,
  isSubagentTool: message.isSubagentTool,
  subagentPrompt: message.subagentPrompt,
  subagentOutput: message.subagentOutput,
  subagentTrace: message.subagentTrace,
  subagentActivity: message.subagentActivity,
  sources: normalizeDisplaySources(message.sources),
  citations: normalizeDisplaySources(message.citations),
})

export const toChatDisplayMessages = (messages: Message[]): ChatDisplayMessage[] =>
  messages.map(toChatDisplayMessage)

export const toPermissionDisplayModel = (
  permission: PendingToolPermissionItem,
): PermissionDisplayModel => ({
  gate_id: trimString(permission.gate_id),
  type: 'BEEGAME_PERMISSION',
  title: trimString(permission.title) || undefined,
  permission_tool_name: trimString(permission.permission_tool_name) || undefined,
  task_id: trimString(permission.task_id) || undefined,
  artifact: permission.artifact && typeof permission.artifact === 'object'
    ? permission.artifact
    : undefined,
  summary: permission.summary ? {
    block_reason: trimString(permission.summary.block_reason) || undefined,
    next_action: trimString(permission.summary.next_action) || undefined,
  } : undefined,
  raw: permission,
})

export const toPermissionDisplayModels = (
  permissions: PendingToolPermissionItem[],
): PermissionDisplayModel[] => permissions.map(toPermissionDisplayModel)

export const toProjectRuntimeDisplayModel = (
  payload?: ProjectBaselineStatusPayload | null,
): ProjectRuntimeDisplayModel | null => {
  if (!payload) return null
  return {
    project_id: trimString(payload.project_id),
    phase: trimString(payload.phase) || undefined,
    delivery_phase: trimString(payload.delivery_phase) || undefined,
    active_subagents: Array.isArray(payload.active_subagents)
      ? payload.active_subagents.map(trimString).filter(Boolean)
      : [],
    blocked: Boolean(payload.blocked),
    blocked_reason: payload.blocked_reason ?? null,
    blocked_reason_code: trimString(payload.blocked_reason_code) || undefined,
    blocked_reason_diagnostic_id: trimString(payload.blocked_reason_diagnostic_id) || undefined,
    next_action: trimString(payload.next_action) || undefined,
    acceptance: payload.acceptance,
    context: payload.context ? {
      bundle_id: trimString(payload.context.bundle_id) || undefined,
      phase: trimString(payload.context.phase) || undefined,
      status: trimString(payload.context.status) || undefined,
      summary: trimString(payload.context.summary) || undefined,
      failure_reason: trimString(payload.context.failure_reason) || undefined,
      blackboard_record_count: Number(payload.context.blackboard_record_count ?? 0),
      memory_hits: Number(payload.context.memory_hits ?? 0),
      rag_sources: Array.isArray(payload.context.rag_sources)
        ? payload.context.rag_sources.map(trimString).filter(Boolean)
        : [],
      selected_skills: Array.isArray(payload.context.selected_skills)
        ? payload.context.selected_skills.map(trimString).filter(Boolean)
        : [],
    } : undefined,
    build_report: normalizeBuildReportDisplay(payload.build_report),
  }
}
