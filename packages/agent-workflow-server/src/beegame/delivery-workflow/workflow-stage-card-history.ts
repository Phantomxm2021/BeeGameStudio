import {
  DELIVERY_PROGRESS_STAGES,
  projectDeliveryProgress,
  type DeliveryProgressStage,
  type DeliveryProgressSubstage,
} from './display-progress'
import { DELIVERY_PHASES } from './schema'
import {
  projectAssetDisplayTasks,
  projectDocumentDisplayTasks,
  projectReviewFindingDisplayItems,
  type DocumentDisplayTask,
} from './document-display-tasks'
import { openDocumentReviewFindings } from './document-review-findings'
import { sanitizeWorkflowDisplayMessage } from './workflow-display-message'
import type {
  DeliveryRun,
  DeliveryRunStatus,
  DocumentReviewCheckId,
  DocumentWorkflowStep,
  ResourceProductionTask,
  WorkflowEvent,
} from './types'

export type WorkflowStageCardTask = {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'stopped'
  operation?: 'write' | 'review' | 'produce' | 'assemble'
  attempt?: number
  failureReason?: string
}

export type WorkflowStageCardSnapshot = {
  stageId: DeliveryProgressStage
  phaseIndex: number
  phaseCount: number
  status: DeliveryRunStatus
  currentPhase: string
  substage?: DeliveryProgressSubstage
  convergencePass?: number
  documentStep?: string
  reviewMode?: 'initial' | 'closure'
  reviewTarget?: 'foundation' | 'checklist' | 'resource'
  thinking?: 'working' | 'waiting' | 'idle'
  worker?: string
  message?: string
  executionStatus?: string
  currentItemId?: string
  tasks: WorkflowStageCardTask[]
  completedTaskCount: number
  totalTaskCount: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  elapsedMs: number
  activeSince?: string
  block?: { message: string; nextAction?: string }
}

export type FrozenWorkflowStageCardEvent = WorkflowEvent & {
  stageSnapshot: WorkflowStageCardSnapshot
}

export type WorkflowStageCardTiming = {
  /** The stage's semantic start boundary. Defaults to the run's creation. */
  stageStartedAt?: string
  /** The end used to calculate a snapshot's elapsed time. */
  stageEndedAt?: string
  /** Current wall-clock time used for a live card's elapsed time. */
  now?: string
  /** A precomputed elapsed value from the durable event journal. */
  elapsedMs?: number
  /** A durable running interval start, when one is known. */
  activeSince?: string
  /** Events used to calculate active intervals when elapsedMs is absent. */
  events?: readonly WorkflowEvent[]
}

const DELIVERY_RUN_STATUSES: readonly DeliveryRunStatus[] = [
  'running',
  'needs_action',
  'blocked',
  'completed',
  'failed',
  'stopped',
]

const TASK_STATUSES: readonly WorkflowStageCardTask['status'][] = [
  'pending',
  'running',
  'completed',
  'failed',
  'blocked',
  'stopped',
]

const TASK_OPERATIONS: readonly NonNullable<
  WorkflowStageCardTask['operation']
>[] = ['write', 'review', 'produce', 'assemble']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function finiteDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function validTask(value: unknown): value is WorkflowStageCardTask {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || !value.id.trim()) return false
  if (typeof value.title !== 'string' || !value.title.trim()) return false
  if (!TASK_STATUSES.includes(value.status as WorkflowStageCardTask['status']))
    return false
  if (
    value.operation !== undefined &&
    !TASK_OPERATIONS.includes(
      value.operation as NonNullable<WorkflowStageCardTask['operation']>,
    )
  )
    return false
  if (value.attempt !== undefined && !nonnegativeInteger(value.attempt))
    return false
  if (
    value.failureReason !== undefined &&
    (typeof value.failureReason !== 'string' || !value.failureReason.trim())
  )
    return false
  return true
}

