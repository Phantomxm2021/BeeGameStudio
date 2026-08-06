import type {
  BuildReportPayload,
  ContextVisibilityPayload,
  PendingToolPermissionItem,
  ProjectBaselineStatusPayload,
} from '../services/api'
import type {
  Message,
  WorkflowCardPayload,
  WorkflowCardStageSnapshot,
  WorkflowCardStatus,
  WorkflowCardSubstage,
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

const WORKFLOW_SUBSTAGES: readonly WorkflowCardSubstage[] = [
  'INITIAL_DRAFTING',
  'INITIAL_REVIEW',
  'REPAIR_PLANNING',
  'REPAIRING',
  'CLOSURE_REVIEW',
  'CHECKLIST_DRAFTING',
  'CHECKLIST_REVIEW',
]

const WORKFLOW_TASK_STATUSES: readonly WorkflowCardTask['status'][] = [
  'pending',
  'running',
  'completed',
  'failed',
  'blocked',
  'stopped',
]

const WORKFLOW_TASK_OPERATIONS: readonly NonNullable<
  WorkflowCardTask['operation']
>[] = ['write', 'review', 'produce', 'assemble']

const WORKFLOW_EXECUTION_STATUSES = ['working', 'waiting', 'idle'] as const

type WorkflowCardFieldProjection = Omit<
  WorkflowCardStageSnapshot,
  'stageId' | 'phaseIndex'
> & {
  phaseIndex?: number
}

const finiteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const normalizeWorkflowTasks = (
  value: unknown,
): WorkflowCardTask[] | undefined => {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((task): WorkflowCardTask[] => {
    if (!task || typeof task !== 'object') return []
    const item = task as Record<string, unknown>
    const id = trimString(item.id)
    const title = trimString(item.title)
    const taskStatus = trimString(item.status).toLowerCase()
    if (
      !id ||
      !title ||
      !WORKFLOW_TASK_STATUSES.includes(taskStatus as WorkflowCardTask['status'])
    ) {
      return []
    }
    const operation = trimString(item.operation).toLowerCase()
    return [
      {
        id,
        title,
        status: taskStatus as WorkflowCardTask['status'],
        operation: WORKFLOW_TASK_OPERATIONS.includes(
          operation as NonNullable<WorkflowCardTask['operation']>,
        )
          ? (operation as NonNullable<WorkflowCardTask['operation']>)
          : undefined,
        attempt: finiteNumber(item.attempt),
        failureReason:
          trimString(item.failureReason ?? item.failure_reason) || undefined,
      },
    ]
  })
}

const normalizeWorkflowBlock = (
  value: unknown,
): WorkflowCardStageSnapshot['block'] | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const block = value as Record<string, unknown>
  const message =
    typeof block.message === 'string' ? block.message.trim() : undefined
  if (!message) return undefined
  const nextAction =
    typeof (block.nextAction ?? block.next_action) === 'string'
      ? String(block.nextAction ?? block.next_action).trim() || undefined
      : undefined
  return {
    message,
    nextAction,
  }
}

