import type {
  BuildReportPayload,
  ContextVisibilityPayload,
  PendingToolPermissionItem,
  ProjectBaselineStatusPayload,
} from '../services/api'
import type {
  Message,
  WorkflowCardPayload,
  WorkflowCardStatus,
  WorkflowCardTask,
  WorkflowRecoveryUnitKind,
} from '../types/message'

export type ChatDisplayMessage = Pick<
  Message,
  | 'id'
  | 'messageId'
  | 'clientMessageId'
  | 'supersedesMessageId'
  | 'dedupeKey'
  | 'sender'
  | 'content'
  | 'attachments'
  | 'timestamp'
  | 'type'
  | 'isDocument'
  | 'documentTitle'
  | 'thought'
  | 'taskId'
  | 'artifactId'
  | 'artifactPath'
  | 'renderHint'
  | 'artifactType'
  | 'taskKind'
  | 'nextAction'
  | 'requiresUserAction'
  | 'errorDetails'
  | 'toolName'
  | 'toolStatus'
  | 'toolDetail'
  | 'toolOutput'
  | 'isSubagentTool'
>

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
  blocked?: boolean
  blocked_reason?: string | null
  next_action?: string
  acceptance?: ProjectBaselineStatusPayload['acceptance']
  context?: ContextVisibilityPayload
  build_report?: BuildReportDisplayModel
  workflow?: WorkflowCardPayload
}

const WORKFLOW_STATUS: Record<string, WorkflowCardStatus> = {
  draft: 'draft',
  starting: 'running',
  running: 'running',
  needs_action: 'blocked',
  blocked: 'blocked',
  verifying: 'verifying',
  delivered: 'completed',
  completed: 'completed',
  failed: 'failed',
  interrupted: 'cancelled',
  stopped: 'cancelled',
  cancelled: 'cancelled',
  stale: 'stale',
}

const WORKFLOW_RECOVERY_UNIT_KINDS: readonly WorkflowRecoveryUnitKind[] = [
  'document',
  'review-check',
  'checklist',
  'resource-inventory',
  'resource-content',
  'resource-gate',
  'atomic-plan',
  'implementation-task',
  'implementation-audit',
  'acceptance',
]

const normalizeWorkflowMessage = (value: unknown): string | undefined => {
  const message = trimString(value)
  if (!message) return undefined
  try {
    const payload: unknown = JSON.parse(message)
    if (payload !== null && typeof payload === 'object') return undefined
  } catch {
    // Workflow progress is ordinary display copy unless it is a complete JSON payload.
  }
  return message
}

