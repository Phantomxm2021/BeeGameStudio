import { lstatSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/** The caller owns the root; project-controlled descendants must not redirect
 * host reads or writes through a link, including an ancestor of a new file. */
export function assertWorkspacePath(root: string, target: string): void {
  const path = relative(root, target)
  if (isAbsolute(path) || path === '..' || path.startsWith('..' + sep))
    throw new Error(`Path escapes workspace: ${target}`)
  let current = root
  const parts = path ? path.split(sep) : []
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    let info
    try { info = lstatSync(current) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (info.isSymbolicLink()) throw new Error(`Workspace path must not traverse a symbolic link: ${current}`)
    if (index < parts.length - 1 && !info.isDirectory())
      throw new Error(`Workspace path parent must be a directory: ${current}`)
  }
}
