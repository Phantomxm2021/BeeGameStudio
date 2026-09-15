import { transitionDeliveryRun } from './transition'
import { isWorkflowEvidenceFile } from './evidence'
import type { DeliveryRun, EvidenceRef, WorkerDispatchRequest } from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type Dispatcher = { dispatch(request: WorkerDispatchRequest): Promise<unknown> }

function currentImplementationRevision(run: DeliveryRun): string {
  return run.revision.implementation ?? run.revision.workspace
}

function allTasksComplete(run: DeliveryRun): boolean {
  return (
    run.tasks.length > 0 &&
    run.tasks.every(
      task =>
        task.status === 'completed' &&
        Boolean(task.completedRevision) &&
        task.evidenceRefs.length > 0,
    )
  )
}

export function enterAcceptance(run: DeliveryRun): DeliveryRun {
  if (run.phase !== 'IMPLEMENTATION' || !allTasksComplete(run))
    throw new Error(
      'cannot enter acceptance before implementation is complete',
    )
  return {
    ...run,
    phase: 'ACCEPTANCE',
    activeTaskId: undefined,
    activeDispatch: undefined,
    updatedAt: new Date().toISOString(),
  }
}

export async function startAcceptance(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
  expectedChecklistIds: string[]
  currentImplementationRevision?: string
}): Promise<unknown> {
  if (input.run.phase !== 'ACCEPTANCE')
    throw new Error('acceptance requires ACCEPTANCE phase')
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'acceptance-validator',
    phase: 'ACCEPTANCE',
    revision: currentImplementationRevision(input.run),
    allowedPaths: [],
    contract: {
      taskIds: input.run.tasks.map(task => task.id),
      tasks: input.run.tasks.map(task => ({
        id: task.id,
        allowedPaths: task.allowedPaths,
        checklistIds: task.checklistIds,
      })),
      checklistIds: input.expectedChecklistIds,
    },
  })
}

export async function reconcileAcceptance(input: {
  run: DeliveryRun
  workspacePath?: string
  terminal: Extract<
    WorkerTerminalResult,
    { workerType: 'acceptance-validator' }
  >
  expectedChecklistIds?: string[]
  currentImplementationRevision?: string
}): Promise<DeliveryRun> {
  if (input.run.phase !== 'ACCEPTANCE')
    throw new Error('acceptance is not the active phase')
  if (input.terminal.revision !== currentImplementationRevision(input.run))
    throw new Error('acceptance evidence revision is stale')
  if (
    input.currentImplementationRevision &&
    input.terminal.revision !== input.currentImplementationRevision
  )
    throw new Error('acceptance evidence does not match the workspace')
  if (
    input.workspacePath &&
    !isWorkflowEvidenceFile(input.workspacePath, input.terminal.evidencePath)
  )
    throw new Error(
      'acceptance evidence file is missing or outside the project workspace',
    )
  const exact = (
    expected: string[] | undefined,
    actual: string[],
    label: string,
  ) => {
    if (expected === undefined) return
    if (
      expected.length !== actual.length ||
      expected.some(id => !actual.includes(id))
    )
      throw new Error(`acceptance does not cover every ${label}`)
  }
  exact(input.expectedChecklistIds, input.terminal.checklistIds, 'checklist')
  exact(
    input.run.tasks.map(task => task.id),
    input.terminal.validatedTaskIds,
    'task',
  )
  const knownTaskIds = new Set(input.run.tasks.map(task => task.id))
  if (
    input.terminal.findings.some(finding =>
      finding.taskIds.some(taskId => !knownTaskIds.has(taskId)),
    )
  )
    throw new Error('acceptance finding references an unknown task')
  const status =
    input.terminal.status === 'passed'
      ? 'passed'
      : input.terminal.status === 'failed'
        ? 'failed'
        : 'blocked'
  const evidence: EvidenceRef = {
    path: input.terminal.evidencePath,
    kind: 'acceptance',
    revision: currentImplementationRevision(input.run),
    status,
    observedAt: new Date().toISOString(),
  }
  return transitionDeliveryRun(
    input.run,
    input.terminal.status === 'passed'
      ? { type: 'acceptance_passed', evidence }
      : input.terminal.status === 'failed'
        ? { type: 'acceptance_failed', evidence }
        : { type: 'acceptance_blocked', evidence },
  )
}
