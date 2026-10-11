import { isAbsolute, resolve } from 'node:path'

/** Enforce revision file scope before global permission rules can auto-allow. */
export function foundationRevisionPathGuard(
  filePath: string,
  toolName: 'Read' | 'Edit',
):
  | {
      result: false
      behavior: 'deny'
      message: string
      errorCode: number
    }
  | undefined {
  if (process.env.BEEGAME_WORKFLOW_WORKER_TYPE !== 'foundation-document-reviser')
    return undefined
  const stagedPath = process.env.BEEGAME_REVISION_STAGED_PATH
  if (!stagedPath || !isAbsolute(stagedPath))
    return {
      result: false,
      behavior: 'deny',
      message: `${toolName} is unavailable: the revision staged path authority is missing.`,
      errorCode: 90,
    }
  if (!isAbsolute(filePath) || resolve(filePath) !== resolve(stagedPath))
    return {
      result: false,
      behavior: 'deny',
      message: `${toolName} may access only the assigned absolute staged path.`,
      errorCode: 91,
    }
  return undefined
}
