import { readFile } from 'node:fs/promises'
import type { BeeGameRequirementSourceType } from '../asset-contracts'
import { parseAtomicTask } from './schema'
import { isWorkflowEvidenceFile } from './evidence'
import { resolveWorkspaceRelativePath } from './revision'
import { transitionDeliveryRun } from './transition'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_DOCUMENT_ARTIFACTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type AtomicTask,
  type DeliveryRun,
} from './types'
import type { WorkerTerminalResult } from './worker-contracts'

export type AtomicTaskContractFacts = {
  resourceRequirementIds: string[]
  checklistIds: string[]
  importIds?: string[]
  compositionIds?: string[]
  runtimeAssetRoot?: string
  resourceBindings?: Array<{
    requirementId: string
    name?: string
    purpose?: string
    sourceType: BeeGameRequirementSourceType
    importIds: string[]
    compositionIds: string[]
    projectReferences: string[]
  }>
}

export type AtomicTaskPlanningDocument = {
  path: (typeof CANONICAL_PROJECT_DOCUMENTS)[number]
  content: string
}

export async function readAtomicTaskPlanningDocuments(
  workspacePath: string,
): Promise<AtomicTaskPlanningDocument[]> {
  return Promise.all(
    CANONICAL_PROJECT_DOCUMENTS.map(async path => {
      const absolutePath = resolveWorkspaceRelativePath(workspacePath, path)
      if (!absolutePath)
        throw new AtomicTaskPlanError(
          'scope',
          `canonical planning document is outside the workspace: ${path}`,
        )
      return { path, content: await readFile(absolutePath, 'utf8') }
    }),
  )
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
  const knownRequirements = new Set(facts.resourceRequirementIds)
  const knownChecklist = new Set(facts.checklistIds)
  const knownImports = new Set(facts.importIds ?? [])
  const knownCompositions = new Set(facts.compositionIds ?? [])
  const coveredRequirements = new Set(
    tasks.flatMap(task => task.resourceRequirementIds),
  )
  const coveredChecklist = new Set(tasks.flatMap(task => task.checklistIds))
  for (const id of coveredRequirements)
    if (!knownRequirements.has(id))
      throw new AtomicTaskPlanError(
        'coverage',
        `atomic task maps an unknown resource requirement: ${id}`,
      )
  for (const id of coveredChecklist)
    if (!knownChecklist.has(id))
      throw new AtomicTaskPlanError(
        'coverage',
        `atomic task maps an unknown checklist item: ${id}`,
      )
  for (const id of facts.resourceRequirementIds)
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
  for (const id of coveredImports)
    if (!knownImports.has(id))
      throw new AtomicTaskPlanError(
        'coverage',
        `atomic task maps an unknown resource import: ${id}`,
      )
  for (const id of coveredCompositions)
    if (!knownCompositions.has(id))
      throw new AtomicTaskPlanError(
        'coverage',
        `atomic task maps an unknown resource composition: ${id}`,
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
  assertUniqueOwners(tasks, 'resourceRequirementIds', 'resource requirement')
  assertUniqueOwners(tasks, 'checklistIds', 'checklist item')
  assertUniqueOwners(tasks, 'resourceImportIds', 'resource import')
  assertUniqueOwners(tasks, 'resourceCompositionIds', 'resource composition')
  assertSupportTasksFeedOwnedWork(tasks)
  const bindings = new Map(
    (facts.resourceBindings ?? []).map(binding => [
      binding.requirementId,
      binding,
    ]),
  )
  for (const task of tasks) {
    const allowedImports = new Set(
      task.resourceRequirementIds.flatMap(
        id => bindings.get(id)?.importIds ?? [],
      ),
    )
    const allowedCompositions = new Set(
      task.resourceRequirementIds.flatMap(
        id => bindings.get(id)?.compositionIds ?? [],
      ),
    )
    for (const id of task.resourceImportIds ?? [])
      if (!allowedImports.has(id))
        throw new AtomicTaskPlanError(
          'coverage',
          `atomic task ${task.id} assigns import ${id} outside its resource requirements`,
        )
    for (const id of task.resourceCompositionIds ?? [])
      if (!allowedCompositions.has(id))
        throw new AtomicTaskPlanError(
          'coverage',
          `atomic task ${task.id} assigns composition ${id} outside its resource requirements`,
        )
  }
  assertResourceFulfillment(tasks, facts)
}

function assertResourceFulfillment(
  tasks: AtomicTask[],
  facts: AtomicTaskContractFacts,
): void {
  const bindings = new Map(
    (facts.resourceBindings ?? []).map(binding => [
      binding.requirementId,
      binding,
    ]),
  )
  const runtimeAssetRoot = facts.runtimeAssetRoot
  const noAssetFileTypes = new Set<BeeGameRequirementSourceType>([
    'runtime-generated',
    'system-provided',
    'silent',
  ])
  for (const task of tasks) {
    const taskBindings = task.resourceRequirementIds.map(id => {
      const binding = bindings.get(id)
      if (!binding)
        throw new AtomicTaskPlanError(
          'coverage',
          `atomic task ${task.id} has no canonical resource binding for ${id}`,
        )
      return binding
    })
    const sourceTypes = new Set(taskBindings.map(binding => binding.sourceType))
    if (sourceTypes.size > 1)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} mixes resource fulfillment types: ${[...sourceTypes].join(', ')}`,
      )
    if (!runtimeAssetRoot) continue
    const runtimeArtifacts = task.expectedArtifacts.filter(artifact =>
      scopesPath(runtimeAssetRoot, artifact),
    )
    if (runtimeArtifacts.length && !taskBindings.length)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} creates runtime assets without owning a resource responsibility`,
      )
    const sourceType = taskBindings[0]?.sourceType
    if (sourceType === 'authored-asset' && !runtimeArtifacts.length)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} owns authored assets but declares no artifact under ${runtimeAssetRoot}`,
      )
    if (
      sourceType &&
      noAssetFileTypes.has(sourceType) &&
      runtimeArtifacts.length
    )
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} assigns asset files to ${sourceType} fulfillment: ${runtimeArtifacts.join(', ')}`,
      )
  }
}

