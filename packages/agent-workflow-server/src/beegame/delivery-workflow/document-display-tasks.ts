import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { auditAssetContract } from '../asset-contract-audit'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  DOCUMENT_REVIEW_CHECK_PACKETS,
  type DocumentWorkflowStep,
  type DocumentReviewCheckId,
} from './types'

export type DocumentDisplayTask = {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  attempt: number
  operation: 'write' | 'review' | 'produce'
}

export type ReviewFindingDisplayItem = {
  id: string
  title: string
  owner: 'foundation' | 'checklist' | 'resource'
}

export function projectReviewFindingDisplayItems(
  value: unknown,
  owner?: ReviewFindingDisplayItem['owner'],
): ReviewFindingDisplayItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(finding => {
    const record = objectValue(finding)
    const findingOwner = record?.owner
    if (
      typeof record?.findingId !== 'string' ||
      typeof record.requiredOutcome !== 'string' ||
      (findingOwner !== 'foundation' &&
        findingOwner !== 'checklist' &&
        findingOwner !== 'resource') ||
      (owner && findingOwner !== owner)
    )
      return []
    return [
      {
        id: record.findingId,
        title: record.requiredOutcome,
        owner: findingOwner,
      },
    ]
  })
}

export type AssetDisplayTaskInput = {
  workspacePath: string
  phase: 'RESOURCE_PREPARATION'
  workflowStatus?: string
  thinking?: string
  activeDispatch?: unknown
  reviewTarget?: 'foundation' | 'checklist' | 'resource'
  reviewFindings?: Array<{
    id: string
    title: string
    owner: 'foundation' | 'checklist' | 'resource'
  }>
}

export type DocumentDisplayTaskInput = {
  workspacePath: string
  currentItemId?: string
  foundationDraftCompletedPaths?: string[]
  reviewedDocumentPaths?: string[]
  documentStep?: DocumentWorkflowStep
  workflowStatus?: string
  thinking?: string
  reviewCheckIds?: DocumentReviewCheckId[]
  reviewCompletedCheckIds?: DocumentReviewCheckId[]
  reviewPacketSetComplete?: boolean
  reviewTarget?: 'foundation' | 'checklist' | 'resource'
  repairPlan?: {
    groups: Array<{ affectedPaths: string[] }>
    completedPaths: string[]
  }
  reviewFindings?: Array<{
    id: string
    title: string
    owner: 'foundation' | 'checklist' | 'resource'
  }>
}

/**
 * Projects document work from its phase authority. Authoring completion comes
 * from durable files; review completion comes from canonical artifacts read
 * successfully by the active reviewer dispatch. The two phases never share a
 * completion signal.
 */
