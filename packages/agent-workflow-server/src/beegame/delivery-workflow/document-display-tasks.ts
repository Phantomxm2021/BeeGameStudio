import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  RESOURCE_PRODUCTION_TASKS,
  type ResourceProductionTask,
  type DocumentWorkflowStep,
} from './types'
import type { FoundationAuditState } from './foundation-audit-state'
import type { FoundationRevisionState, FoundationRevisionTask, WorkflowUsage } from './types'
import type { FoundationIssueSummary } from './foundation-audit-state'
import { isActiveFoundationRevisionState } from './display-progress'

export type DocumentDisplayTask = {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  attempt: number
  operation: 'write' | 'review' | 'revise' | 'produce'
  round?: 1 | 2 | 3
  issueSummary?: FoundationIssueSummary
  knownIssueCount?: number
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
}

export type AssetDisplayTaskInput = {
  workspacePath: string
  phase: 'RESOURCE_PREPARATION'
  workflowStatus?: string
  thinking?: string
  activeDispatch?: unknown
  resourceProductionTask: ResourceProductionTask
}

export type DocumentDisplayTaskInput = {
  workspacePath: string
  currentItemId?: string
  foundationDraftCompletedPaths?: string[]
  foundationDocuments?: Array<{
    path: string
    status: 'pending' | 'drafting' | 'committed' | 'needs_action'
  }>
  documentStep?: DocumentWorkflowStep
  workflowStatus?: string
  thinking?: string
  foundationAuditState?: FoundationAuditState
  foundationRevisionState?: FoundationRevisionState
}

const auditTaskTitles = {
  deterministic: '确定性检查',
  semantic: '语义检查',
  issues: '问题汇编',
} as const

function phaseTaskStatus(input: {
  active: boolean
  completed: boolean
  workflowStatus?: string
}): DocumentDisplayTask['status'] {
  if (input.completed) return 'completed'
  if (!input.active) return 'pending'
  if (workflowStopped(input.workflowStatus)) return 'stopped'
  if (workflowFailed(input.workflowStatus)) return 'failed'
  return 'running'
}

function projectFoundationAuditTasks(
  input: DocumentDisplayTaskInput,
): DocumentDisplayTask[] {
  const state = input.foundationAuditState
  if (!state) return []
  const factTasks = state.tasks.filter(task => task.kind === 'document-facts')
  const semanticTasks = state.tasks.filter(
    task => task.kind === 'semantic' || task.kind === 'confirmation',
  )
  const semanticCompleted =
    semanticTasks.length > 0 && semanticTasks.every(task => task.status === 'completed')
  const semanticActive = state.status === 'semantic_review'
  const issueActive = semanticActive && semanticCompleted
  const auditReady = state.status === 'audit_ready'
  const knownIssueCount = input.foundationRevisionState?.knownIssueIds?.length ?? state.review?.knownIssueIds?.length
  const factDisplayTasks = factTasks.map(task => projectFoundationAuditTask({
    task,
    title: `事实提取 · ${task.taskId}`,
    input,
    knownIssueCount,
  }))
  const semanticDisplayTasks = semanticTasks.map(task => projectFoundationAuditTask({
    task,
    title: task.kind === 'confirmation' ? `深度确认 · ${task.checkId}` : `语义检查 · ${task.checkId}`,
    input,
    knownIssueCount,
  }))
  const semanticTasksForDisplay = semanticTasks.length
    ? semanticDisplayTasks
    : [{
        id: 'audit:semantic',
        title: auditTaskTitles.semantic,
        status: phaseTaskStatus({ active: semanticActive, completed: semanticCompleted || auditReady, workflowStatus: input.workflowStatus }),
        attempt: 0,
        operation: 'review' as const,
      }]
  return [
    ...factDisplayTasks,
    {
      id: 'audit:deterministic',
      title: auditTaskTitles.deterministic,
      status: phaseTaskStatus({
        active: state.status === 'derived_committed',
        completed: [
          'deterministic_ready',
          'semantic_review',
          'audit_ready',
        ].includes(state.status),
        workflowStatus: input.workflowStatus,
      }),
      attempt: 0,
      operation: 'review',
    },
    ...semanticTasksForDisplay,
    {
      id: 'audit:issues',
      title: auditTaskTitles.issues,
      status: phaseTaskStatus({
        active: issueActive,
        completed: auditReady,
        workflowStatus: input.workflowStatus,
      }),
      attempt: 0,
      operation: 'review',
      ...(state.review?.issueSummary ? { issueSummary: state.review.issueSummary } : {}),
      ...(knownIssueCount !== undefined ? { knownIssueCount } : {}),
    },
  ]
}

