import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type DocumentWorkflowStep,
} from './types'

export type DocumentDisplayTask = {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  attempt: number
}

export type DocumentDisplayTaskInput = {
  workspacePath: string
  currentItemId?: string
  documentStep?: DocumentWorkflowStep
  workflowStatus?: string
  thinking?: string
}

/**
 * Projects the canonical document set from durable workspace facts. The
 * workflow snapshot owns the active item; the filesystem owns completion.
 * This keeps the card independent from chat history and the artifacts tab.
 */
export function projectDocumentDisplayTasks(
  input: DocumentDisplayTaskInput,
): DocumentDisplayTask[] {
  const workspace = resolve(input.workspacePath)
  const currentItemId = CANONICAL_PROJECT_DOCUMENTS.includes(
    input.currentItemId as (typeof CANONICAL_PROJECT_DOCUMENTS)[number],
  )
    ? input.currentItemId
    : undefined
  const active = input.workflowStatus === 'running' && input.thinking === 'working'
  const documentPaths =
    input.documentStep === 'CHECKLIST_DRAFTING' ||
    input.documentStep === 'CHECKLIST_REVIEW'
      ? [CANONICAL_PROJECT_DOCUMENTS[CANONICAL_PROJECT_DOCUMENTS.length - 1]]
      : CANONICAL_FOUNDATION_DOCUMENTS

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
        : exists
          ? 'completed'
          : input.workflowStatus === 'failed' && currentItemId === path
            ? 'failed'
            : 'pending',
      attempt: 0,
    }
  })
}
