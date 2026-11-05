import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export async function artifactDigest(workspace: string, path: string, allowDirectory = false): Promise<string> {
  if (isAbsolute(path) || path.replaceAll('\\', '/').split('/').includes('..'))
    throw new Error('Runtime evidence must be a workspace-relative file')
  const root = await realpath(workspace)
  const digest = async (candidate: string, ancestors: Set<string>): Promise<string> => {
    const target = await realpath(candidate)
    const rel = relative(root, target)
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
      throw new Error(`Runtime evidence resolves outside the workspace: ${path}`)
    const info = await stat(target)
    if (info.isFile()) return createHash('sha256').update(await readFile(target)).digest('hex')
    if (!info.isDirectory() || !allowDirectory)
      throw new Error(`Runtime evidence must be a regular file: ${relative(root, candidate)}`)
    if (ancestors.has(target)) throw new Error(`Runtime artifact directory contains a cycle: ${path}`)
    const parents = new Set([...ancestors, target])
    const hash = createHash('sha256').update('directory\n')
    // Sort names and include them in the hash: edits, additions, removals and
    // renames all invalidate the tested output. Walk sequentially to bound I/O.
    for (const name of (await readdir(target)).sort()) {
      hash.update(JSON.stringify([name, await digest(resolve(target, name), parents)]) + '\n')
    }
    return hash.digest('hex')
  }
  try { return await digest(resolve(root, path), new Set()) }
  catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }) }
}