function projectFoundationAuditTask(input: {
  task: Extract<FoundationAuditState['tasks'][number], { kind: 'document-facts' | 'semantic' | 'confirmation' }>
  title: string
  input: DocumentDisplayTaskInput
  knownIssueCount?: number
}): DocumentDisplayTask {
  const task = input.task
  const status = task.status === 'completed'
    ? 'completed'
    : workflowStopped(input.input.workflowStatus) && task.status === 'running'
      ? 'stopped'
      : task.status === 'needs_action'
        ? 'failed'
        : task.status === 'running'
          ? 'running'
          : 'pending'
  return {
    id: task.taskId || `${task.kind}:${task.kind === 'document-facts' ? 'facts' : task.checkId}`,
    title: input.title.replace('undefined', task.kind === 'document-facts' ? 'facts' : (task.checkId || task.kind)),
    status,
    attempt: task.attempt,
    operation: 'review',
    ...(input.knownIssueCount !== undefined ? { knownIssueCount: input.knownIssueCount } : {}),
    ...(task.usage ? { usage: task.usage } : {}),
    ...(task.durationMs !== undefined ? { durationMs: task.durationMs } : {}),
    ...(task.failureReason ? { failureReason: task.failureReason } : {}),
  }
}

function projectFoundationRevisionTasks(
  input: DocumentDisplayTaskInput,
): DocumentDisplayTask[] {
  const state = input.foundationRevisionState
  if (!state) return []
  return state.tasks.map(task => {
    const status = revisionTaskDisplayStatus(task, input.workflowStatus)
    const base = {
      id: task.kind === 'document-revision' ? `revision:${task.documentPath}` : task.taskId || `${task.kind}:${task.kind === 'semantic-recheck' ? task.issueId : 'unknown'}`,
      title: task.kind === 'document-revision'
        ? task.documentPath
        : task.kind === 'impacted-facts'
          ? '影响事实验证'
          : `定向语义验证 · ${task.issueId}`,
      status,
      attempt: task.attempt,
      operation: task.kind === 'document-revision' ? 'revise' as const : 'review' as const,
      round: task.round,
      ...(state.issueSummary ? { issueSummary: state.issueSummary } : {}),
      ...(state.knownIssueIds ? { knownIssueCount: state.knownIssueIds.length } : {}),
      ...(task.usage ? { usage: task.usage } : {}),
      ...(task.durationMs !== undefined ? { durationMs: task.durationMs } : {}),
      ...(task.failureReason ? { failureReason: task.failureReason } : {}),
    }
    return base
  })
}

function revisionTaskDisplayStatus(
  task: FoundationRevisionTask,
  workflowStatus?: string,
): DocumentDisplayTask['status'] {
  if (task.status === 'completed') return 'completed'
  if (workflowStopped(workflowStatus) && task.status === 'running') return 'stopped'
  if (task.status === 'needs_action') return 'failed'
  if (task.status === 'running') return 'running'
  return 'pending'
}

/**
 * Projects document work from its phase authority. Authoring completion comes
 * from durable files; downstream completion comes from canonical artifacts read
 * successfully by the active workflow stage. The two phases never share a
 * completion signal.
 */
