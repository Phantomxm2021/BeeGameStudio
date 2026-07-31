import { existsSync } from 'node:fs'
import { readBeeGameAssetManifest } from '../asset-contracts'
import { transitionDeliveryRun } from './transition'
import { isWorkflowEvidenceFile } from './evidence'
import { resolveWorkspaceRelativePath } from './revision'
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

export function implementationCompletionIssue(input: {
  task: AtomicTask
  workspacePath?: string
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
  const verifiedArtifactsMatch = sameIds(
    input.terminal.verifiedArtifacts,
    input.task.expectedArtifacts,
  )
  const missingFiles = input.workspacePath
    ? input.task.expectedArtifacts.filter(path => {
        const resolved = resolveWorkspaceRelativePath(
          input.workspacePath!,
          path,
        )
        return !resolved || !existsSync(resolved)
      })
    : []
  const expectedIndexes = input.task.verification.map((_, index) => index)
  const actualIndexes = input.terminal.verificationResults.map(
    result => result.verificationIndex,
  )
  const verificationCoverageMatches = sameNumbers(
    actualIndexes,
    expectedIndexes,
  )
  const invalidVerification = input.terminal.verificationResults.find(
    result => {
      const verification = input.task.verification[result.verificationIndex]
      return (
        !verification ||
        (result.status === 'deferred' && verification.kind !== 'runtime')
      )
    },
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
    ...(!verifiedArtifactsMatch
      ? ['verified artifacts do not match the active task expected artifacts']
      : []),
    ...(missingFiles.length
      ? [`missing files: ${missingFiles.join(',')}`]
      : []),
    ...(!verificationCoverageMatches
      ? [
          'verification results do not cover every active task verification exactly once',
        ]
      : []),
    ...(invalidVerification
      ? [
          `verification ${invalidVerification.verificationIndex} may be deferred only when its kind is runtime`,
        ]
      : []),
    ...(missingEvidence ? ['missing evidence file'] : []),
    ...(invalidEvidenceRefs.length
      ? [`invalid evidence refs: ${invalidEvidenceRefs.join(',')}`]
      : []),
    ...(!evidenceRefsMatch
      ? ['evidenceRefs must contain exactly the canonical evidencePath']
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

function sameNumbers(
  left: readonly number[],
  right: readonly number[],
): boolean {
  const a = [...new Set(left)].sort((x, y) => x - y)
  const b = [...new Set(right)].sort((x, y) => x - y)
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
  const started = transitionDeliveryRun(input.run, {
    type: 'task_started',
    taskId: task.id,
    revision: input.revision,
  })
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  const requirementIds = new Set(task.resourceRequirementIds)
  const resourceBindings = manifest.requirements
    .filter(requirement => requirementIds.has(requirement.id))
    .map(requirement => {
      if (!requirement.source_decision)
        throw new Error(
          `implementation requires one final source decision for ${requirement.id}`,
        )
      return {
        requirementId: requirement.id,
        sourceType: requirement.source_decision.type,
        importIds: requirement.satisfied_by?.import_ids ?? [],
        compositionIds: requirement.satisfied_by?.composition_ids ?? [],
        projectReferences: requirement.satisfied_by?.project_references ?? [],
      }
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
      runtimeAssetRoot: manifest.project_target?.runtime_asset_root,
      resourceBindings,
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
