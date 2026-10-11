import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { bindContent, contentBindingRequestSchema, contentBindingAssetRefs, inspectContentBindings } from '../content-binding'
import { designSupportingBytesDigest } from '../design-handoff'
import { readBeeGameAssetManifestModulePathsSync, readBeeGameAssetManifestSync } from '../asset-contracts'
import { runContentCheck } from './content-checks'
import { readVersion, versionsMatch } from './checks'
import { digest, WorkflowError, type Attempt, type BindingOutcome, type CheckResult, type FileVersion, type Run } from './state'
import type { WorkflowStore } from './store'
import { CHECK_VERSIONS } from './check-versions'

export function bindingTargets(run: Run, taskId: string) {
  return run.tasks[taskId]!.spec.expectedOutputs.filter(file => /^content\/(ui|scenes)\/.+\.json$/.test(file))
}
export async function bindingOperands(run: Run, taskId: string) {
  return inspectContentBindings(run.workspacePath, bindingTargets(run, taskId))
}

/** The existing batch binder runs within the claimed host task, AFTER native
 * writer exit. An agent supplies only a strict data mapping, not credentials,
 * authoritative versions, or a parallel native writer. */
export async function executeTaskBindings(run: Run, attempt: Attempt, store: WorkflowStore, signal: AbortSignal): Promise<{
  binding: BindingOutcome; check: CheckResult; checkInputs: FileVersion[];
}> {
  signal.throwIfAborted()
  const root = run.workspacePath, task = run.tasks[attempt.taskId]!.spec
  const mapping = await readVersion(root, task.bindingPlan!)
  const request = contentBindingRequestSchema.parse(JSON.parse(await readFile(resolve(root, mapping.path), 'utf8')))
  const allowed = new Set(bindingTargets(run, attempt.taskId))
  const assertWritable = (file: string) => {
    if (!allowed.has(file) || !task.writablePaths.some(path => file === path || path.endsWith('/**') && file.startsWith(path.slice(0, -2))))
      throw new WorkflowError('binding-outside-task', 'Binding target is outside this task output/write scope: '+file, 400)
  }
  // Validate the entire batch before touching any target, including undeclared
  // targets. Native execution cannot silently modify bound dependency inputs.
  for (const item of request) assertWritable(item.file)
  if (!await versionsMatch(root, attempt.inputVersions)) throw new WorkflowError('binding-source-changed', 'Task inputs changed before host binding')
  const structure = await runContentCheck(root, 'content-structure', task, attempt.inputVersions, run.requirements.constraints)
  if (structure.status !== 'passed') throw new WorkflowError('binding-source-invalid', structure.observation, 400)
  const targetVersions = await Promise.all([...allowed].map(file => readVersion(root, file)))
  // Only the host's validated binding is permitted to transform these source
  // files. Keep original versions in Attempt; subsequent checks use new bytes.
  const baseline = [...new Map([...structure.inputs, mapping, ...targetVersions].map(file => [file.path, file])).values()]
  const immutable = baseline.filter(file => !allowed.has(file.path))
  const refs = new Set(contentBindingAssetRefs(request))
  for (const file of structure.coverage?.files ?? []) {
    const doc = JSON.parse(await readFile(resolve(root, file), 'utf8'))
    for (const id of doc.assetRefs ?? []) refs.add(id)
  }
  const protectedVersions = async () => Promise.all([...allowed].map(async file => ({ path: file,
    sha256: designSupportingBytesDigest(file, await readFile(resolve(root, (await readVersion(root, file)).path))) })))
  const readAuthority = async () => {
    signal.throwIfAborted()
    const current = await store.read(run.projectId, run.ownerId)
    if (current?.id !== run.id || current.workspacePath !== root || current.writer?.attemptId !== attempt.attemptId || current.writer.fence !== attempt.fence || current.planRevision !== attempt.planRevision)
      throw new WorkflowError('stale-attempt', 'Binding no longer owns the current writer/plan')
    const versions: FileVersion[] = []
    for (const file of immutable) versions.push(file.path.startsWith('requirement:')
      ? { path: file.path, sha256: current.requirements.sha256 } : await readVersion(root, file.path))
    // A missing manifest can serve a genuinely resource-free actions binding;
    // it does not authorize final resources. Presence/registry/member changes
    // between preparation and a per-file commit invalidate the same batch.
    const assets: FileVersion[] = []
    const present = await access(resolve(root, 'assets/asset-manifest.json')).then(() => true, () => false)
    if (present) {
      assets.push(await readVersion(root, 'assets/asset-manifest.json'))
      for (const file of readBeeGameAssetManifestModulePathsSync(root)) assets.push(await readVersion(root, file))
    }
    const manifest = readBeeGameAssetManifestSync(root)
    for (const resource of manifest.resources.filter(resource => refs.has(resource.id)))
      for (const file of new Set([...resource.file_paths, ...(resource.dependencies?.map(dep => dep.local_path) ?? [])])) assets.push(await readVersion(root, file))
    return { documentRevision: digest(JSON.stringify({ requirements: current.requirements.sha256, sources: versions, protected: await protectedVersions() })),
      assetManifestRevision: digest(JSON.stringify({ manifest, assets })), manifest, versions, assets }
  }
  if (!await versionsMatch(root, [...attempt.inputVersions, ...baseline])) throw new WorkflowError('binding-source-changed', 'Sources changed during binding preparation')
  const before = await readAuthority()
  const applied = await bindContent(root, request, signal, { assertWritable, async readAuthority() {
    const current = await readAuthority()
    if (current.documentRevision !== before.documentRevision || current.assetManifestRevision !== before.assetManifestRevision)
      throw new WorkflowError('binding-source-changed', 'Task sources or resources changed before binding commit')
    return current
  } })
  // A partial commit is reported and retained. There is no rollback or retry;
  // host recovery must verify what actually happened before any new execution.
  const binding: BindingOutcome = { mapping, valid: applied.valid, written: applied.written, pending: applied.pending, issues: applied.issues }
  const transformed = new Map(applied.written.map(file => [file.file, { path: file.file, sha256: file.sha256 }]))
  const checkInputs = [...new Map([...baseline.map(file => transformed.get(file.path) ?? file), ...before.assets].map(file => [file.path, file])).values()]
  const check: CheckResult = { id: 'content-binding', version: CHECK_VERSIONS['content-binding'], status: applied.valid ? 'passed' : 'failed', inputs: checkInputs,
    observation: applied.valid ? 'Host applied the explicit batch within this task; protected design and source/resource versions preserved. Not runtime or visual acceptance.' : applied.issues.join('\n'),
    createdAt: new Date().toISOString(), coverage: { files: request.map(item => item.file), limitations: ['Per-file commits, not a multi-file transaction. Partial writes retained without automatic retry.', 'Only actual mapping targets bound; undeclared or omitted required resources are not proven complete.'] } }
  if (check.status === 'passed' && !await versionsMatch(root, checkInputs)) {
    check.status = 'unverified'; check.observation = 'Binding inputs/outputs changed before settlement.'
  }
  return { binding, check, checkInputs }
}
