import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type DocumentWorkflowStep,
} from './types'

export type DocumentDisplayTask = {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  attempt: number
  operation: 'write' | 'review'
}

export type DocumentDisplayTaskInput = {
  workspacePath: string
  currentItemId?: string
  reviewedDocumentPaths?: string[]
  documentStep?: DocumentWorkflowStep
  workflowStatus?: string
  thinking?: string
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
  const active = input.workflowStatus === 'running' && input.thinking === 'working'
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
    const isCurrent = active && currentItemId === path
    return {
      id: path,
      title: path,
      status: isCurrent
        ? 'running'
        : operation === 'review'
          ? reviewedPaths.has(path)
            ? 'completed'
            : input.workflowStatus === 'failed' && currentItemId === path
              ? 'failed'
              : 'pending'
          : exists
            ? 'completed'
            : input.workflowStatus === 'failed' && currentItemId === path
              ? 'failed'
              : 'pending',
      attempt: 0,
      operation,
    }
  })
}