/**
 * Runtime validation for the durable card contract. This deliberately uses
 * only semantic stage identity and field structure; card copy is never parsed
 * to recover a stage.
 */
export function isWorkflowStageCardSnapshot(
  value: unknown,
): value is WorkflowStageCardSnapshot {
  if (!isRecord(value)) return false
  const stageId = value.stageId as DeliveryProgressStage
  if (!DELIVERY_PROGRESS_STAGES.includes(stageId)) return false
  if (
    value.phaseIndex !== DELIVERY_PROGRESS_STAGES.indexOf(stageId) + 1 ||
    value.phaseCount !== DELIVERY_PROGRESS_STAGES.length
  )
    return false
  if (!DELIVERY_RUN_STATUSES.includes(value.status as DeliveryRunStatus))
    return false
  if (typeof value.currentPhase !== 'string' || !value.currentPhase.trim())
    return false
  if (
    value.substage !== undefined &&
    ![
      'INITIAL_DRAFTING',
      'INITIAL_REVIEW',
      'REPAIR_PLANNING',
      'REPAIRING',
      'CLOSURE_REVIEW',
      'CHECKLIST_DRAFTING',
      'CHECKLIST_REVIEW',
    ].includes(value.substage as DeliveryProgressSubstage)
  )
    return false
  if (
    value.convergencePass !== undefined &&
    (typeof value.convergencePass !== 'number' ||
      !Number.isInteger(value.convergencePass) ||
      value.convergencePass <= 0)
  )
    return false
  if (
    value.documentStep !== undefined &&
    (typeof value.documentStep !== 'string' || !value.documentStep.trim())
  )
    return false
  if (
    value.reviewMode !== undefined &&
    value.reviewMode !== 'initial' &&
    value.reviewMode !== 'closure'
  )
    return false
  if (
    value.reviewTarget !== undefined &&
    value.reviewTarget !== 'foundation' &&
    value.reviewTarget !== 'checklist' &&
    value.reviewTarget !== 'resource'
  )
    return false
  if (
    value.thinking !== undefined &&
    value.thinking !== 'working' &&
    value.thinking !== 'waiting' &&
    value.thinking !== 'idle'
  )
    return false
  for (const field of ['worker', 'message', 'executionStatus', 'currentItemId'])
    if (value[field] !== undefined && typeof value[field] !== 'string')
      return false
  if (!Array.isArray(value.tasks) || value.tasks.some(task => !validTask(task)))
    return false
  if (!nonnegativeInteger(value.completedTaskCount)) return false
  if (!nonnegativeInteger(value.totalTaskCount)) return false
  if (value.completedTaskCount > value.totalTaskCount) return false
  if (value.totalTaskCount !== value.tasks.length) return false
  if (!finiteDate(value.createdAt) || !finiteDate(value.updatedAt)) return false
  if (value.completedAt !== undefined && !finiteDate(value.completedAt))
    return false
  if (
    typeof value.elapsedMs !== 'number' ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0
  )
    return false
  if (value.activeSince !== undefined && !finiteDate(value.activeSince))
    return false
  if (value.block !== undefined) {
    if (!isRecord(value.block) || typeof value.block.message !== 'string')
      return false
    if (
      value.block.nextAction !== undefined &&
      typeof value.block.nextAction !== 'string'
    )
      return false
  }
  return true
}

export function isFrozenWorkflowStageCardEvent(
  event: unknown,
): event is FrozenWorkflowStageCardEvent {
  if (!isRecord(event)) return false
  if (
    typeof event.eventId !== 'string' ||
    !event.eventId.trim() ||
    typeof event.runId !== 'string' ||
    !event.runId.trim() ||
    typeof event.type !== 'string' ||
    !event.type.trim() ||
    !DELIVERY_PHASES.includes(
      event.phase as (typeof DELIVERY_PHASES)[number],
    ) ||
    !DELIVERY_RUN_STATUSES.includes(event.status as DeliveryRunStatus) ||
    !finiteDate(event.createdAt)
  )
    return false
  const revision = event.revision
  if (
    !isRecord(revision) ||
    typeof revision.document !== 'string' ||
    !revision.document.trim() ||
    typeof revision.workspace !== 'string' ||
    !revision.workspace.trim()
  )
    return false
  return (
    isWorkflowStageCardSnapshot(event.stageSnapshot) &&
    event.stageSnapshot.status === 'completed'
  )
}