export function projectDocumentDisplayTasks(
  input: DocumentDisplayTaskInput,
): DocumentDisplayTask[] {
  if (input.documentStep === 'FOUNDATION_REVIEW')
    return isActiveFoundationRevisionState(input.foundationRevisionState)
      ? projectFoundationRevisionTasks(input)
      : projectFoundationAuditTasks(input)
  const workspace = resolve(input.workspacePath)
  const canonicalReviewArtifacts = [
    ...CANONICAL_PROJECT_DOCUMENTS,
    CANONICAL_ASSET_MANIFEST,
  ] as const
  const currentItemId = canonicalReviewArtifacts.includes(
    input.currentItemId as (typeof canonicalReviewArtifacts)[number],
  )
    ? input.currentItemId
    : undefined
  const active =
    input.workflowStatus === 'running' && input.thinking === 'working'
  const operation = 'write' as const
  const documentPaths =
    input.documentStep === 'CHECKLIST_DRAFTING'
      ? [CANONICAL_PROJECT_DOCUMENTS[CANONICAL_PROJECT_DOCUMENTS.length - 1]]
      : CANONICAL_FOUNDATION_DOCUMENTS
  const committedPaths = new Set(
    input.foundationDraftCompletedPaths?.filter(path =>
      CANONICAL_FOUNDATION_DOCUMENTS.includes(path as never),
    ) ?? [],
  )
  const parallelDocuments = new Map(
    (input.foundationDocuments ?? [])
      .filter(document =>
        CANONICAL_FOUNDATION_DOCUMENTS.includes(document.path as never),
      )
      .map(document => [document.path, document.status]),
  )

  return documentPaths.map(path => {
    const parallelStatus = parallelDocuments.get(path)
    if (
      operation === 'write' &&
      input.documentStep === 'FOUNDATION_DRAFTING' &&
      parallelStatus
    )
      return {
        id: path,
        title: path,
        status:
          parallelStatus === 'committed'
            ? ('completed' as const)
            : parallelStatus === 'drafting'
              ? ('running' as const)
              : parallelStatus === 'needs_action'
                ? ('failed' as const)
                : ('pending' as const),
        attempt: 0,
        operation,
      }
    const absolutePath = join(workspace, path)
    const exists = (() => {
      try {
        if (!existsSync(absolutePath)) return false
        const stats = statSync(absolutePath)
        return stats.isFile() && stats.size > 0
      } catch {
        return false
      }
    })()
    const isSoleWriteTask = operation === 'write' && documentPaths.length === 1
    const isCurrent = active && (currentItemId === path || isSoleWriteTask)
    const isFailed =
      workflowFailed(input.workflowStatus) &&
      (currentItemId === path || isSoleWriteTask)
    const isStopped =
      workflowStopped(input.workflowStatus) &&
      (currentItemId === path || isSoleWriteTask)
    return {
      id: path,
      title: path,
      status: isCurrent
        ? 'running'
        : isStopped
          ? 'stopped'
          : isFailed
            ? 'failed'
            : input.documentStep === 'FOUNDATION_DRAFTING'
              ? committedPaths.has(path)
                ? 'completed'
                : 'pending'
              : exists
                  ? 'completed'
                  : 'pending',
      attempt: 0,
      operation,
    }
  })
}

/**
 * Projects resource work from the canonical modular manifest and content files.
 * only inventory authority: the UI does not infer work from chat text or keep
 * a second resource/task model.
 */
export function projectAssetDisplayTasks(
  input: AssetDisplayTaskInput,
): DocumentDisplayTask[] {
  const dispatch = objectValue(input.activeDispatch)
  const workerType = stringValue(dispatch?.workerType)
  const dispatchStatus = stringValue(dispatch?.status)
  const active =
    input.workflowStatus === 'running' &&
    input.thinking === 'working' &&
    dispatchStatus === 'running'

  const currentIndex = RESOURCE_PRODUCTION_TASKS.indexOf(
    input.resourceProductionTask,
  )
  const workerByTask: Record<ResourceProductionTask, string | undefined> = {
    RESOURCE_PLAN: 'resource-planner',
    RESOURCE_INVENTORY: 'resource-curator',
    RESOURCE_CONTENT: 'resource-content-author',
    RESOURCE_GATE: undefined,
  }
  const titleByTask: Record<ResourceProductionTask, string> = {
    RESOURCE_PLAN: '资源需求与生产计划',
    RESOURCE_INVENTORY: '完整资源库存',
    RESOURCE_CONTENT: 'JSON / YAML 内容描述',
    RESOURCE_GATE: '资源与内容门禁',
  }
  return RESOURCE_PRODUCTION_TASKS.map((task, index) => {
    const current = index === currentIndex
    const dispatchOwnsTask = workerByTask[task] === workerType
    return {
      id: task,
      title: titleByTask[task],
      status:
        index < currentIndex
          ? ('completed' as const)
          : !current
            ? ('pending' as const)
            : workflowStopped(input.workflowStatus)
              ? ('stopped' as const)
              : workflowFailed(input.workflowStatus)
                ? ('failed' as const)
                : task === 'RESOURCE_GATE'
                  ? input.workflowStatus === 'running'
                    ? ('running' as const)
                    : ('pending' as const)
                  : dispatchOwnsTask
                    ? dispatchTaskStatus(
                        dispatchStatus,
                        active,
                        input.workflowStatus,
                      )
                    : ('pending' as const),
      attempt: 0,
      operation: 'produce' as const,
    }
  })
}

function dispatchTaskStatus(
  dispatchStatus: string | undefined,
  active: boolean,
  workflowStatus?: string,
): DocumentDisplayTask['status'] {
  if (active) return 'running'
  if (workflowStopped(workflowStatus) && dispatchStatus === 'interrupted')
    return 'stopped'
  if (
    dispatchStatus === 'failed' ||
    dispatchStatus === 'blocked' ||
    dispatchStatus === 'invalid'
  )
    return 'failed'
  if (dispatchStatus === 'completed') return 'completed'
  return 'pending'
}

function workflowFailed(status: string | undefined): boolean {
  return (
    status === 'failed' || status === 'blocked' || status === 'needs_action'
  )
}

function workflowStopped(status: string | undefined): boolean {
  return status === 'stopped'
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
