import { readFile, realpath, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { digest, WorkflowError, type CheckResult, type FileVersion, type TaskSpec } from './state'
import { artifactDigest } from '../runtime-acceptance'
import { isCurrentCheckVersion } from './check-versions'

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