/** Returns the latest completed stage boundary represented by frozen events. */
export function lastStageBoundaryAt(
  runCreatedAt: string,
  events: readonly WorkflowEvent[],
): string {
  let latest = runCreatedAt
  let latestMs = Date.parse(runCreatedAt)
  for (const event of events) {
    if (!isFrozenWorkflowStageCardEvent(event)) continue
    const completedAt = event.stageSnapshot.completedAt
    const completedMs = Date.parse(completedAt ?? '')
    if (!Number.isFinite(completedMs)) continue
    if (!Number.isFinite(latestMs) || completedMs > latestMs) {
      latest = completedAt!
      latestMs = completedMs
    }
  }
  return latest
}

/** Computes running (not waiting/terminal) wall-clock time inside one stage. */
export function activeElapsedWithinStage(input: {
  events: readonly WorkflowEvent[]
  stageStartedAt: string
  stageEndedAt: string
}): number {
  const startedAt = Date.parse(input.stageStartedAt)
  const endedAt = Date.parse(input.stageEndedAt)
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0
  const boundary = Math.max(startedAt, endedAt)
  let activeSince: number | undefined = startedAt
  let elapsedMs = 0
  for (const event of input.events) {
    const eventAt = Date.parse(event.createdAt)
    if (!Number.isFinite(eventAt) || eventAt < startedAt || eventAt > boundary)
      continue
    if (event.status === 'running') activeSince ??= eventAt
    else if (activeSince !== undefined) {
      elapsedMs += Math.max(0, eventAt - activeSince)
      activeSince = undefined
    }
  }
  if (activeSince !== undefined)
    elapsedMs += Math.max(0, boundary - activeSince)
  return elapsedMs
}

function asWorkflowRecord(run: DeliveryRun): Record<string, unknown> {
  return run as unknown as Record<string, unknown>
}

function workflowStatus(run: DeliveryRun): DeliveryRunStatus {
  return DELIVERY_RUN_STATUSES.includes(run.status) ? run.status : 'failed'
}

function workflowThinking(run: DeliveryRun): 'working' | 'waiting' | 'idle' {
  if (run.status !== 'running') return 'idle'
  return run.activeDispatch?.status === 'running' ? 'working' : 'waiting'
}

function reviewCycle(run: DeliveryRun): Record<string, unknown> | undefined {
  return isRecord(run.documentReviewState?.activeCycle)
    ? run.documentReviewState.activeCycle
    : undefined
}

function reviewCheckIds(
  cycle: Record<string, unknown>,
): DocumentReviewCheckId[] {
  if (!Array.isArray(cycle.requiredCheckIds)) return []
  return cycle.requiredCheckIds.filter(
    (id): id is DocumentReviewCheckId => typeof id === 'string',
  )
}

function reviewCompletedCheckIds(
  cycle: Record<string, unknown>,
): DocumentReviewCheckId[] {
  if (!Array.isArray(cycle.completedCheckIds)) return []
  return cycle.completedCheckIds.filter(
    (id): id is DocumentReviewCheckId => typeof id === 'string',
  )
}