const normalizeWorkflowCardFields = (
  source: Record<string, unknown>,
): WorkflowCardFieldProjection | undefined => {
  const status = WORKFLOW_STATUS[trimString(source.status).toLowerCase()]
  if (!status) return undefined
  const activeDispatch =
    source.activeDispatch &&
    typeof source.activeDispatch === 'object' &&
    !Array.isArray(source.activeDispatch)
      ? (source.activeDispatch as Record<string, unknown>)
      : undefined
  const rawThinking = trimString(source.thinking)
  const message = normalizeWorkflowMessage(source.message)
  const phaseIndex = finiteNumber(source.phaseIndex ?? source.phase_index)
  const phaseCount = finiteNumber(source.phaseCount ?? source.phase_count)
  const convergencePassValue = finiteNumber(
    source.convergencePass ?? source.convergence_pass,
  )
  const convergencePass =
    convergencePassValue !== undefined &&
    Number.isInteger(convergencePassValue) &&
    convergencePassValue > 0
      ? convergencePassValue
      : undefined
  const substage = trimString(source.substage)
  const reviewMode = trimString(source.reviewMode ?? source.review_mode)
  const reviewTarget = trimString(source.reviewTarget ?? source.review_target)
  const executionStatus = WORKFLOW_EXECUTION_STATUSES.includes(
    rawThinking as (typeof WORKFLOW_EXECUTION_STATUSES)[number],
  )
    ? rawThinking
    : trimString(
        source.executionStatus ??
          source.execution_status ??
          activeDispatch?.status,
      ) || undefined

  return {
    status,
    currentPhase:
      trimString(source.currentPhase ?? source.current_phase ?? source.phase) ||
      undefined,
    phaseIndex,
    phaseCount,
    substage: WORKFLOW_SUBSTAGES.includes(substage as WorkflowCardSubstage)
      ? (substage as WorkflowCardSubstage)
      : undefined,
    convergencePass,
    documentStep:
      trimString(source.documentStep ?? source.document_step) || undefined,
    reviewMode:
      reviewMode === 'initial' || reviewMode === 'closure'
        ? reviewMode
        : undefined,
    reviewTarget:
      reviewTarget === 'foundation' ||
      reviewTarget === 'checklist' ||
      reviewTarget === 'resource'
        ? reviewTarget
        : undefined,
    worker:
      trimString(
        source.worker ??
          activeDispatch?.workerType ??
          activeDispatch?.worker_type,
      ) || undefined,
    thinking:
      message ||
      (rawThinking &&
      !WORKFLOW_EXECUTION_STATUSES.includes(
        rawThinking as (typeof WORKFLOW_EXECUTION_STATUSES)[number],
      )
        ? rawThinking
        : undefined),
    executionStatus,
    currentItemId:
      trimString(
        source.currentItemId ??
          source.current_item_id ??
          source.activeTaskId ??
          source.active_task_id,
      ) || undefined,
    tasks: normalizeWorkflowTasks(source.tasks),
    completedTaskCount: finiteNumber(
      source.completedTaskCount ?? source.completed_task_count,
    ),
    totalTaskCount: finiteNumber(
      source.totalTaskCount ?? source.total_task_count,
    ),
    createdAt: trimString(source.createdAt ?? source.created_at) || undefined,
    completedAt:
      trimString(source.completedAt ?? source.completed_at) || undefined,
    updatedAt: trimString(source.updatedAt ?? source.updated_at) || undefined,
    stageStartedAt:
      trimString(
        source.stageStartedAt ??
          source.stage_started_at ??
          activeDispatch?.startedAt ??
          activeDispatch?.started_at,
      ) || undefined,
    elapsedMs:
      finiteNumber(source.elapsedMs ?? source.elapsed_ms) !== undefined
        ? Math.max(
            0,
            finiteNumber(source.elapsedMs ?? source.elapsed_ms) as number,
          )
        : undefined,
    activeSince:
      trimString(source.activeSince ?? source.active_since) || undefined,
    block: normalizeWorkflowBlock(source.block),
  }
}

const normalizeWorkflowStageSnapshot = (
  value: unknown,
): WorkflowCardStageSnapshot | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const source = value as Record<string, unknown>
  const rawStageId = source.stageId ?? source.stage_id
  const stageId = typeof rawStageId === 'string' ? rawStageId.trim() : ''
  const fields = normalizeWorkflowCardFields(source)
  const phaseIndex = fields?.phaseIndex
  if (
    !stageId ||
    !fields ||
    phaseIndex === undefined ||
    !Number.isInteger(phaseIndex) ||
    phaseIndex <= 0
  ) {
    return undefined
  }
  return { ...fields, stageId, phaseIndex }
}

/** Convert backend workflow data into the only shape the UI may render. */
const normalizeWorkflowDisplay = (
  payload: unknown,
): WorkflowCardPayload | undefined => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }
  const source = payload as Record<string, unknown>
  const runId = trimString(source.runId ?? source.run_id)
  const fields = normalizeWorkflowCardFields(source)
  if (!runId || !fields) return undefined

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
  const rawStageSnapshots = source.stageSnapshots ?? source.stage_snapshots
  const stageSnapshots = Array.isArray(rawStageSnapshots)
    ? rawStageSnapshots.flatMap(value => {
        const snapshot = normalizeWorkflowStageSnapshot(value)
        return snapshot ? [snapshot] : []
      })
    : undefined

  return {
    runId,
    ...fields,
    nextAction:
      nextActionValue === 'resume' || nextActionValue === 'retry'
        ? nextActionValue
        : undefined,
    recoverable,
    lastProvenPhase:
      recoverable &&
      trimString(source.lastProvenPhase ?? source.last_proven_phase)
        ? trimString(source.lastProvenPhase ?? source.last_proven_phase)
        : undefined,
    lastProvenUnitId:
      recoverable &&
      trimString(source.lastProvenUnitId ?? source.last_proven_unit_id)
        ? trimString(source.lastProvenUnitId ?? source.last_proven_unit_id)
        : undefined,
    lastProvenUnitKind:
      recoverable &&
      WORKFLOW_RECOVERY_UNIT_KINDS.includes(
        recoveryUnitKind as WorkflowRecoveryUnitKind,
      )
        ? (recoveryUnitKind as WorkflowRecoveryUnitKind)
        : undefined,
    lastProvenItemId:
      recoverable &&
      trimString(source.lastProvenItemId ?? source.last_proven_item_id)
        ? trimString(source.lastProvenItemId ?? source.last_proven_item_id)
        : undefined,
    block:
      fields.block || failureReason
        ? (fields.block ?? { message: failureReason })
        : undefined,
    usage:
      source.usage && typeof source.usage === 'object'
        ? (source.usage as WorkflowCardPayload['usage'])
        : undefined,
    ...(stageSnapshots ? { stageSnapshots } : {}),
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
