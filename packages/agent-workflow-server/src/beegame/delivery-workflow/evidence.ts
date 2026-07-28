import { existsSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { WORKFLOW_EVIDENCE_DIRECTORY } from './types'

export function resolveWorkflowEvidencePath(
  workspacePath: string,
  evidencePath: string,
): string | null {
  const workspaceRoot = resolve(workspacePath)
  const evidenceRoot = resolve(workspaceRoot, WORKFLOW_EVIDENCE_DIRECTORY)
  const target = isAbsolute(evidencePath)
    ? resolve(evidencePath)
    : resolve(workspaceRoot, evidencePath)
  const relativePath = relative(evidenceRoot, target)
  if (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\') ||
    isAbsolute(relativePath)
  )
    return null
  return target
}

export function isWorkflowEvidenceFile(
  workspacePath: string,
  evidencePath: string,
): boolean {
  const target = resolveWorkflowEvidencePath(workspacePath, evidencePath)
  if (!target || !existsSync(target)) return false
  try {
    return statSync(target).isFile()
  } catch {
    return false
  }
}
