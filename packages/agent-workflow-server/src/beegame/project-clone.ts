import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { dirname, join, relative, isAbsolute } from 'node:path'
import { WorkflowError } from './workflow-v3/state'

// Copy authored files, not execution identity, credentials or installed caches.
const excluded = new Set(['.git', '.runtime', '.beegame', '.bgs', '.codex', '.claude',
  '.agents', 'transcripts', 'diagnostics', 'logs', 'node_modules', '.cache', '.next',
  '.vite', '.venv', '__pycache__', '.godot', '.DS_Store', '.npmrc', '.pypirc',
  '.aws', '.ssh', '.netrc', '.git-credentials'])
function omit(name: string): boolean {
  return excluded.has(name) || name === '.env' || name.startsWith('.env.') &&
    !['.env.example', '.env.sample', '.env.template'].includes(name) || /\.(pem|key|p12|pfx)$/i.test(name)
}
type Entry = { path: string; directory: boolean; size: number; mtime: number; ctime: number; ino: number }
async function inventory(root: string, folder = ''): Promise<Entry[]> {
  const result: Entry[] = []
  for (const name of (await readdir(join(root, folder))).sort()) {
    if (omit(name)) continue
    const path = folder ? folder + '/' + name : name
    const info = await lstat(join(root, path))
    if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory())
      throw new WorkflowError('clone-unsupported-file', 'Cannot clone a symbolic link or special file: ' + path, 409)
    result.push({ path, directory: info.isDirectory(), size: info.size,
      mtime: info.mtimeMs, ctime: info.ctimeMs, ino: info.ino })
    if (info.isDirectory()) result.push(...await inventory(root, path))
  }
  return result
}

export async function copyProjectForClone(source: string, target: string): Promise<void> {
  const [from, to] = await Promise.all([realpath(source), realpath(target)])
  const rel = relative(from, to)
  if (!rel || !rel.startsWith('..') && !isAbsolute(rel))
    throw new WorkflowError('invalid-clone-target', 'Clone must have an independent directory', 400)
  if ((await readdir(to)).length) throw new WorkflowError('clone-target-exists', 'Clone directory must be empty')
  const before = await inventory(from)
  for (const entry of before) {
    const sourceFile = join(from, entry.path), targetFile = join(to, entry.path)
    // Never follow a link introduced since inventory was read.
    if (await realpath(sourceFile) !== sourceFile)
      throw new WorkflowError('clone-source-changed', 'Project files changed while cloning; no copy was retained')
    if (entry.directory) await mkdir(targetFile, { recursive: true })
    else {
      await mkdir(dirname(targetFile), { recursive: true })
      await copyFile(sourceFile, targetFile, constants.COPYFILE_EXCL)
    }
  }
  if (JSON.stringify(before) !== JSON.stringify(await inventory(from)))
    throw new WorkflowError('clone-source-changed', 'Project files changed while cloning; no copy was retained')
}
