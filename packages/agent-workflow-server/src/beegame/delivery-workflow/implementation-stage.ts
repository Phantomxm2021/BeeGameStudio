import { existsSync } from 'node:fs'
import { transitionDeliveryRun } from './transition'
import { isWorkflowEvidenceFile } from './evidence'
import { resolveWorkspaceRelativePath } from './revision'
import { WORKFLOW_EVIDENCE_DIRECTORY } from './types'
import type { AtomicTask, DeliveryRun, WorkerDispatchRequest } from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type Dispatcher = { dispatch(request: WorkerDispatchRequest): Promise<unknown> }

export function nextRunnableTask(run: DeliveryRun): AtomicTask | undefined {
  if (
    run.phase !== 'IMPLEMENTATION' ||
    run.status !== 'running' ||
    run.activeTaskId
  )
    return undefined
  return run.tasks.find(
    task =>
      (task.status === 'pending' || task.status === 'failed') &&
      run.tasks
        .filter(candidate => task.dependsOn.includes(candidate.id))
        .every(candidate => candidate.status === 'completed'),
  )
}

export function implementationComplete(run: DeliveryRun): boolean {
  return (
    run.phase === 'IMPLEMENTATION' &&
    run.tasks.length > 0 &&
    run.tasks.every(task => task.status === 'completed')
  )
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
  const started = transitionDeliveryRun(input.run, {
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
    allowedPaths: [...task.allowedPaths, WORKFLOW_EVIDENCE_DIRECTORY],
    contract: { task, currentRevision: input.revision },
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
  const outOfScope = input.terminal.changedPaths.filter(
    path => !pathAllowed(path, task.allowedPaths),
  )
  const missingExpected = task.expectedArtifacts.filter(
    path => !input.terminal.changedPaths.includes(path),
  )
  const missingFiles = input.workspacePath
    ? task.expectedArtifacts.filter(path => {
        const resolved = resolveWorkspaceRelativePath(
          input.workspacePath!,
          path,
        )
        return !resolved || !existsSync(resolved)
      })
    : []
  const missingEvidence =
    input.workspacePath &&
    !isWorkflowEvidenceFile(input.workspacePath, input.terminal.evidencePath)
  const invalidEvidenceRefs = input.workspacePath
    ? input.terminal.evidenceRefs.filter(
        path => !isWorkflowEvidenceFile(input.workspacePath!, path),
      )
    : []
  if (
    input.terminal.status === 'completed' &&
    (outOfScope.length > 0 ||
      missingExpected.length > 0 ||
      missingFiles.length > 0 ||
      missingEvidence ||
      invalidEvidenceRefs.length > 0)
  ) {
    const fileIssue = missingFiles.length
      ? `; missing files: ${missingFiles.join(',')}`
      : ''
    const evidenceIssue = missingEvidence ? '; missing evidence file' : ''
    const evidenceRefsIssue = invalidEvidenceRefs.length
      ? `; invalid evidence refs: ${invalidEvidenceRefs.join(',')}`
      : ''
    return transitionDeliveryRun(input.run, {
      type: 'task_failed',
      taskId: task.id,
      reason: `implementation scope/evidence mismatch${outOfScope.length ? `; out of scope: ${outOfScope.join(',')}` : ''}${missingExpected.length ? `; missing artifacts: ${missingExpected.join(',')}` : ''}${fileIssue}${evidenceIssue}${evidenceRefsIssue}`,
    })
  }
  if (input.terminal.status !== 'completed')
    return transitionDeliveryRun(input.run, {
      type: 'task_failed',
      taskId: task.id,
      reason: input.terminal.status,
    })
  return transitionDeliveryRun(input.run, {
    type: 'task_completed',
    taskId: task.id,
    revision: input.currentRevision,
    evidenceRefs: input.terminal.evidenceRefs,
  })
}
