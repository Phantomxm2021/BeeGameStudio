import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

/** Read a workspace-relative regular file while refusing symlink components. */
export async function readSecureWorkspaceFile(
  workspacePath: string,
  relativePath: string,
): Promise<string> {
  const root = await realpath(resolve(workspacePath))
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
  // Canonical containment rejects symlink aliases even if every lexical
  // component looked safe.  Recheck the canonical target before opening it;
  // the descriptor and parent identity checks below close the swap window
  // between this check and open().
  let canonicalTarget: string
  try {
    canonicalTarget = await realpath(target)
  } catch {
    throw new Error('secure file target does not exist')
  }
  const canonicalRelative = relative(root, canonicalTarget)
  if (canonicalRelative.startsWith('..') || canonicalRelative.includes(`${sep}..${sep}`) || canonicalRelative !== relativePath)
    throw new Error('secure file target is a symlink or not the canonical workspace file')

  let parent = root
  for (const component of relative(root, dirname(target)).split(sep).filter(Boolean)) {
    parent = resolve(parent, component)
    const info = await lstat(parent)
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error('secure file path contains a non-directory component')
  }
  const parentBeforeOpen = await lstat(parent)
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('secure file target is not a regular file')
    const parentAfterOpen = await lstat(parent)
    if (
      !parentAfterOpen.isDirectory() ||
      parentAfterOpen.dev !== parentBeforeOpen.dev ||
      parentAfterOpen.ino !== parentBeforeOpen.ino
    )
      throw new Error('secure file parent changed during open')
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}
