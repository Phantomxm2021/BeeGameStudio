import { existsSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
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

export type ImplementationVerificationResult = {
  verificationIndex: number
  status: 'passed' | 'deferred'
  observations: string[]
}

export async function persistImplementationEvidence(input: {
  workspacePath: string
  evidencePath: string
  taskId: string
  revision: string
  verifiedArtifacts: string[]
  verificationResults: ImplementationVerificationResult[]
}): Promise<void> {
  const target = resolveWorkflowEvidencePath(
    input.workspacePath,
    input.evidencePath,
  )
  if (!target)
    throw new Error(
      'implementation evidence path is outside the workflow evidence directory',
    )
  await mkdir(dirname(target), { recursive: true })
  await writeFile(
    target,
    `${JSON.stringify({
      version: 1,
      workerType: 'implementation-worker',
      taskId: input.taskId,
      revision: input.revision,
      verifiedArtifacts: input.verifiedArtifacts,
      verificationResults: input.verificationResults,
    })}\n`,
    'utf8',
  )
}
