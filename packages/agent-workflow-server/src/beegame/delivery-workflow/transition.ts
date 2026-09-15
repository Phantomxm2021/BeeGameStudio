import { RETIRED_FOUNDATION_AUTHOR } from './retired-foundation-author'
import { assertNoRetiredFoundationReviewRun } from './retired-foundation-review'
import { parseDeliveryRun } from './schema'
import { isPublicStageActive } from './public-stage-routing'
import type {
ImplementationTask,
DeliveryRun,
EvidenceRef,
EvidenceStatus,
} from './types'

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
  | { type: 'task_started'; taskId: string; revision: string }
  | {
      type: 'task_completed'
      taskId: string
      revision: string
      evidenceRefs: string[]
    }
  | { type: 'task_failed'; taskId: string; reason: string }
  | ({
      type: 'acceptance_passed' | 'acceptance_failed' | 'acceptance_blocked'
    } & EvidenceEvent)
  | { type: 'delivery_completed' }
  | { type: 'stop'; reason: string }
  | { type: 'retry'; taskId?: string }

const timestamp = () => new Date().toISOString()

function fail(message: string): never {
  throw new WorkflowTransitionError('invalid_transition', message)
}

function assertDirectImplementationTask(tasks: ImplementationTask[]): void {
  if (tasks.length > 1 || (tasks[0] && tasks[0].id !== 'DIRECT_IMPLEMENTATION'))
    throw new WorkflowTransitionError(
      'invariant_violation',
      'implementation must use the single direct implementation task',
    )
  if (tasks[0] && !tasks[0].allowedPaths.length)
    throw new WorkflowTransitionError(
      'invariant_violation',
      'direct implementation task has no allowed paths',
    )
}

export function assertDeliveryRunInvariants(run: DeliveryRun): DeliveryRun {
  parseDeliveryRun(run)
  assertDirectImplementationTask(run.tasks)
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
  key: 'resourcePreparation' | 'acceptance',
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
    // Keep the published IR binding while restarting resource production.
    resourceProductionState: {
      currentTask: 'RESOURCE_DELIVERY',
      irResultId: run.resourceProductionState.irResultId,
    },
    updatedAt: timestamp(),
  }
}

export function transitionDeliveryRun(
  input: DeliveryRun,
  event: DeliveryTransition,
): DeliveryRun {
  const run = assertDeliveryRunInvariants(input)
  if (isPublicStageActive(run)) fail('Public document stages must be controlled through their stage ports')
  assertNoRetiredFoundationReviewRun(run)
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
        // Resource readiness is the input to the single implementation turn.
        phase: 'IMPLEMENTATION',
        documentStep: undefined,
        status: 'running',
        blockedReason: undefined,
        resourceProductionState: {
          ...run.resourceProductionState,
          currentTask: 'RESOURCE_DELIVERED',
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
    case 'task_started': {
      requirePhase(run, 'IMPLEMENTATION')
      const task = run.tasks.find(candidate => candidate.id === event.taskId)
      if (!task) fail(`unknown task ${event.taskId}`)
      if (task.status !== 'pending' && task.status !== 'failed')
        fail(`task ${event.taskId} is not runnable`)
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
        status: 'needs_action',
        blockedReason: 'runtime acceptance found issues that require attention',
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
      if (run.phase === 'DOCUMENT_DRAFTING') fail(RETIRED_FOUNDATION_AUTHOR)
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
        if (
          run.phase === 'ACCEPTANCE' &&
          run.evidence.acceptance?.status === 'failed'
        ) {
          next = {
            ...run,
            phase: 'IMPLEMENTATION',
            status: 'running',
            activeTaskId: undefined,
            activeDispatch: undefined,
            blockedReason: `Runtime acceptance failed; inspect ${run.evidence.acceptance.path}`,
            revision: { ...run.revision, implementation: undefined },
            evidence: { ...run.evidence, acceptance: undefined },
            tasks: run.tasks.map(task => ({
              ...task,
              status: 'pending' as const,
              startedRevision: undefined,
              completedRevision: undefined,
              evidenceRefs: [],
            })),
            updatedAt: timestamp(),
          }
          break
        }
        next = {
          ...run,
          status: 'running',
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
          // Direct CLI retries need the host's deterministic rejection reason
          // in the next prompt. It is cleared by successful completion.
          blockedReason:
            run.phase === 'RESOURCE_PREPARATION' ||
            run.phase === 'IMPLEMENTATION'
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
