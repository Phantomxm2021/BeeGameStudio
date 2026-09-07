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
import type { WorkflowUsage } from './types'

export type DocumentDisplayTask = {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  attempt: number
  operation: 'write' | 'review' | 'revise' | 'produce'
  round?: number
  issueSummary?: { total: number; blocker: number; high: number; medium: number; low: number }
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
  // Public Reviewer/Revision links are projected by the public stage-card path.
  // No legacy task list is reconstructed from old project checkpoints.
  if (input.documentStep === 'FOUNDATION_REVISION' || input.documentStep === 'FOUNDATION_REVIEW')
    return []
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
