import { parseAtomicTask } from './schema'
import { isWorkflowEvidenceFile } from './evidence'
import { transitionDeliveryRun } from './transition'
import type { AtomicTask, DeliveryRun } from './types'
import type { WorkerTerminalResult } from './worker-contracts'

export type AtomicTaskContractFacts = {
  requirementIds: string[]
  checklistIds: string[]
  importIds?: string[]
  compositionIds?: string[]
}

export class AtomicTaskPlanError extends Error {
  constructor(
    readonly code: 'coverage' | 'duplicate' | 'cycle' | 'scope' | 'schema',
    message: string,
  ) {
    super(message)
    this.name = 'AtomicTaskPlanError'
  }
}

function assertCoverage(
  tasks: AtomicTask[],
  facts: AtomicTaskContractFacts,
): void {
  const coveredRequirements = new Set(
    tasks.flatMap(task => task.sourceRequirementIds),
  )
  const coveredChecklist = new Set(tasks.flatMap(task => task.checklistIds))
  for (const id of facts.requirementIds)
    if (!coveredRequirements.has(id))
      throw new AtomicTaskPlanError(
        'coverage',
        `requirement is not mapped to an atomic task: ${id}`,
      )
  for (const id of facts.checklistIds)
    if (!coveredChecklist.has(id))
      throw new AtomicTaskPlanError(
        'coverage',
        `checklist item is not mapped to an atomic task: ${id}`,
      )
  const coveredImports = new Set(
    tasks.flatMap(task => task.resourceImportIds ?? []),
  )
  const coveredCompositions = new Set(
    tasks.flatMap(task => task.resourceCompositionIds ?? []),
  )
  for (const id of facts.importIds ?? [])
    if (!coveredImports.has(id))
      throw new AtomicTaskPlanError(
        'coverage',
        `resource import is not mapped to an atomic task: ${id}`,
      )
  for (const id of facts.compositionIds ?? [])
    if (!coveredCompositions.has(id))
      throw new AtomicTaskPlanError(
        'coverage',
        `resource composition is not mapped to an atomic task: ${id}`,
      )
}

function assertGraph(tasks: AtomicTask[]): void {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (task.sourceRequirementIds.length !== 1)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} must map to exactly one source requirement`,
      )
    if (!task.expectedArtifacts.length)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} must declare at least one expected artifact`,
      )
    if (ids.has(task.id))
      throw new AtomicTaskPlanError(
        'duplicate',
        `duplicate atomic task id: ${task.id}`,
      )
    ids.add(task.id)
    try {
      parseAtomicTask(task)
    } catch {
      throw new AtomicTaskPlanError(
        'schema',
        `invalid atomic task contract: ${task.id}`,
      )
    }
  }
  for (const task of tasks)
    for (const dependency of task.dependsOn)
      if (!ids.has(dependency))
        throw new AtomicTaskPlanError(
          'cycle',
          `unknown dependency ${dependency}`,
        )
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new AtomicTaskPlanError(
        'cycle',
        'atomic task graph contains a cycle',
      )
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of tasks.find(task => task.id === id)?.dependsOn ??
      [])
      visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks) visit(task.id)
}

export function buildAtomicTaskGraph(
  terminal: Extract<
    WorkerTerminalResult,
    { workerType: 'atomic-task-planner' }
  >,
  facts: AtomicTaskContractFacts,
): AtomicTask[] {
  const tasks = [...terminal.tasks].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
  if (!tasks.length)
    throw new AtomicTaskPlanError('scope', 'atomic task graph cannot be empty')
  assertGraph(tasks)
  assertCoverage(tasks, facts)
  if (
    tasks.some(
      task =>
        task.status !== 'pending' ||
        task.attempt !== 0 ||
        task.startedRevision ||
        task.completedRevision ||
        task.evidenceRefs.length > 0,
    )
  ) {
    throw new AtomicTaskPlanError(
      'scope',
      'atomic task plans must start with pending tasks and no implementation evidence',
    )
  }
  return tasks
}

export function applyAtomicTaskPlan(input: {
  run: DeliveryRun
  terminal: Extract<WorkerTerminalResult, { workerType: 'atomic-task-planner' }>
  facts: AtomicTaskContractFacts
  workspacePath?: string
}): DeliveryRun {
  const tasks = buildAtomicTaskGraph(input.terminal, input.facts)
  if (input.run.phase !== 'ATOMIC_TASK_PLANNING')
    throw new AtomicTaskPlanError(
      'scope',
      'task planning is not the active phase',
    )
  if (
    input.workspacePath &&
    !isWorkflowEvidenceFile(input.workspacePath, input.terminal.evidencePath)
  )
    throw new AtomicTaskPlanError(
      'scope',
      'task planning evidence file is missing or outside the workflow evidence directory',
    )
  return transitionDeliveryRun(input.run, { type: 'tasks_planned', tasks })
}
