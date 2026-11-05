import { resolve, relative, isAbsolute } from 'node:path'
import { projectWorkDirectory } from './project-storage-paths'

export function nativeSessionTemporaryPath(cwd: string, sessionId: string): string {
  return resolve(projectWorkDirectory(cwd, sessionId), 'tmp')
}

/** Native command/delegate output must not be a descendant of the searched
 * game tree: recursive grep can otherwise read its own growing output. Stable
 * per project+Chat for continuation; no global temp directory permission. */
export function nativeSessionOutputPath(cwd: string, sessionId: string): string {
  const path = resolve(projectWorkDirectory(cwd, sessionId), 'output')
  const part = relative(resolve(cwd), path)
  if (!isAbsolute(part) && part !== '..' && !part.startsWith('../'))
    throw Error('Native output temporary root must be outside the game workspace')
  return path
}

export { bgsCommand as resolveNativeRuntimeCommand } from '../bgs/client'