function assertSupportTasksFeedOwnedWork(tasks: AtomicTask[]): void {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const ownedTaskIds = new Set(
    tasks
      .filter(
        task =>
          task.resourceRequirementIds.length > 0 ||
          task.checklistIds.length > 0 ||
          (task.resourceImportIds?.length ?? 0) > 0 ||
          (task.resourceCompositionIds?.length ?? 0) > 0,
      )
      .map(task => task.id),
  )
  const requiredSupportIds = new Set<string>()
  const visitDependencies = (taskId: string): void => {
    for (const dependencyId of byId.get(taskId)?.dependsOn ?? []) {
      if (requiredSupportIds.has(dependencyId)) continue
      requiredSupportIds.add(dependencyId)
      visitDependencies(dependencyId)
    }
  }
  for (const taskId of ownedTaskIds) visitDependencies(taskId)
  const detached = tasks
    .filter(
      task =>
        !ownedTaskIds.has(task.id) && !requiredSupportIds.has(task.id),
    )
    .map(task => task.id)
  if (detached.length)
    throw new AtomicTaskPlanError(
      'scope',
      `unowned atomic tasks must be prerequisites of owned work: ${detached.join(', ')}`,
    )
}

function assertUniqueOwners(
  tasks: AtomicTask[],
  field:
    | 'resourceRequirementIds'
    | 'checklistIds'
    | 'resourceImportIds'
    | 'resourceCompositionIds',
  label: string,
): void {
  const owners = new Map<string, string[]>()
  for (const task of tasks)
    for (const id of task[field] ?? [])
      owners.set(id, [...(owners.get(id) ?? []), task.id])
  const duplicates = [...owners]
    .filter(([, taskIds]) => taskIds.length > 1)
    .map(([id, taskIds]) => `${id} -> ${taskIds.join(', ')}`)
  if (duplicates.length)
    throw new AtomicTaskPlanError(
      'duplicate',
      `${label} must have exactly one owning atomic task: ${duplicates.join('; ')}`,
    )
}