function reviewRepairPlan(
  cycle: Record<string, unknown>,
):
  | { groups: Array<{ paths: string[] }>; completedPaths: string[] }
  | undefined {
  const raw = cycle.repairPlan
  if (!isRecord(raw) || !Array.isArray(raw.groups)) return undefined
  const groups = raw.groups.flatMap(group => {
    if (!isRecord(group) || !Array.isArray(group.pathDecisions)) return []
    return [
      {
        paths: group.pathDecisions.flatMap(pathDecision =>
          isRecord(pathDecision) && typeof pathDecision.path === 'string'
            ? [pathDecision.path]
            : [],
        ),
      },
    ]
  })
  const completedPaths = Array.isArray(raw.completedPaths)
    ? raw.completedPaths.filter(
        (path): path is string => typeof path === 'string',
      )
    : []
  return { groups, completedPaths }
}

function documentTasks(
  run: DeliveryRun,
  workspacePath: string,
): DocumentDisplayTask[] {
  const cycle = reviewCycle(run)
  const input: Parameters<typeof projectDocumentDisplayTasks>[0] = {
    workspacePath,
    currentItemId: run.currentItemId,
    foundationDraftCompletedPaths: run.foundationDraftState.completedPaths,
    documentStep: run.documentStep as DocumentWorkflowStep | undefined,
    workflowStatus: run.status,
    thinking: workflowThinking(run),
  }
  if (cycle) {
    input.reviewCheckIds = reviewCheckIds(cycle)
    input.reviewCompletedCheckIds = reviewCompletedCheckIds(cycle)
    input.reviewPacketSetComplete = cycle.acceptedSemanticResult === true
    input.reviewTarget =
      cycle.activeTarget === 'foundation' ||
      cycle.activeTarget === 'checklist' ||
      cycle.activeTarget === 'resource'
        ? cycle.activeTarget
        : undefined
    input.repairPlan = reviewRepairPlan(cycle)
    input.reviewFindings = projectReviewFindingDisplayItems(
      openDocumentReviewFindings(cycle),
    )
  }
  return projectDocumentDisplayTasks(input)
}

function resourceTask(run: DeliveryRun): ResourceProductionTask {
  switch (run.resourceProductionState.currentTask) {
    case 'RESOURCE_PLAN':
    case 'RESOURCE_INVENTORY':
    case 'RESOURCE_CONTENT':
    case 'RESOURCE_GATE':
      return run.resourceProductionState.currentTask
    default:
      return 'RESOURCE_PLAN'
  }
}

function resourceTasks(
  run: DeliveryRun,
  workspacePath: string,
): DocumentDisplayTask[] {
  const cycle = reviewCycle(run)
  return projectAssetDisplayTasks({
    workspacePath,
    phase: 'RESOURCE_PREPARATION',
    workflowStatus: run.status,
    thinking: workflowThinking(run),
    activeDispatch: run.activeDispatch,
    resourceProductionTask: resourceTask(run),
    ...(cycle
      ? {
          reviewTarget:
            cycle.activeTarget === 'resource'
              ? ('resource' as const)
              : undefined,
          reviewFindings: projectReviewFindingDisplayItems(
            openDocumentReviewFindings(cycle),
            'resource',
          ),
        }
      : {}),
  })
}

function atomicTasks(run: DeliveryRun): WorkflowStageCardTask[] {
  return run.tasks.map(task => {
    const value = task as unknown as Record<string, unknown>
    const status = TASK_STATUSES.includes(
      task.status as WorkflowStageCardTask['status'],
    )
      ? (task.status as WorkflowStageCardTask['status'])
      : 'pending'
    const failureReason = stringValue(value.failureReason)
    return {
      id: task.id,
      title: task.title || task.id,
      status,
      ...(nonnegativeInteger(task.attempt) ? { attempt: task.attempt } : {}),
      ...(failureReason ? { failureReason } : {}),
    }
  })
}

function normalizeDisplayTasks(
  tasks: DocumentDisplayTask[],
): WorkflowStageCardTask[] {
  return tasks.map(task => ({
    id: task.id,
    title: task.title || task.id,
    status: TASK_STATUSES.includes(task.status) ? task.status : 'pending',
    ...(task.operation ? { operation: task.operation } : {}),
    ...(nonnegativeInteger(task.attempt) ? { attempt: task.attempt } : {}),
  }))
}

