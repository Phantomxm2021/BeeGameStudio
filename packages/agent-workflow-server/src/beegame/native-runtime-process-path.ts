import { accessSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

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
