import { readBeeGameAssetManifest, readBeeGameAssetManifestSync } from '../asset-contracts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { acceptBeeGameContentPackage, auditBeeGameContentPackage } from '../game-content-package'
import { refreshResourceDelivery } from './resource-stage'
import { validateResourceDelivery } from '../resource-validation-cli'
import { ASSET_MANIFEST_AUTHORING_CONTRACT_PATH, ASSET_MANIFEST_VALIDATION_COMMAND } from '../asset-manifest-authoring-contract'
import { transitionDeliveryRun } from './transition'
import { isWorkflowEvidenceFile, resolveWorkflowEvidencePath } from './evidence'
import type { ImplementationTask, DeliveryRun, WorkerDispatchRequest } from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type Dispatcher = { dispatch(request: WorkerDispatchRequest): Promise<unknown> }

export async function bindImplementationEvidence(workspacePath: string, evidencePath: string, revision: string) {
  if (!isWorkflowEvidenceFile(workspacePath, evidencePath)) throw new Error('missing implementation evidence')
  const target = resolveWorkflowEvidencePath(workspacePath, evidencePath)!
  const evidence = JSON.parse(await readFile(target, 'utf8'))
  await writeFile(target, JSON.stringify({
    ...evidence, inputRevision: evidence.inputRevision ?? evidence.revision, revision,
  }, null, 2) + '\n')
}