function elapsedTiming(
  run: DeliveryRun,
  timing: WorkflowStageCardTiming | undefined,
): { createdAt: string; elapsedMs: number; activeSince?: string } {
  const createdAt = timing?.stageStartedAt ?? run.createdAt
  const end = timing?.stageEndedAt ?? timing?.now ?? run.updatedAt
  let elapsedMs = timing?.elapsedMs
  let activeSinceAt: number | undefined
  if (!Number.isFinite(elapsedMs)) {
    if (timing?.events) {
      if (run.status === 'running') {
        let activeSince: number | undefined
        let durableElapsed = 0
        const startedAt = Date.parse(createdAt)
        const endedAt = Date.parse(end)
        for (const event of timing.events) {
          const eventAt = Date.parse(event.createdAt)
          if (
            !Number.isFinite(eventAt) ||
            !Number.isFinite(startedAt) ||
            !Number.isFinite(endedAt) ||
            eventAt < startedAt ||
            eventAt > endedAt
          )
            continue
          if (event.status === 'running') activeSince ??= eventAt
          else if (activeSince !== undefined) {
            durableElapsed += Math.max(0, eventAt - activeSince)
            activeSince = undefined
          }
        }
        if (activeSince !== undefined && Number.isFinite(endedAt)) {
          durableElapsed += Math.max(0, endedAt - activeSince)
          activeSinceAt = activeSince
        }
        elapsedMs = durableElapsed
      } else {
        elapsedMs = activeElapsedWithinStage({
          events: timing.events,
          stageStartedAt: createdAt,
          stageEndedAt: end,
        })
      }
    } else {
      elapsedMs =
        run.status === 'running'
          ? 0
          : Math.max(0, (Date.parse(end) || 0) - (Date.parse(createdAt) || 0))
    }
  }
  const activeSince =
    run.status === 'running'
      ? (timing?.activeSince ??
        (activeSinceAt !== undefined
          ? new Date(activeSinceAt).toISOString()
          : createdAt))
      : undefined
  return {
    createdAt,
    elapsedMs: Math.max(0, elapsedMs ?? 0),
    ...(activeSince && finiteDate(activeSince) ? { activeSince } : {}),
  }
}

export function projectCurrentStageCard(input: {
  run: DeliveryRun
  workspacePath: string
  timing?: WorkflowStageCardTiming
}): WorkflowStageCardSnapshot | undefined {
  const progress = projectDeliveryProgress(asWorkflowRecord(input.run))
  if (!progress) return undefined
  const run = input.run
  const cycle = reviewCycle(run)
  const documentPhase =
    run.phase === 'DOCUMENT_DRAFTING' || run.phase === 'DOCUMENT_REVIEW'
  const tasks = documentPhase
    ? normalizeDisplayTasks(documentTasks(run, input.workspacePath))
    : run.phase === 'RESOURCE_PREPARATION'
      ? normalizeDisplayTasks(resourceTasks(run, input.workspacePath))
      : atomicTasks(run)
  const elapsed = elapsedTiming(run, input.timing)
  const message = run.currentMessage
    ? sanitizeWorkflowDisplayMessage(run.currentMessage)
    : ''
  const blockedReason = stringValue(
    run.blockedReason ?? run.activeDispatch?.failureReason,
  )
  const nextAction = blockedReason
    ? run.status === 'stopped'
      ? 'resume'
      : 'retry'
    : undefined
  return {
    stageId: progress.stageId,
    phaseIndex: progress.phaseIndex,
    phaseCount: progress.phaseCount,
    status: workflowStatus(run),
    currentPhase: run.phase,
    ...(progress.substage ? { substage: progress.substage } : {}),
    ...(progress.convergencePass
      ? { convergencePass: progress.convergencePass }
      : {}),
    ...(run.documentStep ? { documentStep: run.documentStep } : {}),
    ...(cycle?.mode === 'initial' || cycle?.mode === 'closure'
      ? { reviewMode: cycle.mode }
      : {}),
    ...(cycle?.activeTarget === 'foundation' ||
    cycle?.activeTarget === 'checklist' ||
    cycle?.activeTarget === 'resource'
      ? { reviewTarget: cycle.activeTarget }
      : {}),
    thinking: workflowThinking(run),
    ...(run.activeDispatch?.workerType
      ? { worker: run.activeDispatch.workerType }
      : {}),
    ...(message ? { message } : {}),
    ...(run.activeDispatch?.status
      ? { executionStatus: run.activeDispatch.status }
      : {}),
    ...(run.currentItemId ? { currentItemId: run.currentItemId } : {}),
    tasks,
    completedTaskCount: tasks.filter(task => task.status === 'completed')
      .length,
    totalTaskCount: tasks.length,
    createdAt: elapsed.createdAt,
    updatedAt: run.updatedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    elapsedMs: elapsed.elapsedMs,
    ...(elapsed.activeSince ? { activeSince: elapsed.activeSince } : {}),
    ...(blockedReason
      ? {
          block: {
            message: blockedReason,
            ...(nextAction ? { nextAction } : {}),
          },
        }
      : {}),
  }
}

