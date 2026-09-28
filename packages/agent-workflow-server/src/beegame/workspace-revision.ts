import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const EXCLUDED_PREFIXES = [
  '.git/', '.cache/', '.vite/', '.beegame/workflow/', '.beegame/delivery/',
  '.beegame/logs/', '.beegame/chat/', '.beegame/tmp/', '.beegame-attachments/',
  'logs/', 'node_modules/', 'dist/', 'build/', 'out/', '.next/', 'coverage/',
  'transcripts/',
] as const

async function collectFiles(root: string, directory: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    const path = relative(root, absolute).split(sep).join('/')
    if (EXCLUDED_PREFIXES.some(prefix => path === prefix.slice(0, -1) || path.startsWith(prefix))) continue
    if (entry.isDirectory()) await collectFiles(root, absolute, files)
    else if (entry.isFile()) files.push(path)
  }
}

/** Identity of authored project files, excluding generated output and host metadata. */
export async function computeWorkspaceRevision(workspacePath: string): Promise<string> {
  const root = resolve(workspacePath)
  const files: string[] = []
  try { await collectFiles(root, root, files) }
  catch { /* A new workspace may not exist yet. */ }
  const hash = createHash('sha256')
  for (const path of files.sort()) {
    hash.update(path).update('\0')
    try { hash.update(await readFile(join(root, path))) }
    catch { hash.update('<missing>') }
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** Resolve a project artifact without allowing traversal outside its workspace. */
export function resolveWorkspaceRelativePath(workspacePath: string, path: string): string | undefined {
  if (!path.trim()) return undefined
  const root = resolve(workspacePath)
  const candidate = resolve(root, path)
  const relativePath = relative(root, candidate)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) return undefined
  return candidate
}
