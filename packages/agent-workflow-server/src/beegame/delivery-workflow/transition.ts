import { parseDeliveryRun } from './schema'
import { retryFoundationFailures } from './foundation-authoring-batch'
import type {
  AtomicTask,
  DeliveryRun,
  EvidenceRef,
  EvidenceStatus,
  FoundationRevisionTask,
} from './types'
import type { FoundationAuditTask } from './foundation-audit-state'

export class WorkflowTransitionError extends Error {
  constructor(
    readonly code: 'invalid_transition' | 'invariant_violation',
    message: string,
  ) {
    super(message)
    this.name = 'WorkflowTransitionError'
  }
}

type EvidenceEvent = { evidence: EvidenceRef }

export type DeliveryTransition =
  | { type: 'documents_ready' }
  | ({
      type: 'resource_preparation_ready'
      resourceRevision: string
    } & EvidenceEvent)
  | ({
      type: 'resource_preparation_needs_action'
      reason: string
    } & EvidenceEvent)
  | { type: 'resource_preparation_required'; reason?: string }
  | { type: 'tasks_planned'; tasks: AtomicTask[] }
  | { type: 'task_started'; taskId: string; revision: string }
  | {
      type: 'task_completed'
      taskId: string
      revision: string
      evidenceRefs: string[]
    }
  | { type: 'task_failed'; taskId: string; reason: string }
  | ({
      type:
        | 'implementation_audit_passed'
        | 'implementation_audit_failed'
        | 'implementation_audit_blocked'
    } & EvidenceEvent)
  | ({
      type: 'acceptance_passed' | 'acceptance_failed' | 'acceptance_blocked'
    } & EvidenceEvent)
  | { type: 'delivery_completed' }
  | { type: 'stop'; reason: string }
  | { type: 'retry'; taskId?: string }

const timestamp = () => new Date().toISOString()

const FOUNDATION_MODEL_CONFIGURATION_FAILURES = new Set([
  'foundation fact fast model is not configured',
  'foundation fact extractor fast model is not configured',
  'foundation semantic fast model is not configured',
  'foundation semantic balanced model is not configured',
  'foundation semantic strong model is not configured',
  'foundation semantic model is not configured',
])

type FoundationRetryTask = FoundationAuditTask | FoundationRevisionTask

function isEligibleFoundationRetryTask(
  task: FoundationRetryTask,
  taskId: string | undefined,
): boolean {
  const value = task as FoundationRetryTask & {
    receiptPath?: unknown
    receiptDigest?: unknown
    resultDigest?: unknown
    resultPath?: unknown
    receipt?: unknown
    result?: unknown
    admittedResult?: unknown
  }
  return (
    (!taskId || task.taskId === taskId) &&
    task.status === 'needs_action' &&
    task.attempt === 0 &&
    FOUNDATION_MODEL_CONFIGURATION_FAILURES.has(task.failureReason ?? '') &&
    task.dispatch === undefined &&
    task.terminalDigest === undefined &&
    task.usage === undefined &&
    task.durationMs === undefined &&
    value.receiptPath === undefined &&
    value.receiptDigest === undefined &&
    value.resultDigest === undefined &&
    value.resultPath === undefined &&
    value.receipt === undefined &&
    value.result === undefined &&
    value.admittedResult === undefined
  )
}

function fail(message: string): never {
  throw new WorkflowTransitionError('invalid_transition', message)
}

function assertTaskGraph(tasks: AtomicTask[]): void {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id))
      throw new WorkflowTransitionError(
        'invariant_violation',
        `duplicate atomic task id: ${task.id}`,
      )
    ids.add(task.id)
    if (!task.expectedArtifacts.length)
      throw new WorkflowTransitionError(
        'invariant_violation',
        `task ${task.id} has no expected artifact`,
      )
    if (!task.allowedPaths.length)
      throw new WorkflowTransitionError(
        'invariant_violation',
        `task ${task.id} has no allowed paths`,
      )
    if (!task.verification.length)
      throw new WorkflowTransitionError(
        'invariant_violation',
        `task ${task.id} has no verification`,
      )
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency))
        throw new WorkflowTransitionError(
          'invariant_violation',
          `task ${task.id} depends on unknown task ${dependency}`,
        )
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new WorkflowTransitionError(
        'invariant_violation',
        'atomic task graph contains a cycle',
      )
    if (visited.has(id)) return
    visiting.add(id)
    const task = tasks.find(candidate => candidate.id === id)
    for (const dependency of task?.dependsOn ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks) visit(task.id)
}

