import { readFile, realpath, stat, readdir, lstat } from 'node:fs/promises'
import { relative, resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { digest, WorkflowError, type CheckResult, type FileVersion, type TaskSpec } from './state'
import { artifactDigest } from '../runtime-acceptance'
import { isCurrentCheckVersion } from './check-versions'

const safeDots = new Set(['.gitignore', '.editorconfig', '.browserslistrc'])
const excludedNames = new Set(['node_modules', '.git', '.beegame', '.DS_Store'])
// Autonomous Web builds reserve this directory for validation attachments.
// It is absent from the measured build copy, not merely ignored after building.
// Existing receipts retain their own recorded exclusions (often exact files).
export const AGENT_EVIDENCE_DIRECTORY = 'reports'
// SessionManager's reserved workspace records live outside .beegame too.
// Keep other files in logs/ (they may be real game inputs), not a name-only
// exclusion of every logging directory in the editable project.
const hostRecord = (path:string) => path==='transcripts' || /^logs\/(index\.json|runtime-diagnostics\.jsonl(?:\.\d+)?)$/.test(path)
/** No author-selected file list: enumerate the exportable project before build.
 * Private dot files are absent from the build copy, not silently required inputs.
 * Reports are host workflow evidence, not editable game source. */
export async function projectFiles(root: string, artifact: string, excludedReports: string[]): Promise<FileVersion[]> {
  const base = await realpath(root), files: FileVersion[] = []
  async function visit(dir: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
      const target = resolve(dir,entry.name), path = relative(base,target).split('\\').join('/')
      if (path===artifact || hostRecord(path) || excludedReports.some(report=>path===report || path.startsWith(report+'/')) || excludedNames.has(entry.name) || entry.name.startsWith('.') && !safeDots.has(entry.name)) continue
      if (entry.name.includes('\\') || entry.isSymbolicLink() || await realpath(target)!==target)
        throw new WorkflowError('project-alias', 'Editable project sources must not contain aliases: '+path)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) files.push({path,sha256:digest(await readFile(target))})
      else throw new WorkflowError('project-file-invalid','Editable project contains a non-regular source: '+path)
    }
  }
  await visit(base)
  if (!files.some(f=>f.path==='package.json')) throw new WorkflowError('project-incomplete','Editable export needs a saved package.json',400)
  return files.sort((a,b)=>a.path.localeCompare(b.path))
}
export const sameFiles = (a: FileVersion[], b: FileVersion[]) => JSON.stringify(a)===JSON.stringify(b)
export function changedProjectPaths(previous: FileVersion[], current: FileVersion[]) {
  const before=new Map(previous.map(f=>[f.path,f.sha256])),after=new Map(current.map(f=>[f.path,f.sha256]))
  return [...new Set([...before.keys(),...after.keys()])].filter(path=>before.get(path)!==after.get(path)).sort()
}
export async function projectDependencies(root:string) {
  try {
    const dir=join(root,'node_modules'), info=await lstat(dir)
    if (!info.isDirectory() || await realpath(dir)!==dir) throw new WorkflowError('dependency-alias','Installed dependency root must be a project-local directory')
    return await artifactDigest(root,'node_modules',true)
  } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error }
}
export async function readVersion(root: string, file: string): Promise<FileVersion> {
  const base = await realpath(root), target = await realpath(resolve(root, file)), rel = relative(base, target)
  if (!rel || rel.startsWith('../') || rel === '..' || !(await stat(target)).isFile())
    throw new WorkflowError('invalid-file-input', 'Input must be a regular file within the project: '+file, 400)
  return { path: file, sha256: digest(await readFile(target)) }
}
export async function versionsMatch(root: string, versions: FileVersion[]): Promise<boolean> {
  for (const version of versions) {
    if (version.path.startsWith('requirement:')) continue
    try { if ((await readVersion(root, version.path)).sha256 !== version.sha256) return false }
    catch { return false }
  }
  return true
}
export async function checkIsCurrent(root: string, check: CheckResult, task?: Pick<TaskSpec, 'editableProject'>): Promise<boolean> {
  if (!isCurrentCheckVersion(check, task)) return false
  if (!await versionsMatch(root, check.inputs)) return false
  for (const artifact of check.artifacts ?? []) {
    try { if (await artifactDigest(root, artifact.path, true) !== artifact.sha256) return false }
    catch { return false }
  }
  return true
}
export async function commandCheck(root: string, script: string, signal?: AbortSignal): Promise<{ code: number | null; log: string }> {
  // Code/build execution is within the user's project authorization. No host keys are inherited.
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) { reject(new Error('Check cancelled')); return }
    const child = spawn(process.execPath, [fileURLToPath(new URL('./sandbox-build.mjs',import.meta.url)),script], { cwd: root, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    const abort = () => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error) }
    }
    signal?.addEventListener('abort', abort, { once: true })
    let log = ''
    const collect = (data: Buffer) => { log = (log+data.toString()).slice(-4000) }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    child.once('error', error => { signal?.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => { signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new Error('Check cancelled')); else resolvePromise({ code, log }) })
  })
}
