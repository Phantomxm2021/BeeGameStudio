import { readFile, realpath, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { contentDocumentSchema } from '../game-content-schema'
import { digest, WorkflowError, type Attempt, type CheckResult, type FileVersion, type Run, type TaskSpec } from './state'
import { runContentCheck } from './content-checks'
import { artifactDigest } from '../runtime-acceptance'
import { runArtifactCheck } from './runtime-checks'
import { reviewInputs, runReviewCheck, runRepairCheck, type ReviewContext, type ReviewOutcome } from './review'
import { CHECK_VERSIONS, currentCheckVersion, isCurrentCheckVersion } from './check-versions'

export async function readVersion(root: string, file: string): Promise<FileVersion> {
  const base = await realpath(root), target = await realpath(resolve(root, file)), rel = relative(base, target)
  if (!rel || rel.startsWith('../') || rel === '..' || !(await stat(target)).isFile())
    throw new WorkflowError('invalid-file-input', 'Input must be a regular file within the project: '+file, 400)
  return { path: file, sha256: digest(await readFile(target)) }
}
export async function bindInputs(run: Run, task: TaskSpec): Promise<FileVersion[]> {
  const versions: FileVersion[] = [{ path: 'requirement:'+run.requirements.revision, sha256: run.requirements.sha256 }]
  for (const input of task.inputs) {
    if (input.startsWith('requirement:')) continue
    if (input.startsWith('output:')) {
      const [dep, ...parts] = input.slice(7).split('/'), path = parts.join('/')
      const attempt = run.attempts.find(a => a.attemptId === run.tasks[dep!]?.attemptId)
      const recorded = attempt?.outputs?.find(v => v.path === path)
      const current = await readVersion(run.workspacePath, path)
      if (!recorded || current.sha256 !== recorded.sha256) throw new WorkflowError('stale-dependency', 'Dependency output changed: '+path)
      versions.push(current)
    } else versions.push(await readVersion(run.workspacePath, input))
  }
  return [...new Map([...versions, ...await reviewInputs(run, task)].map(file => [file.path, file])).values()]
}
export async function versionsMatch(root: string, versions: FileVersion[]): Promise<boolean> {
  for (const version of versions) {
    if (version.path.startsWith('requirement:')) continue
    try { if ((await readVersion(root, version.path)).sha256 !== version.sha256) return false }
    catch { return false }
  }
  return true
}
/** Revision may read and replace its own explicitly authorized candidate.
 * Keep the Attempt's original snapshot; checks consume the actual saved bytes.
 * Batch binding still requires untouched inputs before the host transformation. */
export async function settlementInputs(root: string, task: TaskSpec, original: FileVersion[]): Promise<FileVersion[]> {
  const current: FileVersion[] = []
  for (const file of original) {
    if (file.path.startsWith('requirement:')) { current.push(file); continue }
    const saved = await readVersion(root, file.path)
    if (saved.sha256 !== file.sha256 && (task.kind !== 'game.develop' || task.bindingPlan || !task.expectedOutputs.includes(file.path) ||
        !task.writablePaths.some(scope => file.path === scope || scope.endsWith('/**') && file.path.startsWith(scope.slice(0, -2)))))
      throw new WorkflowError('task-source-changed', 'Read-only task input changed: '+file.path)
    current.push(saved)
  }
  return current
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
async function attemptIsCurrent(run: Run, task: TaskSpec, attempt: Attempt): Promise<boolean> {
  // Filesystem freshness cannot validate virtual requirement snapshots.
  const requirements = [...attempt.inputVersions, ...(attempt.checks?.flatMap(c => c.inputs) ?? [])].filter(v => v.path.startsWith('requirement:'))
  if (run.requirementChanges?.length && !requirements.length || requirements.some(v => v.path !== 'requirement:'+run.requirements.revision || v.sha256 !== run.requirements.sha256)) return false
  // The immutable attempt snapshot precedes an authorized self-revision or host
  // binding. Accepted output bytes, not that old snapshot, pin the revised input.
  const settledInputs = attempt.inputVersions.map(file => {
    const output = attempt.outputs?.find(v => v.path === file.path)
    return task.kind === 'game.develop' && output && task.expectedOutputs.includes(file.path) &&
      task.writablePaths.some(scope => file.path === scope || scope.endsWith('/**') && file.path.startsWith(scope.slice(0, -2))) ? output : file
  })
  return await versionsMatch(run.workspacePath, [...settledInputs, ...(attempt.outputs ?? [])]) &&
    (await Promise.all((attempt.checks ?? []).map(check => checkIsCurrent(run.workspacePath, check, task)))).every(Boolean)
}
/** Recheck actual upstream evidence before spending on a consumer. This does
 * not reset tasks, re-run checks or invalidate an unrelated completed branch. */
export async function assertFreshDependencies(run: Run, task: TaskSpec): Promise<void> {
  const visited = new Set<string>()
  async function inspect(id: string): Promise<void> {
    if (visited.has(id)) return
    visited.add(id)
    const source = run.tasks[id], attempt = run.attempts.find(a => a.attemptId === source?.attemptId)
    if (!source || source.status !== 'succeeded' || !attempt || attempt.status !== 'succeeded')
      throw new WorkflowError('dependency-unverified', 'Dependency has no accepted current attempt: '+id)
    const obsolete = attempt.checks?.find(check => !isCurrentCheckVersion(check, source.spec))
    if (obsolete) {
      const expected = Object.hasOwn(CHECK_VERSIONS, obsolete.id) ? currentCheckVersion(obsolete.id as keyof typeof CHECK_VERSIONS, source.spec) : 'unsupported checker'
      throw new WorkflowError('stale-check-version', 'Dependency checker version is not current: '+id+'/'+obsolete.id+
        ' (saved '+obsolete.version+', current '+expected+'). Submit an authorized affected recheck plan; no automatic execution.')
    }
    const required = [...source.spec.checks, ...(source.spec.skills?.length ? ['skill-use'] : []), ...(source.spec.bindingPlan ? ['content-binding'] : [])]
    if (!required.every(check => attempt.checks?.some(c => c.id === check && c.status === 'passed')) ||
        !await attemptIsCurrent(run, source.spec, attempt))
      throw new WorkflowError('stale-dependency', 'Dependency evidence changed or is incomplete: '+id+'. Inspect sources and publish an affected repair/recheck plan; no automatic retry.')
    for (const dep of source.spec.dependsOn) await inspect(dep)
  }
  for (const id of task.dependsOn) await inspect(id)
}
/** Host-only freshness for an explicitly submitted revised plan. Does not
 * dispatch or accept author's PASS/evidence claims, or unlock old writers. */
export async function staleTaskIds(run: Run): Promise<string[]> {
  const stale: string[] = []
  for (const [id, task] of Object.entries(run.tasks)) {
    if (!task.attemptId || task.status === 'superseded') continue
    const attempt = run.attempts.find(a => a.attemptId === task.attemptId)
    if (!attempt || !await attemptIsCurrent(run, task.spec, attempt)) stale.push(id)
  }
  return stale
}
export async function commandCheck(root: string, script: string, signal?: AbortSignal, isolated = false): Promise<{ code: number | null; log: string }> {
  // Code/build execution is within the user's project authorization. No host keys are inherited.
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) { reject(new Error('Check cancelled')); return }
    const child = spawn(process.execPath, isolated ? [fileURLToPath(new URL('./sandbox-build.mjs',import.meta.url)),script] : ['run', script], { cwd: root, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
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
export async function runChecks(root: string, task: TaskSpec, inputs: FileVersion[], signal?: AbortSignal, constraints: Record<string, unknown> = {}, reviewContext?: ReviewContext): Promise<{ checks: CheckResult[]; outputs: FileVersion[]; review?: ReviewOutcome }> {
  let outputs: FileVersion[] = []
  const checks: CheckResult[] = []
  let review: ReviewOutcome | undefined
  const collectOutputs = async () => {
    const current: FileVersion[] = []
    for (const file of task.expectedOutputs) try { current.push(await readVersion(root, file)) } catch { /* Missing outputs are unverified, never empty PASS. */ }
    return current
  }
  // Build is a producer: checking for its outputs before running it prevented
  // legitimate first builds. Other checks consume the resulting current bytes.
  const ordinary = task.checks.filter(id => id !== 'repair-verification')
  const order: TaskSpec['checks'] = [...(ordinary.includes('build') ? ['build' as const, ...ordinary.filter(id => id !== 'build')] : ordinary),
    ...(task.checks.includes('repair-verification') ? ['repair-verification' as const] : [])]
  for (const id of order) {
    outputs = await collectOutputs()
    const files = [...inputs, ...outputs], complete = outputs.length === task.expectedOutputs.length
    let result: CheckResult = { id, version: currentCheckVersion(id, task), status: 'unverified', inputs: files,
      observation: 'This check driver is not connected in the first slice; it cannot authorize release.', createdAt: new Date().toISOString() }
    try {
      if (signal?.aborted) throw new Error('Check cancelled')
      if (!complete && id !== 'build' && id !== 'rule-tests') result.observation = 'Required output missing or outside the workspace: '+task.expectedOutputs.filter(p => !outputs.some(v => v.path === p)).join(', ')
      else if (id === 'content-structure' || id === 'content-layout' || id === 'content-resources') result = await runContentCheck(root, id, task, files, constraints)
      else if (id === 'runtime-smoke' || id === 'delivery-package' || id === 'ui-data-consumption' || id === 'pixel-data-consumption' || id === 'font-data-consumption' || id === 'audio-data-consumption') result = await runArtifactCheck(root, id, task, files, constraints, signal)
      else if (id === 'review-findings' && reviewContext) {
        const checked = await runReviewCheck(root, task, files, reviewContext); result = checked.check; review = checked.review
      } else if (id === 'repair-verification' && reviewContext && task.repairOf) result = await runRepairCheck(root, task, files, checks, reviewContext)
      else if (id === 'artifact-json' || id === 'content-schema') {
        if (task.expectedOutputs.some(file => !file.endsWith('.json'))) result.observation = 'All declared outputs must be JSON for this check.'
        else {
          for (const file of task.expectedOutputs.filter(file => id !== 'content-schema' || file !== task.bindingPlan)) {
            const data = JSON.parse(await readFile(resolve(root, file), 'utf8'))
            if (id === 'content-schema') contentDocumentSchema.parse(data)
          }
          result.status = 'passed'; result.observation = id === 'artifact-json' ? 'Actual saved JSON parsed; no gameplay or semantic claim.' : 'Saved content documents match the existing strict Schema; resources, layout and runtime are not verified.'
        }
      } else if (id === 'build' && task.editableProject) {
        const {buildEditableProject}=await import('./editable-project')
        const reports=reviewContext?.run.plans.flatMap(p=>p.plan.tasks.flatMap(t=>t.reviewReport?[t.reviewReport]:[])) ?? []
        result=await buildEditableProject(root,task,inputs,[...new Set(reports)].sort(),signal)
        outputs=await collectOutputs()
        if(result.status==='passed' && outputs.length!==task.expectedOutputs.length) {
          result.status='unverified';result.observation+='\nDeclared task outputs are missing; build exit zero alone is insufficient.'
        }
      } else if (id === 'build' || id === 'rule-tests') {
        const file = await readVersion(root, 'package.json'); result.inputs = [...inputs, file]
        const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
        const script = id === 'build' ? 'build' : 'test:rules'
        if (typeof pkg.scripts?.[script] !== 'string' || !pkg.scripts[script].trim()) result.observation = 'No actual package script: '+script
        else {
          const observation = await commandCheck(root, script, signal)
          result.status = observation.code === 0 ? 'passed' : 'failed'
          result.observation = 'Host executed bun run '+script+'; exit '+observation.code+'\n'+observation.log
          outputs = await collectOutputs(); result.inputs.push(...outputs)
          if (result.status === 'passed' && outputs.length !== task.expectedOutputs.length) {
            result.status = 'unverified'; result.observation += '\nDeclared build/task outputs are missing; exit zero alone is insufficient.'
          }
          result.coverage = { files: result.inputs.map(file => file.path), limitations: ['Command result and declared input/output versions only; not proof of requirement coverage or actual target-runtime/data consumption.'] }
        }
      }
    } catch (error) {
      result.status = ['artifact-json', 'content-schema'].includes(id) ? 'failed' : 'execution-error'
      result.observation = error instanceof Error ? error.message : 'Check execution failed'
    }
    if (result.status === 'passed' && !await checkIsCurrent(root, result, task)) {
      result.status = 'unverified'; result.observation = 'Checked inputs, artifacts or driver version changed during execution; result is not current.'
    }
    checks.push(result)
  }
  outputs = await collectOutputs()
  return { outputs, checks, ...(review ? { review } : {}) }
}