export function projectDocumentDisplayTasks(
  input: DocumentDisplayTaskInput,
): DocumentDisplayTask[] {
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
  const operation =
    input.documentStep === 'FOUNDATION_REVIEW' ||
    input.documentStep === 'CHECKLIST_REVIEW'
      ? 'review'
      : 'write'
  const documentPaths =
    input.documentStep === 'CHECKLIST_DRAFTING'
      ? [CANONICAL_PROJECT_DOCUMENTS[CANONICAL_PROJECT_DOCUMENTS.length - 1]]
      : input.documentStep === 'CHECKLIST_REVIEW'
        ? canonicalReviewArtifacts
        : CANONICAL_FOUNDATION_DOCUMENTS
  const reviewedPaths = new Set(
    input.reviewedDocumentPaths?.filter(path =>
      canonicalReviewArtifacts.includes(
        path as (typeof canonicalReviewArtifacts)[number],
      ),
    ) ?? [],
  )
  const draftedPaths = new Set(
    input.foundationDraftCompletedPaths?.filter(path =>
      CANONICAL_FOUNDATION_DOCUMENTS.includes(path as never),
    ) ?? [],
  )

  if (operation === 'review' && input.reviewCheckIds?.length) {
    const completed = new Set(input.reviewCompletedCheckIds ?? [])
    const firstIncompleteCheckId = input.reviewCheckIds.find(
      id => !completed.has(id),
    )
    const activeCheckIds = new Set(
      (
        DOCUMENT_REVIEW_CHECK_PACKETS.find(packet =>
          firstIncompleteCheckId
            ? packet.includes(firstIncompleteCheckId)
            : false,
        ) ?? []
      ).filter(
        checkId =>
          input.reviewCheckIds!.includes(checkId) && !completed.has(checkId),
      ),
    )
    return input.reviewCheckIds.map(id => ({
      id,
      title: id,
      status:
        input.reviewPacketSetComplete || completed.has(id)
          ? 'completed'
          : activeCheckIds.has(id) && active
            ? 'running'
            : activeCheckIds.has(id) && workflowStopped(input.workflowStatus)
              ? 'stopped'
              : activeCheckIds.has(id) && input.workflowStatus === 'failed'
                ? 'failed'
                : 'pending',
      attempt: 0,
      operation: 'review',
    }))
  }

  if (operation === 'write' && input.reviewPacketSetComplete) {
    if (input.reviewTarget === 'foundation') {
      if (!input.repairPlan)
        return [
          {
            id: 'foundation-repair-plan',
            title: '制定文档修订方案',
            status: active
              ? 'running'
              : workflowStopped(input.workflowStatus)
                ? 'stopped'
                : workflowFailed(input.workflowStatus)
                  ? 'failed'
                  : 'pending',
            attempt: 0,
            operation: 'review',
          },
        ]
      const completed = new Set(input.repairPlan.completedPaths)
      const paths = CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
        input.repairPlan!.groups.some(group =>
          group.affectedPaths.includes(path),
        ),
      )
      return paths.map(path => ({
        id: path,
        title: path,
        status: completed.has(path)
          ? 'completed'
          : active && currentItemId === path
            ? 'running'
            : workflowStopped(input.workflowStatus) && currentItemId === path
              ? 'stopped'
              : workflowFailed(input.workflowStatus) && currentItemId === path
                ? 'failed'
                : 'pending',
        attempt: 0,
        operation: 'write',
      }))
    }
    const currentOwnerFindings = input.reviewTarget
      ? (input.reviewFindings ?? []).filter(
          finding => finding.owner === input.reviewTarget,
        )
      : (input.reviewFindings ?? [])
    if (currentOwnerFindings.length)
      return currentOwnerFindings.map(finding => ({
        id: finding.id,
        title: finding.title,
        status: active
          ? 'running'
          : workflowStopped(input.workflowStatus)
            ? 'stopped'
            : workflowFailed(input.workflowStatus)
              ? 'failed'
              : 'pending',
        attempt: 0,
        operation: 'write',
      }))
  }

  return documentPaths.map(path => {
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
          : operation === 'review'
            ? reviewedPaths.has(path)
              ? 'completed'
              : isFailed
                ? 'failed'
                : 'pending'
            : isFailed
              ? 'failed'
              : input.documentStep === 'FOUNDATION_DRAFTING'
                ? draftedPaths.has(path)
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
 * Projects resource work from the canonical v7 manifest and content files.
 * only inventory authority: the UI does not infer work from chat text or keep
 * a second resource/task model.
 */
export function projectAssetDisplayTasks(
  input: AssetDisplayTaskInput,
): DocumentDisplayTask[] {
  const audit = auditAssetContract(input.workspacePath)
  const dispatch = objectValue(input.activeDispatch)
  const request = objectValue(dispatch?.request)
  const workerType = stringValue(dispatch?.workerType)
  const dispatchStatus = stringValue(dispatch?.status)
  const active =
    input.workflowStatus === 'running' &&
    input.thinking === 'working' &&
    dispatchStatus === 'running'

  const currentResourceFindings =
    input.reviewTarget === 'resource'
      ? (input.reviewFindings ?? []).filter(
          finding => finding.owner === 'resource',
        )
      : []
  if (currentResourceFindings.length)
    return currentResourceFindings.map(finding => ({
      id: finding.id,
      title: finding.title,
      status: active
        ? 'running'
        : workflowStopped(input.workflowStatus)
          ? 'stopped'
          : workflowFailed(input.workflowStatus)
            ? 'failed'
            : 'pending',
      attempt: 0,
      operation: 'produce',
    }))

  {
    const planningStatus =
      audit.present && audit.valid
        ? 'completed'
        : workerType === 'resource-preparer'
          ? dispatchTaskStatus(dispatchStatus, active, input.workflowStatus)
          : 'pending'
    const inventoryStatus =
      workerType === 'resource-preparer' && audit.present && audit.valid
        ? dispatchTaskStatus(dispatchStatus, active, input.workflowStatus)
        : audit.resources.length > 0 &&
            audit.resources.every(resource => resource.status === 'verified')
          ? 'completed'
          : 'pending'
    const tasks: DocumentDisplayTask[] = [
      {
        id: 'resource-plan',
        title: '资源需求与生产计划',
        status: planningStatus,
        attempt: 0,
        operation: 'produce',
      },
      {
        id: 'resource-inventory',
        title: '完整资源库存',
        status: inventoryStatus,
        attempt: 0,
        operation: 'produce',
      },
      {
        id: 'content-descriptions',
        title: 'JSON / YAML 内容描述',
        status: audit.content.valid
          ? 'completed'
          : active
            ? 'running'
            : 'pending',
        attempt: 0,
        operation: 'produce',
      },
    ]
    return [
      ...tasks,
      ...audit.resources.map(resource => ({
        id: resource.id,
        title: resource.id,
        status:
          resource.status === 'verified'
            ? ('completed' as const)
            : resource.status === 'failed'
              ? ('failed' as const)
              : active
                ? ('running' as const)
                : ('pending' as const),
        attempt: 0,
        operation: 'produce' as const,
      })),
      ...audit.content.files.map(file => ({
        id: file.id,
        title: file.id,
        status: 'completed' as const,
        attempt: 0,
        operation: 'produce' as const,
      })),
    ]
  }
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
