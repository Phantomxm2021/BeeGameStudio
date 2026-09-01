import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

/** Read a workspace-relative regular file while refusing symlink components. */
export async function readSecureWorkspaceFile(
  workspacePath: string,
  relativePath: string,
): Promise<string> {
  const root = resolve(workspacePath)
  if (
    !relativePath ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    relativePath.split('/').some(part => !part || part === '.' || part === '..')
  ) throw new Error('secure file path is not a safe relative path')
  const target = resolve(root, relativePath)
  const rel = relative(root, target)
  if (rel.startsWith('..') || rel.includes(`${sep}..${sep}`))
    throw new Error('secure file path escapes workspace')
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    throw new Error('secure file workspace is not a directory')
  let parent = root
  for (const component of relative(root, dirname(target)).split(sep).filter(Boolean)) {
    parent = resolve(parent, component)
    const info = await lstat(parent)
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error('secure file path contains a non-directory component')
  }
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('secure file target is not a regular file')
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}
