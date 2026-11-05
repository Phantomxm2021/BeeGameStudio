import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

// Callers supply the authorized workspace. Resolve its parent so configured
// root aliases share one identity, including cleanup after the game is removed.
function workspaceIdentity(workspace: string): string {
  const path = resolve(workspace)
  return resolve(realpathSync(dirname(path)), basename(path))
}
const key = (value: string) => createHash('sha256').update(value).digest('hex')
export function projectHostDirectory(workspace: string): string {
  const root = workspaceIdentity(workspace)
  return resolve(dirname(root), '.runtime', 'projects', key(root))
}
export function projectWorkRoot(workspace: string): string {
  const root = workspaceIdentity(workspace)
  return resolve(dirname(root), '.runtime', 'work', key(root))
}
export function projectWorkDirectory(workspace: string, sessionId: string): string {
  return resolve(projectWorkRoot(workspace), key(sessionId))
}
