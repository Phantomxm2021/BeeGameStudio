import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'

/** Tool effects go to a private candidate workspace, never the live project or
 * the author's publication journal. The final Markdown remains the deliverable. */
export async function createAuthorToolWorkspace(input: {
  privateRootPath: string; projectPath: string; requirements: string
}): Promise<string> {
  const parent = await realpath(input.privateRootPath)
  if (parent !== resolve(input.privateRootPath)) throw new Error('Author tool workspace parent is not canonical')
  const root = await mkdtemp(join(parent, 'native-tools-'))
  await mkdir(join(root, 'docs'), { mode: 0o700 })
  const project = await realpath(input.projectPath)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const source = join(project, path)
    try {
      const info = await lstat(source)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 2 * 1024 * 1024 ||
          await realpath(source) !== source) throw new Error('Author tool input is not a bounded regular file')
      await writeFile(join(root, path), await readFile(source), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await writeFile(join(root, 'requirements.md'), input.requirements, { flag: 'wx', mode: 0o400 })
  return root
}