/** Accept coordinated repairs in this task without restarting upstream authoring. */
export async function refreshImplementationArtifacts(input: {
  run: DeliveryRun
  workspacePath: string
}): Promise<DeliveryRun> {
  const run = await refreshResourceDelivery(input)
  if (run.status === 'needs_action') throw new Error(run.blockedReason)
  const indexPath = join(input.workspacePath, 'content/index.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  // Only advance a known prior binding. Never bless an unrelated/stale package.
  if (index.assetManifestRevision !== input.run.revision.resource &&
      index.assetManifestRevision !== run.revision.resource)
    throw new Error('Content Asset Manifest revision is unrelated to this implementation')
  const authority = { documentRevision: run.revision.document,
    assetManifestRevision: index.assetManifestRevision,
    manifest: readBeeGameAssetManifestSync(input.workspacePath) }
  const audit = auditBeeGameContentPackage(input.workspacePath, authority)
  if (!audit.package) throw new Error(audit.issues.join('; '))
  if (index.assetManifestRevision !== run.revision.resource)
    await writeFile(indexPath, JSON.stringify({ ...index, assetManifestRevision: run.revision.resource }, null, 2) + '\n')
  const receipt = acceptBeeGameContentPackage(input.workspacePath, {
    ...authority, assetManifestRevision: run.revision.resource!,
  })
  return { ...run, phase: 'IMPLEMENTATION',
    gameContentReceipt: receipt,
    revision: { ...run.revision, content: receipt.contentRevision },
    tasks: run.tasks.map(task => ({ ...task, contentIds: [...receipt.contentIds],
      resourceIds: authority.manifest.resources.filter(r => r.status === 'verified').map(r => r.id) })),
    evidence: { ...run.evidence, acceptance: undefined,
      gameContent: { path: receipt.indexPath, kind: 'game_content', status: 'passed',
        revision: receipt.contentRevision, observedAt: new Date().toISOString() } },
  }
}

export function nextRunnableTask(run: DeliveryRun): ImplementationTask | undefined {
  if (
    run.phase !== 'IMPLEMENTATION' ||
    run.status !== 'running' ||
    run.activeTaskId
  )
    return undefined
  const task = run.tasks[0]
  return task && (task.status === 'pending' || task.status === 'failed')
    ? task
    : undefined
}

export function implementationComplete(run: DeliveryRun): boolean {
  return (
    run.phase === 'IMPLEMENTATION' &&
    run.tasks.length > 0 &&
    run.tasks.every(task => task.status === 'completed')
  )
}

export function implementationCompletionIssue(input: {
  task: ImplementationTask
  workspacePath?: string
  terminal: Extract<
    WorkerTerminalResult,
    { workerType: 'implementation-worker' }
  >
}): string | undefined {
  if (input.terminal.status !== 'completed') return input.terminal.status
  const missingEvidence =
    input.workspacePath &&
    !isWorkflowEvidenceFile(input.workspacePath, input.terminal.evidencePath)
  const invalidEvidenceRefs = input.workspacePath
    ? input.terminal.evidenceRefs.filter(
        path => !isWorkflowEvidenceFile(input.workspacePath!, path),
      )
    : []
  const evidenceRefsMatch = sameIds(input.terminal.evidenceRefs, [
    input.terminal.evidencePath,
  ])
  const issues = [
    ...(missingEvidence ? ['missing evidence file'] : []),
    ...(invalidEvidenceRefs.length
      ? [`invalid evidence refs: ${invalidEvidenceRefs.join(',')}`]
      : []),
    ...(!evidenceRefsMatch
      ? ['evidenceRefs must contain exactly the canonical evidencePath']
      : []),
  ]
  return issues.length
    ? `implementation evidence mismatch; ${issues.join('; ')}`
    : undefined
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export async function startNextImplementationTask(input: {
  run: DeliveryRun
  workspacePath: string
  revision: string
  dispatcher: Dispatcher
  beforeDispatch?: (run: DeliveryRun) => Promise<void>
}): Promise<
  | { run: DeliveryRun; dispatch: unknown }
  | { run: DeliveryRun; dispatch?: undefined }
> {
  const task = nextRunnableTask(input.run)
  if (!task) return { run: input.run }
  const content = input.run.gameContentReceipt
  if (!content || !input.run.revision.content ||
      content.contentRevision !== input.run.revision.content ||
      !sameIds(task.contentIds, [...content.contentIds]))
    throw new Error('implementation requires the exact accepted Scene/UI content package')
  const currentIssues = input.run.blockedReason ? [input.run.blockedReason] : []
  try {
    currentIssues.push(...validateResourceDelivery(input.workspacePath, input.run.confirmedBriefContext).issues)
  } catch (error) {
    currentIssues.push(error instanceof Error ? error.message : String(error))
  }
  const manifest = await readBeeGameAssetManifest(input.workspacePath).catch(error => {
    currentIssues.push(error instanceof Error ? error.message : String(error))
    return { resources: [] }
  })
  const resourcesById = new Map(
    manifest.resources.map(resource => [resource.id, resource]),
  )
  const resources = task.resourceIds.flatMap(id => {
    const resource = resourcesById.get(id)
    if (!resource || resource.status !== 'verified') {
      currentIssues.push(`implementation resource ${id} is ${resource?.status ?? 'unavailable'}; coordinate targeted resource repair`)
      return []
    }
    return [{ id, rootPath: resource.root_path, filePaths: resource.file_paths }]
  })
  // Unavailable resources remain obligations; reporting a defect must not
  // silently remove its ID from the task that will coordinate the repair.
  const effectiveTask = task
  const effectiveRun = {
    ...input.run,
    tasks: input.run.tasks.map(candidate =>
      candidate.id === task.id ? effectiveTask : candidate,
    ),
  }
  const started = transitionDeliveryRun(effectiveRun, {
    type: 'task_started',
    taskId: task.id,
    revision: input.revision,
  })
  const request: WorkerDispatchRequest = {
    runId: started.runId,
    ownerId: started.ownerId,
    projectId: started.projectId,
    workspacePath: input.workspacePath,
    workerType: 'implementation-worker',
    phase: 'IMPLEMENTATION',
    taskId: task.id,
    revision: input.revision,
    allowedPaths: task.allowedPaths,
    contract: {
      task: effectiveTask,
      currentRevision: input.revision,
      resources,
      resourceContractPath: ASSET_MANIFEST_AUTHORING_CONTRACT_PATH,
      resourceValidationCommand: ASSET_MANIFEST_VALIDATION_COMMAND,
      ...(input.run.changeRequest
        ? { changeRequest: input.run.changeRequest, changeRationale: input.run.changeRationale }
        : {}),
      ...(currentIssues.length
        ? { currentImplementationIssues: [...new Set(currentIssues)] }
        : {}),
    },
  }
  await input.beforeDispatch?.(started)
  return { run: started, dispatch: await input.dispatcher.dispatch(request) }
}


export function completeImplementationTask(input: {
  run: DeliveryRun
  workspacePath?: string
  terminal: Extract<
    WorkerTerminalResult,
    { workerType: 'implementation-worker' }
  >
  currentRevision: string
  completionFailureReason?: string
}): DeliveryRun {
  if (input.run.phase !== 'IMPLEMENTATION')
    throw new Error('implementation is not the active phase')
  const task = input.run.tasks.find(
    candidate => candidate.id === input.terminal.taskId,
  )
  if (!task || input.run.activeTaskId !== task.id)
    throw new Error('implementation terminal does not match the active task')
  if (input.completionFailureReason)
    return transitionDeliveryRun(input.run, {
      type: 'task_failed',
      taskId: task.id,
      reason: input.completionFailureReason,
    })
  const completionIssue = implementationCompletionIssue({
    task,
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    terminal: input.terminal,
  })
  if (completionIssue) {
    return transitionDeliveryRun(input.run, {
      type: 'task_failed',
      taskId: task.id,
      reason: completionIssue,
    })
  }
  return transitionDeliveryRun(input.run, {
    type: 'task_completed',
    taskId: task.id,
    revision: input.currentRevision,
    evidenceRefs: input.terminal.evidenceRefs,
  })
}
