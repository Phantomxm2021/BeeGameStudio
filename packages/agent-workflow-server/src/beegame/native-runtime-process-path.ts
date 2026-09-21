import { accessSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

export function nativeSessionTemporaryPath(cwd: string, sessionId: string): string {
  return resolve(cwd, '.beegame', 'tmp', createHash('sha256').update(sessionId).digest('hex').slice(0, 24))
}

export function resolveNativeRuntimeCommand(input?: {
  executablePath?: string
}): string[] {
  if (input?.executablePath) {
    const path = resolve(input.executablePath)
    accessSync(path)
    return [process.execPath, path]
  }
  const workspaceRoot = fileURLToPath(
    new URL('../../../../', import.meta.url),
  )
  const executable = resolve(workspaceRoot, 'dist', 'cli-bun.js')
  accessSync(executable)
  return [process.execPath, executable]
}