/** Convert backend workflow data into the only shape the UI may render. */
const normalizeWorkflowDisplay = (
  payload: unknown,
): WorkflowCardPayload | undefined => {
  if (!payload || typeof payload !== 'object') return undefined
  const source = payload as Record<string, unknown>
  const runId = trimString(source.runId ?? source.run_id)
  const status = WORKFLOW_STATUS[trimString(source.status).toLowerCase()]
  if (!runId || !status) return undefined

  const thinkingValue = source.thinking
  const thinking =
    typeof thinkingValue === 'string' && thinkingValue.trim()
      ? thinkingValue.trim()
      : undefined
  const block =
    source.block && typeof source.block === 'object'
      ? (source.block as Record<string, unknown>)
      : undefined
  const blockMessage =
    typeof block?.message === 'string' && block.message.trim()
      ? block.message.trim()
      : undefined
  const activeDispatch =
    source.activeDispatch && typeof source.activeDispatch === 'object'
      ? (source.activeDispatch as Record<string, unknown>)
      : undefined
  const rawThinking = trimString(source.thinking)
  const message = normalizeWorkflowMessage(source.message)
  const tasks = Array.isArray(source.tasks)
    ? source.tasks.flatMap((task): WorkflowCardTask[] => {
        if (!task || typeof task !== 'object') return []
        const item = task as Record<string, unknown>
        const id = trimString(item.id)
        const title = trimString(item.title)
        const taskStatus = trimString(item.status).toLowerCase()
        if (
          !id ||
          !title ||
          ![
            'pending',
            'running',
            'completed',
            'failed',
            'blocked',
            'stopped',
          ].includes(taskStatus)
        )
          return []
        return [
          {
            id,
            title,
            status: taskStatus as NonNullable<
              WorkflowCardPayload['tasks']
            >[number]['status'],
            operation:
              item.operation === 'write' ||
              item.operation === 'review' ||
              item.operation === 'produce' ||
              item.operation === 'assemble'
                ? item.operation
                : undefined,
            attempt: Number.isFinite(Number(item.attempt))
              ? Number(item.attempt)
              : undefined,
            failureReason:
              trimString(item.failureReason ?? item.failure_reason) ||
              undefined,
          },
        ]
      })
    : undefined
  const failureReason = trimString(
    source.failureReason ??
      source.failure_reason ??
      source.blockedReason ??
      source.blocked_reason,
  )
  const nextActionValue = trimString(source.nextAction ?? source.next_action)
  const recoverable = source.recoverable === true
  const recoveryUnitKind = trimString(
    source.lastProvenUnitKind ?? source.last_proven_unit_kind,
  )

  return {
    runId,
    status,
    currentPhase:
      trimString(source.currentPhase ?? source.current_phase ?? source.phase) ||
      undefined,
    phaseIndex: Number.isFinite(Number(source.phaseIndex ?? source.phase_index))
      ? Number(source.phaseIndex ?? source.phase_index)
      : undefined,
    phaseCount: Number.isFinite(Number(source.phaseCount ?? source.phase_count))
      ? Number(source.phaseCount ?? source.phase_count)
      : undefined,
    substage: [
      'INITIAL_DRAFTING',
      'INITIAL_REVIEW',
      'REPAIR_PLANNING',
      'REPAIRING',
      'CLOSURE_REVIEW',
      'CHECKLIST_DRAFTING',
    ].includes(String(source.substage))
      ? (source.substage as NonNullable<WorkflowCardPayload['substage']>)
      : undefined,
    convergencePass:
      Number.isInteger(Number(source.convergencePass)) &&
      Number(source.convergencePass) > 0
        ? Number(source.convergencePass)
        : undefined,
    documentStep:
      trimString(source.documentStep ?? source.document_step) || undefined,
    reviewMode:
      source.reviewMode === 'initial' || source.reviewMode === 'closure'
        ? source.reviewMode
        : undefined,
    reviewTarget:
      source.reviewTarget === 'foundation' ||
      source.reviewTarget === 'checklist' ||
      source.reviewTarget === 'resource'
        ? source.reviewTarget
        : undefined,
    worker:
      trimString(
        source.worker ??
          activeDispatch?.workerType ??
          activeDispatch?.worker_type,
      ) || undefined,
    thinking:
      message ||
      (thinking && !['working', 'waiting', 'idle'].includes(thinking)
        ? thinking
        : undefined),
    executionStatus: ['working', 'waiting', 'idle'].includes(rawThinking)
      ? rawThinking
      : trimString(activeDispatch?.status) || undefined,
    currentItemId:
      trimString(
        source.currentItemId ??
          source.current_item_id ??
          source.activeTaskId ??
          source.active_task_id,
      ) || undefined,
    tasks,
    completedTaskCount: Number.isFinite(Number(source.completedTaskCount))
      ? Number(source.completedTaskCount)
      : undefined,
    totalTaskCount: Number.isFinite(Number(source.totalTaskCount))
      ? Number(source.totalTaskCount)
      : undefined,
    createdAt: trimString(source.createdAt ?? source.created_at) || undefined,
    completedAt:
      trimString(source.completedAt ?? source.completed_at) || undefined,
    updatedAt: trimString(source.updatedAt ?? source.updated_at) || undefined,
    stageStartedAt:
      trimString(activeDispatch?.startedAt ?? activeDispatch?.started_at) ||
      undefined,
    elapsedMs: Number.isFinite(Number(source.elapsedMs ?? source.elapsed_ms))
      ? Math.max(0, Number(source.elapsedMs ?? source.elapsed_ms))
      : undefined,
    activeSince:
      trimString(source.activeSince ?? source.active_since) || undefined,
    nextAction:
      nextActionValue === 'resume' || nextActionValue === 'retry'
        ? nextActionValue
        : undefined,
    recoverable,
    lastProvenPhase:
      recoverable && trimString(source.lastProvenPhase ?? source.last_proven_phase)
        ? trimString(source.lastProvenPhase ?? source.last_proven_phase)
        : undefined,
    lastProvenUnitId:
      recoverable && trimString(source.lastProvenUnitId ?? source.last_proven_unit_id)
        ? trimString(source.lastProvenUnitId ?? source.last_proven_unit_id)
        : undefined,
    lastProvenUnitKind:
      recoverable && WORKFLOW_RECOVERY_UNIT_KINDS.includes(recoveryUnitKind as WorkflowRecoveryUnitKind)
        ? recoveryUnitKind as WorkflowRecoveryUnitKind
        : undefined,
    lastProvenItemId:
      recoverable && trimString(source.lastProvenItemId ?? source.last_proven_item_id)
        ? trimString(source.lastProvenItemId ?? source.last_proven_item_id)
        : undefined,
    block:
      blockMessage || failureReason
        ? {
            message: blockMessage || failureReason,
            nextAction:
              trimString(block?.nextAction ?? block?.next_action) || undefined,
          }
        : undefined,
    usage:
      source.usage && typeof source.usage === 'object'
        ? (source.usage as WorkflowCardPayload['usage'])
        : undefined,
  }
}

export const getWorkflowControlState = (
  payload?: ProjectRuntimeDisplayModel | null,
): WorkflowCardPayload | undefined => {
  return payload?.workflow
}

const trimString = (value: unknown): string => String(value ?? '').trim()

const unwrapProjectRuntimePayload = (
  payload?: ProjectBaselineStatusPayload | null,
): ProjectBaselineStatusPayload | undefined => {
  return payload ?? undefined
}

