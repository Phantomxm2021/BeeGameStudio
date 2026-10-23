import { resolve, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

export function nativeSessionTemporaryPath(cwd: string, sessionId: string): string {
  return resolve(cwd, '.beegame', 'tmp', createHash('sha256').update(sessionId).digest('hex').slice(0, 24))
}

/** Native command/delegate output must not be a descendant of the searched
 * game tree: recursive grep can otherwise read its own growing output. Stable
 * per project+Chat for continuation; no global temp directory permission. */
export function nativeSessionOutputPath(cwd: string, sessionId: string, temporaryRoot = tmpdir()): string {
  const path = resolve(temporaryRoot, 'bgs-native-output-' + createHash('sha256').update(resolve(cwd)).update('\0')
    .update(sessionId).digest('hex').slice(0, 32))
  const part = relative(resolve(cwd), path)
  if (!isAbsolute(part) && part !== '..' && !part.startsWith('../'))
    throw Error('Native output temporary root must be outside the game workspace')
  return path
}

export { bgsCommand as resolveNativeRuntimeCommand } from '../bgs/client'