export function freezePreviousStageCard(input: {
  previous: DeliveryRun
  next: DeliveryRun
  workspacePath: string
  stageStartedAt: string
  stageEndedAt: string
  elapsedMs: number
}): WorkflowStageCardSnapshot | undefined {
  const previousProgress = projectDeliveryProgress(
    asWorkflowRecord(input.previous),
  )
  const nextProgress = projectDeliveryProgress(asWorkflowRecord(input.next))
  if (
    !previousProgress ||
    !nextProgress ||
    previousProgress.stageId === nextProgress.stageId
  )
    return undefined
  const previousCard = projectCurrentStageCard({
    run: input.previous,
    workspacePath: input.workspacePath,
    timing: {
      stageStartedAt: input.stageStartedAt,
      stageEndedAt: input.stageEndedAt,
      elapsedMs: input.elapsedMs,
    },
  })
  if (!previousCard) return undefined
  const { activeSince: _activeSince, ...withoutActiveSince } = previousCard
  return {
    ...withoutActiveSince,
    status: 'completed',
    createdAt: input.stageStartedAt,
    updatedAt: input.stageEndedAt,
    completedAt: input.stageEndedAt,
    elapsedMs: Math.max(0, input.elapsedMs),
  }
}

export function projectWorkflowStageCardHistory(input: {
  run: DeliveryRun
  workspacePath: string
  events: readonly WorkflowEvent[]
  now?: string
}): WorkflowStageCardSnapshot[] {
  const live = projectDeliveryProgress(asWorkflowRecord(input.run))
  if (!live) return []
  const cards = new Map<DeliveryProgressStage, WorkflowStageCardSnapshot>()
  for (const event of input.events) {
    if (!isFrozenWorkflowStageCardEvent(event)) continue
    const snapshot = event.stageSnapshot
    if (snapshot.phaseIndex >= live.phaseIndex) continue
    cards.set(snapshot.stageId, snapshot)
  }
  const reachedEvents = input.events.filter(
    event =>
      isFrozenWorkflowStageCardEvent(event) &&
      event.stageSnapshot.phaseIndex < live.phaseIndex,
  )
  const stageStartedAt = lastStageBoundaryAt(input.run.createdAt, reachedEvents)
  const current = projectCurrentStageCard({
    run: input.run,
    workspacePath: input.workspacePath,
    timing: {
      now: input.now,
      stageStartedAt,
      events: input.events,
    },
  })
  if (!current)
    return [...cards.values()].sort(
      (left, right) => left.phaseIndex - right.phaseIndex,
    )
  return [
    ...[...cards.values()].sort(
      (left, right) => left.phaseIndex - right.phaseIndex,
    ),
    current,
  ]
}