export function assertDeliveryRunInvariants(run: DeliveryRun): DeliveryRun {
  parseDeliveryRun(run)
  assertTaskGraph(run.tasks)
  if (
    run.activeTaskId &&
    !run.tasks.some(task => task.id === run.activeTaskId)
  ) {
    throw new WorkflowTransitionError(
      'invariant_violation',
      `active task does not exist: ${run.activeTaskId}`,
    )
  }
  if (run.activeDispatch && run.activeDispatch.phase !== run.phase) {
    throw new WorkflowTransitionError(
      'invariant_violation',
      'active dispatch phase does not match run phase',
    )
  }
  if (run.status === 'completed' && run.phase !== 'DELIVERY') {
    throw new WorkflowTransitionError(
      'invariant_violation',
      'only DELIVERY can be completed',
    )
  }
  for (const task of run.tasks) {
    if (
      task.status === 'completed' &&
      (!task.completedRevision || task.evidenceRefs.length === 0)
    ) {
      throw new WorkflowTransitionError(
        'invariant_violation',
        `completed task ${task.id} has no current evidence`,
      )
    }
  }
  return run
}

function withEvidence(
  run: DeliveryRun,
  key: 'resourcePreparation' | 'implementationAudit' | 'acceptance',
  evidence: EvidenceRef,
): DeliveryRun {
  return {
    ...run,
    evidence: { ...run.evidence, [key]: evidence },
    updatedAt: timestamp(),
  }
}

function requirePhase(run: DeliveryRun, phase: DeliveryRun['phase']): void {
  if (run.phase !== phase)
    fail(`transition requires ${phase}, current phase is ${run.phase}`)
}

function requireEvidence(
  evidence: EvidenceRef,
  revision: string,
  statuses: readonly EvidenceStatus[],
): void {
  if (evidence.revision !== revision)
    fail('evidence revision does not match current run revision')
  if (!statuses.includes(evidence.status))
    fail(`evidence status ${evidence.status} is not valid for this transition`)
}

function enterResourcePreparation(
  run: DeliveryRun,
  options: { reason?: string } = {},
): DeliveryRun {
  return {
    ...run,
    phase: 'RESOURCE_PREPARATION',
    documentStep: undefined,
    status: 'running',
    activeTaskId: undefined,
    activeDispatch: undefined,
    blockedReason: options.reason,
    revision: {
      ...run.revision,
      resource: undefined,
      implementation: undefined,
    },
    tasks: [],
    evidence: {},
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    updatedAt: timestamp(),
  }
}

