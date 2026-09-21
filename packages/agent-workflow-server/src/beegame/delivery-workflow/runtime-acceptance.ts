import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod/v4'

// A result record, not a test plan: the Agent chooses its own checks/tools.
const reportSchema = z.object({
  status: z.enum(['passed', 'failed', 'blocked']),
  summary: z.string().trim().min(1),
  environment: z.string().trim().min(1),
  evidencePaths: z.array(z.string().trim().min(1)),
})
export type RuntimeAcceptance = {
  status: 'passed' | 'failed' | 'blocked'
  summary: string
  environment: string
  evidence: Array<{ path: string; sha256: string }>
}

export function runtimeAcceptancePath(dispatchId: string): string {
  if (!/^[\w-]+$/.test(dispatchId)) throw new Error('Invalid acceptance dispatch ID')
  return `.beegame/workflow/evidence/runtime-${dispatchId}.json`
}

async function artifactDigest(workspace: string, path: string): Promise<string> {
  if (isAbsolute(path) || path.replaceAll('\\', '/').split('/').includes('..'))
    throw new Error('Runtime evidence must be a workspace-relative file')
  const root = await realpath(workspace)
  const target = await realpath(resolve(root, path))
  const rel = relative(root, target)
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('Runtime evidence resolves outside the workspace')
  return createHash('sha256').update(await readFile(target)).digest('hex')
}

export async function readRuntimeAcceptance(workspace: string, dispatchId: string): Promise<RuntimeAcceptance | undefined> {
  let text: string
  try {
    const path = runtimeAcceptancePath(dispatchId)
    await artifactDigest(workspace, path) // Reject symlink escapes before reading the report.
    text = await readFile(resolve(workspace, path), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return blocked(error)
  }
  try {
    const report = reportSchema.parse(JSON.parse(text))
    if (report.status === 'passed' && !report.evidencePaths.length)
      throw new Error('Passed runtime acceptance requires saved evidence')
    const evidence = await Promise.all([...new Set(report.evidencePaths)].map(async path => {
      if (path === runtimeAcceptancePath(dispatchId)) throw new Error('The acceptance report cannot be its own evidence')
      return { path, sha256: await artifactDigest(workspace, path) }
    }))
    return { status: report.status, summary: report.summary, environment: report.environment, evidence }
  } catch (error) { return blocked(error) }
}

function blocked(error: unknown): RuntimeAcceptance {
  return { status: 'blocked', summary: `Invalid runtime acceptance record: ${error instanceof Error ? error.message : String(error)}`,
    environment: 'not-established', evidence: [] }
}

export async function runtimeEvidenceIsCurrent(workspace: string, reports: RuntimeAcceptance[]): Promise<boolean> {
  if (!reports.length) return false
  try {
    for (const report of reports) {
      if (report.status !== 'passed' || !report.summary?.trim() || !report.environment?.trim() || !report.evidence?.length) return false
      for (const artifact of report.evidence)
        if (await artifactDigest(workspace, artifact.path) !== artifact.sha256) return false
    }
    return true
  } catch { return false }
}
