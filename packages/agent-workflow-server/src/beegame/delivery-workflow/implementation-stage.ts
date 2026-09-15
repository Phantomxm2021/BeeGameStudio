import { readBeeGameAssetManifest } from '../asset-contracts'
import { transitionDeliveryRun } from './transition'
import { isWorkflowEvidenceFile } from './evidence'
import { resourceIrDeliveryIssues } from './resource-ir-delivery'
import type { ImplementationTask, DeliveryRun, WorkerDispatchRequest } from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type Dispatcher = { dispatch(request: WorkerDispatchRequest): Promise<unknown> }

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
  gameIr?: unknown
  terminal: Extract<
    WorkerTerminalResult,
    { workerType: 'implementation-worker' }
  >
}): string | undefined {
  if (input.terminal.status !== 'completed') return input.terminal.status
  const allowedPaths = input.task.allowedPaths
  const outOfScope = input.terminal.changedPaths.filter(
    path => !pathAllowed(path, allowedPaths),
  )
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
    ...(outOfScope.length ? [`out of scope: ${outOfScope.join(',')}`] : []),
    ...(missingEvidence ? ['missing evidence file'] : []),
    ...(invalidEvidenceRefs.length
      ? [`invalid evidence refs: ${invalidEvidenceRefs.join(',')}`]
      : []),
    ...(!evidenceRefsMatch
      ? ['evidenceRefs must contain exactly the canonical evidencePath']
      : []),
    ...(input.workspacePath && input.gameIr
      ? resourceIrDeliveryIssues({
          gameIr: input.gameIr,
          workspacePath: input.workspacePath,
          artifactClasses: [
            'runtime-resource',
            'generated-output',
          ],
        })
      : []),
  ]
  return issues.length
    ? `implementation scope/evidence mismatch; ${issues.join('; ')}`
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
  const started = transitionDeliveryRun(input.run, {
    type: 'task_started',
    taskId: task.id,
    revision: input.revision,
  })
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  const resourcesById = new Map(
    manifest.resources.map(resource => [resource.id, resource]),
  )
  const resources = task.resourceIds.map(id => {
    const resource = resourcesById.get(id)
    if (!resource || resource.status !== 'verified')
      throw new Error(
        `implementation task references unavailable resource ${id}`,
      )
    return { id, rootPath: resource.root_path, filePaths: resource.file_paths }
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
      task,
      currentRevision: input.revision,
      resources,
      ...(input.run.blockedReason
        ? { currentImplementationIssues: [input.run.blockedReason] }
        : {}),
    },
  }
  await input.beforeDispatch?.(started)
  return { run: started, dispatch: await input.dispatcher.dispatch(request) }
}

function pathAllowed(path: string, allowedPaths: string[]): boolean {
  const normalized = stripDotSlash(path.replaceAll('\\', '/'))
  if (normalized.split('/').includes('..') || normalized.startsWith('/'))
    return false
  return allowedPaths.some(allowed => {
    const scope = stripTrailingSlash(
      stripDotSlash(allowed.replaceAll('\\', '/')),
    )
    if (scope === '.' || scope === '') return true
    return normalized === scope || normalized.startsWith(`${scope}/`)
  })
}

function stripDotSlash(value: string): string {
  let result = value
  while (result.startsWith('./')) result = result.slice(2)
  return result
}

function stripTrailingSlash(value: string): string {
  let result = value
  while (result.endsWith('/')) result = result.slice(0, -1)
  return result
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