export function transitionDeliveryRun(
  input: DeliveryRun,
  event: DeliveryTransition,
): DeliveryRun {
  const run = assertDeliveryRunInvariants(input)
  let next: DeliveryRun
  switch (event.type) {
    case 'documents_ready':
      requirePhase(run, 'BRIEF_CONFIRMED')
      next = {
        ...run,
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        foundationDraftState: { completedPaths: [] },
        updatedAt: timestamp(),
      }
      break
    case 'resource_preparation_ready':
      requirePhase(run, 'RESOURCE_PREPARATION')
      requireEvidence(event.evidence, event.resourceRevision, ['passed'])
      next = {
        ...withEvidence(run, 'resourcePreparation', event.evidence),
        revision: { ...run.revision, resource: event.resourceRevision },
        phase: 'ATOMIC_TASK_PLANNING',
        documentStep: undefined,
        status: 'running',
        blockedReason: undefined,
        resourceProductionState: {
          ...run.resourceProductionState,
          currentTask: 'RESOURCE_GATE',
        },
      }
      break
    case 'resource_preparation_needs_action':
      requirePhase(run, 'RESOURCE_PREPARATION')
      requireEvidence(event.evidence, event.evidence.revision, [
        'failed',
        'blocked',
      ])
      next = {
        ...withEvidence(run, 'resourcePreparation', event.evidence),
        status: 'needs_action',
        blockedReason: event.reason,
      }
      break
    case 'resource_preparation_required': {
      next = enterResourcePreparation(run, { reason: event.reason })
      break
    }
    case 'tasks_planned':
      requirePhase(run, 'ATOMIC_TASK_PLANNING')
      if (
        !run.revision.resource ||
        run.evidence.resourcePreparation?.status !== 'passed' ||
        run.evidence.resourcePreparation.revision !== run.revision.resource
      )
        fail('task planning requires passed resource-content evidence')
      assertTaskGraph(event.tasks)
      if (!event.tasks.length) fail('atomic task graph must not be empty')
      next = {
        ...run,
        tasks: event.tasks,
        phase: 'IMPLEMENTATION',
        activeTaskId: undefined,
        updatedAt: timestamp(),
      }
      break
    case 'task_started': {
      requirePhase(run, 'IMPLEMENTATION')
      const task = run.tasks.find(candidate => candidate.id === event.taskId)
      if (!task) fail(`unknown task ${event.taskId}`)
      if (task.status !== 'pending' && task.status !== 'failed')
        fail(`task ${event.taskId} is not runnable`)
      const dependencies = run.tasks.filter(candidate =>
        task.dependsOn.includes(candidate.id),
      )
      if (dependencies.some(candidate => candidate.status !== 'completed'))
        fail(`task ${event.taskId} has incomplete dependencies`)
      if (run.activeTaskId)
        fail('another implementation task is already active')
      next = {
        ...run,
        activeTaskId: task.id,
        tasks: run.tasks.map(candidate =>
          candidate.id === task.id
            ? {
                ...candidate,
                status: 'running',
                attempt: candidate.attempt + 1,
                startedRevision: event.revision,
              }
            : candidate,
        ),
        updatedAt: timestamp(),
      }
      break
    }
    case 'task_completed': {
      requirePhase(run, 'IMPLEMENTATION')
      if (run.activeTaskId !== event.taskId)
        fail(`task ${event.taskId} is not the active task`)
      const task = run.tasks.find(candidate => candidate.id === event.taskId)
      if (!task || task.status !== 'running')
        fail(`task ${event.taskId} is not running`)
      if (!event.revision || event.revision === 'uncomputed')
        fail('task evidence revision is missing')
      if (!event.evidenceRefs.length)
        fail('task completion requires evidence references')
      next = {
        ...run,
        activeTaskId: undefined,
        tasks: run.tasks.map(candidate =>
          candidate.id === event.taskId
            ? {
                ...candidate,
                status: 'completed',
                completedRevision: event.revision,
                evidenceRefs: event.evidenceRefs,
              }
            : candidate,
        ),
        revision: {
          ...run.revision,
          implementation: event.revision,
          workspace: event.revision,
        },
        updatedAt: timestamp(),
      }
      break
    }
    case 'task_failed':
      requirePhase(run, 'IMPLEMENTATION')
      if (!run.tasks.some(candidate => candidate.id === event.taskId))
        fail(`unknown task ${event.taskId}`)
      next = {
        ...run,
        activeTaskId: undefined,
        status: 'failed',
        blockedReason: event.reason,
        tasks: run.tasks.map(candidate =>
          candidate.id === event.taskId
            ? { ...candidate, status: 'failed' }
            : candidate,
        ),
        updatedAt: timestamp(),
      }
      break
    case 'implementation_audit_passed':
      requirePhase(run, 'IMPLEMENTATION_AUDIT')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['passed'],
      )
      next = {
        ...withEvidence(run, 'implementationAudit', event.evidence),
        phase: 'ACCEPTANCE',
      }
      break
    case 'implementation_audit_failed':
      requirePhase(run, 'IMPLEMENTATION_AUDIT')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['failed'],
      )
      next = {
        ...withEvidence(run, 'implementationAudit', event.evidence),
        phase: 'IMPLEMENTATION',
      }
      break
    case 'implementation_audit_blocked':
      requirePhase(run, 'IMPLEMENTATION_AUDIT')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['blocked'],
      )
      next = {
        ...withEvidence(run, 'implementationAudit', event.evidence),
        status: 'needs_action',
        blockedReason: 'implementation audit is blocked and requires attention',
      }
      break
    case 'acceptance_passed':
      requirePhase(run, 'ACCEPTANCE')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['passed'],
      )
      next = {
        ...withEvidence(run, 'acceptance', event.evidence),
        phase: 'DELIVERY',
      }
      break
    case 'acceptance_failed':
      requirePhase(run, 'ACCEPTANCE')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['failed'],
      )
      next = {
        ...withEvidence(run, 'acceptance', event.evidence),
        phase: 'IMPLEMENTATION',
      }
      break
    case 'acceptance_blocked':
      requirePhase(run, 'ACCEPTANCE')
      requireEvidence(
        event.evidence,
        run.revision.implementation ?? run.revision.workspace,
        ['blocked'],
      )
      next = {
        ...withEvidence(run, 'acceptance', event.evidence),
        status: 'needs_action',
        blockedReason: 'runtime acceptance is blocked and requires attention',
      }
      break
    case 'delivery_completed':
      requirePhase(run, 'DELIVERY')
      if (run.evidence.acceptance?.status !== 'passed')
        fail('delivery requires passed acceptance evidence')
      {
        const completedAt = timestamp()
        next = {
          ...run,
          status: 'completed',
          completedAt,
          updatedAt: completedAt,
        }
      }
      break
    case 'stop':
      if (run.status === 'completed')
        fail('completed delivery cannot be stopped')
      next = {
        ...run,
        status: 'stopped',
        currentMessage: undefined,
        thinking: 'idle',
        ...(run.phase === 'IMPLEMENTATION' && run.activeTaskId
          ? {
              activeTaskId: undefined,
              tasks: run.tasks.map(task =>
                task.id === run.activeTaskId && task.status === 'running'
                  ? { ...task, status: 'pending' as const }
                  : task,
              ),
            }
          : {}),
        blockedReason: event.reason,
        updatedAt: timestamp(),
      }
      break
    case 'retry':
      if (
        run.status !== 'needs_action' &&
        run.status !== 'blocked' &&
        run.status !== 'stopped' &&
        run.status !== 'failed'
      )
        fail('only actionable, blocked, stopped or failed runs can be retried')
      if (
        run.phase === 'IMPLEMENTATION' &&
        event.taskId &&
        !run.tasks.some(
          task => task.id === event.taskId && task.status === 'failed',
        )
      )
        fail('retry task must be a failed task')
      {
        const now = timestamp()
        const revisionState =
          run.phase === 'DOCUMENT_REVIEW' &&
          run.foundationRevisionState?.status !== 'completed'
            ? run.foundationRevisionState
            : undefined
        const auditState =
          run.phase === 'DOCUMENT_REVIEW' && !revisionState
            ? run.foundationAuditState
            : undefined
        let auditRevived = false
        let auditRefreshPhase = false
        let auditRefreshDeep = false
        const nextAuditState = auditState
          ? {
              ...auditState,
              tasks: auditState.tasks.map(task => {
                if (
                  !isEligibleFoundationRetryTask(task, event.taskId) ||
                  !['document-facts', 'semantic', 'confirmation'].includes(
                    task.kind,
                  )
                )
                  return task
                auditRevived = true
                if (task.kind === 'document-facts' || task.kind === 'semantic')
                  auditRefreshPhase = true
                else auditRefreshDeep = true
                return {
                  ...task,
                  status: 'pending' as const,
                  failureReason: undefined,
                }
              }),
              ...(auditRefreshPhase ? { phaseStartedAt: now } : {}),
              ...(auditRefreshDeep && auditState.semantic
                ? {
                    semantic: {
                      ...auditState.semantic,
                      deepPhaseStartedAt: now,
                    },
                  }
                : {}),
            }
          : undefined
        let revisionRevived = false
        const nextRevisionState = revisionState
          ? {
              ...revisionState,
              tasks: revisionState.tasks.map(task => {
                if (
                  !isEligibleFoundationRetryTask(task, event.taskId) ||
                  !['impacted-facts', 'semantic-recheck'].includes(task.kind)
                )
                  return task
                revisionRevived = true
                return {
                  ...task,
                  status: 'pending' as const,
                  failureReason: undefined,
                }
              }),
              ...(revisionRevived
                ? {
                    status: 'running' as const,
                    phaseStartedAt: now,
                    roundDeadlineAt: new Date(
                      Date.parse(now) + 600_000,
                    ).toISOString(),
                  }
                : {}),
            }
          : undefined
        const foundationStateInCurrentPhase = !!(
          auditState?.tasks.some(task => task.status === 'needs_action') ||
          revisionState?.status === 'needs_action' ||
          revisionState?.tasks.some(task => task.status === 'needs_action')
        )
        const foundationRevived = auditRevived || revisionRevived
        const preserveFoundationActionableState =
          foundationStateInCurrentPhase && !foundationRevived
        next = {
          ...run,
          status: preserveFoundationActionableState ? run.status : 'running',
          ...(auditRevived ? { foundationAuditState: nextAuditState } : {}),
          ...(revisionRevived
            ? { foundationRevisionState: nextRevisionState }
            : {}),
          ...(run.phase === 'DOCUMENT_DRAFTING' &&
          run.foundationDraftState.documents
            ? {
                foundationDraftState: retryFoundationFailures(
                  run.foundationDraftState,
                ),
              }
            : {}),
          ...(run.phase === 'IMPLEMENTATION' && run.activeTaskId
            ? {
                activeTaskId: undefined,
                tasks: run.tasks.map(task =>
                  task.id === run.activeTaskId && task.status === 'running'
                    ? { ...task, status: 'pending' as const }
                    : task,
                ),
              }
            : {}),
          blockedReason: preserveFoundationActionableState
            ? run.blockedReason
            : undefined,
          updatedAt: timestamp(),
        }
      }
      break
    default:
      return event satisfies never
  }
  return assertDeliveryRunInvariants(next)
}