const normalizeBuildReportDisplay = (
  payload?: BuildReportPayload | null,
): BuildReportDisplayModel | undefined => {
  if (!payload) {
    return undefined
  }
  const buildReport: BuildReportDisplayModel = {
    status: trimString(payload.status) || undefined,
    entrypoint: trimString(payload.entrypoint) || undefined,
    report_path: trimString(payload.report_path) || undefined,
    build_url: trimString(payload.build_url) || undefined,
    agents: Array.isArray(payload.agents)
      ? payload.agents.map(item => trimString(item)).filter(Boolean)
      : [],
    generated_paths: Array.isArray(payload.generated_paths)
      ? payload.generated_paths.map(item => trimString(item)).filter(Boolean)
      : [],
    checks: Array.isArray(payload.checks)
      ? payload.checks
          .map(item => ({
            name: trimString(item?.name) || undefined,
            status: trimString(item?.status) || undefined,
            detail: trimString(item?.detail) || undefined,
            path: trimString(item?.path) || undefined,
          }))
          .filter(item =>
            Object.values(item).some(value => value !== undefined),
          )
      : [],
    summary: trimString(payload.summary) || undefined,
    failure_reason: trimString(payload.failure_reason) || undefined,
    created_at: trimString(payload.created_at) || undefined,
  }
  return Object.values(buildReport).some(value => {
    if (Array.isArray(value)) {
      return value.length > 0
    }
    return value !== undefined
  })
    ? buildReport
    : undefined
}

export const toChatDisplayMessage = (message: Message): ChatDisplayMessage => ({
  id: message.id,
  messageId: message.messageId,
  clientMessageId: message.clientMessageId,
  dedupeKey: message.dedupeKey,
  sender: message.sender,
  content: message.content,
  timestamp: message.timestamp,
  type: message.type,
  isDocument: message.isDocument,
  documentTitle: message.documentTitle,
  thought: message.thought,
  taskId: message.taskId,
  artifactId: message.artifactId,
  artifactPath: message.artifactPath,
  renderHint: message.renderHint,
  artifactType: message.artifactType,
  taskKind: message.taskKind,
  nextAction: message.nextAction,
  requiresUserAction: message.requiresUserAction,
  errorDetails: message.errorDetails,
  toolName: message.toolName,
  toolStatus: message.toolStatus,
  toolDetail: message.toolDetail,
  toolOutput: message.toolOutput,
  isSubagentTool: message.isSubagentTool,
})

export const toChatDisplayMessages = (
  messages: Message[],
): ChatDisplayMessage[] => messages.map(toChatDisplayMessage)

export const toPermissionDisplayModel = (
  permission: PendingToolPermissionItem,
): PermissionDisplayModel => ({
  gate_id: trimString(permission.gate_id),
  type: 'BEEGAME_PERMISSION',
  title: trimString(permission.title) || undefined,
  permission_tool_name:
    trimString(permission.permission_tool_name) || undefined,
  task_id: trimString(permission.task_id) || undefined,
  artifact:
    permission.artifact && typeof permission.artifact === 'object'
      ? permission.artifact
      : undefined,
  summary: permission.summary
    ? {
        block_reason: trimString(permission.summary.block_reason) || undefined,
        next_action: trimString(permission.summary.next_action) || undefined,
      }
    : undefined,
  raw: permission,
})

export const toPermissionDisplayModels = (
  permissions: PendingToolPermissionItem[],
): PermissionDisplayModel[] => permissions.map(toPermissionDisplayModel)

export const toProjectRuntimeDisplayModel = (
  payload?: ProjectBaselineStatusPayload | null,
): ProjectRuntimeDisplayModel | null => {
  const normalizedPayload = unwrapProjectRuntimePayload(payload)
  if (!normalizedPayload) {
    return null
  }
  return {
    project_id: trimString(normalizedPayload.project_id),
    phase: trimString(normalizedPayload.phase) || undefined,
    blocked: Boolean(normalizedPayload.blocked),
    blocked_reason: normalizedPayload.blocked_reason ?? null,
    next_action: trimString(normalizedPayload.next_action) || undefined,
    acceptance: normalizedPayload.acceptance,
    context: normalizedPayload.context
      ? {
          bundle_id:
            trimString(normalizedPayload.context.bundle_id) || undefined,
          phase: trimString(normalizedPayload.context.phase) || undefined,
          status: trimString(normalizedPayload.context.status) || undefined,
          summary: trimString(normalizedPayload.context.summary) || undefined,
          failure_reason:
            trimString(normalizedPayload.context.failure_reason) || undefined,
          blackboard_record_count: Number(
            normalizedPayload.context.blackboard_record_count ?? 0,
          ),
          memory_hits: Number(normalizedPayload.context.memory_hits ?? 0),
          rag_sources: Array.isArray(normalizedPayload.context.rag_sources)
            ? normalizedPayload.context.rag_sources
                .map(item => trimString(item))
                .filter(Boolean)
            : [],
          selected_skills: Array.isArray(
            normalizedPayload.context.selected_skills,
          )
            ? normalizedPayload.context.selected_skills
                .map(item => trimString(item))
                .filter(Boolean)
            : [],
        }
      : undefined,
    build_report: normalizeBuildReportDisplay(normalizedPayload.build_report),
    workflow: normalizeWorkflowDisplay(normalizedPayload.workflow),
  }
}