function assertGraph(tasks: AtomicTask[]): void {
  const serviceOwnedPaths = [
    ...CANONICAL_DOCUMENT_ARTIFACTS,
    CANONICAL_ASSET_MANIFEST,
  ]
  const ids = new Set<string>()
  const artifactOwners = new Map<string, string[]>()
  for (const task of tasks) {
    if (task.expectedArtifacts.length > 8)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} exceeds the 8-artifact atomicity limit`,
      )
    if (task.verification.length > 9)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} exceeds the 9-verification atomicity limit`,
      )
    if (!task.expectedArtifacts.length)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} must declare at least one expected artifact`,
      )
    const unreachableArtifact = task.expectedArtifacts.find(
      artifact =>
        !task.allowedPaths.some(scope => scopesPath(scope, artifact)),
    )
    if (unreachableArtifact)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} cannot write expected artifact outside its allowed paths: ${unreachableArtifact}`,
      )
    const forbiddenScope = [
      ...task.allowedPaths,
      ...task.expectedArtifacts,
    ].find(path => serviceOwnedPaths.some(owned => scopesPath(path, owned)))
    if (forbiddenScope)
      throw new AtomicTaskPlanError(
        'scope',
        `atomic task ${task.id} assigns a workflow-owned canonical artifact to implementation: ${forbiddenScope}`,
      )
    if (ids.has(task.id))
      throw new AtomicTaskPlanError(
        'duplicate',
        `duplicate atomic task id: ${task.id}`,
      )
    ids.add(task.id)
    const taskArtifacts = new Set<string>()
    for (const artifact of task.expectedArtifacts) {
      if (taskArtifacts.has(artifact))
        throw new AtomicTaskPlanError(
          'duplicate',
          `atomic task ${task.id} repeats expected artifact: ${artifact}`,
        )
      taskArtifacts.add(artifact)
      artifactOwners.set(artifact, [
        ...(artifactOwners.get(artifact) ?? []),
        task.id,
      ])
    }
    try {
      parseAtomicTask(task)
    } catch {
      throw new AtomicTaskPlanError(
        'schema',
        `invalid atomic task contract: ${task.id}`,
      )
    }
  }
  const dependsTransitively = (taskId: string, dependencyId: string): boolean => {
    const pending = [...(tasks.find(task => task.id === taskId)?.dependsOn ?? [])]
    const visitedDependencies = new Set<string>()
    while (pending.length) {
      const candidate = pending.pop()!
      if (candidate === dependencyId) return true
      if (visitedDependencies.has(candidate)) continue
      visitedDependencies.add(candidate)
      pending.push(
        ...(tasks.find(task => task.id === candidate)?.dependsOn ?? []),
      )
    }
    return false
  }
  const parallelArtifacts = [...artifactOwners].flatMap(
    ([artifact, taskIds]) => {
      for (let leftIndex = 0; leftIndex < taskIds.length; leftIndex += 1)
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < taskIds.length;
          rightIndex += 1
        ) {
          const left = taskIds[leftIndex]!
          const right = taskIds[rightIndex]!
          if (
            !dependsTransitively(left, right) &&
            !dependsTransitively(right, left)
          )
            return [`${artifact} -> ${left}, ${right}`]
        }
      return []
    },
  )
  if (parallelArtifacts.length)
    throw new AtomicTaskPlanError(
      'duplicate',
      `expected artifact has parallel atomic task owners: ${parallelArtifacts.join('; ')}`,
    )
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

function scopesPath(scope: string, target: string): boolean {
  const normalizedScope = normalizePath(scope)
  const normalizedTarget = normalizePath(target)
  return (
    normalizedScope === normalizedTarget ||
    normalizedTarget.startsWith(`${normalizedScope}/`) ||
    normalizedScope.startsWith(`${normalizedTarget}/`)
  )
}

function normalizePath(value: string): string {
  let result = value.replaceAll('\\', '/')
  while (result.startsWith('./')) result = result.slice(2)
  while (result.endsWith('/')) result = result.slice(0, -1)
  return result
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
  validateAtomicTaskGraph(tasks, facts)
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

export function validateAtomicTaskGraph(
  tasks: AtomicTask[],
  facts: AtomicTaskContractFacts,
): void {
  if (!tasks.length)
    throw new AtomicTaskPlanError('scope', 'atomic task graph cannot be empty')
  assertGraph(tasks)
  assertCoverage(tasks, facts)
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
