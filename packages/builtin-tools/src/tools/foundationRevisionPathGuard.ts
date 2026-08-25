import { lstatSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export function foundationRevisionPathGuard(
  filePath: string,
  toolName: 'Read' | 'Edit',
): { result: false; behavior: 'deny'; message: string; errorCode: number } | undefined {
  if (process.env.BEEGAME_WORKFLOW_WORKER_TYPE !== 'foundation-document-reviser') return undefined
  const stagedPath = process.env.BEEGAME_REVISION_STAGED_PATH
  if (!stagedPath || !isAbsolute(stagedPath)) return { result: false, behavior: 'deny', message: `${toolName} is unavailable: the revision staged path authority is missing.`, errorCode: 90 }
  const workspacePath = process.env.BEEGAME_WORKSPACE_PATH
  if (!workspacePath || !isAbsolute(workspacePath)) return { result: false, behavior: 'deny', message: `${toolName} is unavailable: the revision workspace authority is missing.`, errorCode: 90 }
  if (!isAbsolute(filePath) || resolve(filePath) !== resolve(stagedPath)) return { result: false, behavior: 'deny', message: `${toolName} may access only the assigned absolute staged path.`, errorCode: 91 }
  try {
    const workspaceRoot = resolve(workspacePath)
    const workspaceRelative = relative(workspaceRoot, resolve(stagedPath))
    if (!workspaceRelative || workspaceRelative === '..' || workspaceRelative.startsWith(`..${sep}`) || isAbsolute(workspaceRelative))
      throw new Error('staged path escapes workspace')
    let parent = workspaceRoot
    for (const part of workspaceRelative.split(sep).slice(0, -1)) {
      parent = join(parent, part)
      if (lstatSync(parent).isSymbolicLink()) throw new Error('staged path parent is a symbolic link')
    }
    const stat = lstatSync(stagedPath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file')
  } catch { return { result: false, behavior: 'deny', message: `${toolName} may access only the existing regular staged file.`, errorCode: 92 } }
  return undefined
}
