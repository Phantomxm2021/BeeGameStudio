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
  type DocumentDisplayTask,
} from './document-display-tasks'
import {
  projectWorkflowCurrentMessage,
  projectWorkflowDisplayReason,
} from './workflow-display-message'
import type {
  DeliveryRun,
  DeliveryRunStatus,
  DocumentWorkflowStep,
  ResourceProductionTask,
  WorkflowEvent,
} from './types'
import type { FoundationIssueSummary } from './foundation-audit-state'

export type WorkflowStageCardTask = {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'stopped'
  operation?: 'write' | 'review' | 'revise' | 'produce' | 'assemble'
  attempt?: number
  round?: 1 | 2 | 3
  issueSummary?: FoundationIssueSummary
  knownIssueCount?: number
  usage?: WorkflowStageCardTaskUsage
  durationMs?: number
  failureReason?: string
}

type WorkflowStageCardTaskUsage = {
  input_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type WorkflowStageCardSnapshot = {
  stageId: DeliveryProgressStage
  phaseIndex: number
  phaseCount: number
  status: DeliveryRunStatus
  currentPhase: string
  substage?: DeliveryProgressSubstage
  documentStep?: string
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
  block?: {
    message: string
    code?: string
    diagnosticId?: string
    nextAction?: string
  }
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
>[] = ['write', 'review', 'revise', 'produce', 'assemble']

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
  if ('convergencePass' in value) return false
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
      'REPAIRING',
      'CHECKLIST_DRAFTING',
    ].includes(value.substage as DeliveryProgressSubstage)
  )
    return false
  if (
    value.documentStep !== undefined &&
    (typeof value.documentStep !== 'string' || !value.documentStep.trim())
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
    event.stageSnapshot.status === 'completed' &&
    finiteDate(event.stageSnapshot.completedAt) &&
    event.stageSnapshot.activeSince === undefined
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
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    endedAt < startedAt
  )
    return 0
  const relevantEvents = input.events
    .map((event, index) => ({
      event,
      index,
      eventAt: Date.parse(event.createdAt),
    }))
    .filter(
      entry =>
        Number.isFinite(entry.eventAt) &&
        entry.eventAt >= startedAt &&
        entry.eventAt <= endedAt,
    )
    .sort(
      (left, right) => left.eventAt - right.eventAt || left.index - right.index,
    )
  let activeSince: number | undefined = startedAt
  let elapsedMs = 0
  for (const { event, eventAt } of relevantEvents) {
    if (event.status === 'running') activeSince ??= eventAt
    else if (activeSince !== undefined) {
      elapsedMs += Math.max(0, Math.min(endedAt, eventAt) - activeSince)
      activeSince = undefined
    }
  }
  if (activeSince !== undefined) elapsedMs += Math.max(0, endedAt - activeSince)
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
function documentTasks(
  run: DeliveryRun,
  workspacePath: string,
): DocumentDisplayTask[] {
  const input: Parameters<typeof projectDocumentDisplayTasks>[0] = {
    workspacePath,
    currentItemId: run.currentItemId,
    foundationDraftCompletedPaths: run.foundationDraftState.completedPaths,
    foundationDocuments: run.foundationDraftState.documents?.map(document => ({
      path: document.path,
      status: document.status,
    })),
    documentStep: run.documentStep as DocumentWorkflowStep | undefined,
    workflowStatus: run.status,
    thinking: workflowThinking(run),
    foundationAuditState: run.foundationAuditState,
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
  return projectAssetDisplayTasks({
    workspacePath,
    phase: 'RESOURCE_PREPARATION',
    workflowStatus: run.status,
    thinking: workflowThinking(run),
    activeDispatch: run.activeDispatch,
    resourceProductionTask: resourceTask(run),
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
    ...(task.round ? { round: task.round } : {}),
    ...(task.issueSummary ? { issueSummary: task.issueSummary } : {}),
    ...(task.knownIssueCount !== undefined ? { knownIssueCount: task.knownIssueCount } : {}),
    ...(task.usage ? { usage: task.usage } : {}),
    ...(task.durationMs !== undefined ? { durationMs: task.durationMs } : {}),
    ...(task.failureReason ? { failureReason: task.failureReason } : {}),
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
  const documentPhase =
    run.phase === 'DOCUMENT_DRAFTING' || run.phase === 'DOCUMENT_REVIEW'
  const tasks = documentPhase
    ? normalizeDisplayTasks(documentTasks(run, input.workspacePath))
    : run.phase === 'RESOURCE_PREPARATION'
      ? normalizeDisplayTasks(resourceTasks(run, input.workspacePath))
      : atomicTasks(run)
  const elapsed = elapsedTiming(run, input.timing)
  const message = run.status === 'running'
    ? projectWorkflowCurrentMessage({ value: run.currentMessage, phase: run.phase, documentStep: run.documentStep })
    : ''
  const blockedReason = stringValue(
    run.blockedReason ?? run.activeDispatch?.failureReason,
  )
  const blockReason = projectWorkflowDisplayReason(blockedReason)
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
    ...(run.documentStep ? { documentStep: run.documentStep } : {}),
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
    ...(blockReason
      ? {
          block: {
            ...blockReason,
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
  const cards = new Map<
    DeliveryProgressStage,
    { snapshot: WorkflowStageCardSnapshot; event: FrozenWorkflowStageCardEvent }
  >()
  const runEvents = input.events.filter(
    event => event.runId === input.run.runId,
  )
  for (const event of runEvents) {
    if (
      event.runId !== input.run.runId ||
      !isFrozenWorkflowStageCardEvent(event)
    )
      continue
    const snapshot = event.stageSnapshot
    if (snapshot.phaseIndex >= live.phaseIndex) continue
    const existing = cards.get(snapshot.stageId)
    if (!existing || isNewerFrozenEvent(event, existing.event))
      cards.set(snapshot.stageId, { snapshot, event })
  }
  const reachedEvents = runEvents.filter(
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
      events: runEvents,
    },
  })
  const frozenCards = [...cards.values()]
    .map(value => value.snapshot)
    .sort((left, right) => left.phaseIndex - right.phaseIndex)
  if (!current) return frozenCards
  return [...frozenCards, current]
}

function isNewerFrozenEvent(
  candidate: FrozenWorkflowStageCardEvent,
  existing: FrozenWorkflowStageCardEvent,
): boolean {
  const candidateCompletedAt = Date.parse(
    candidate.stageSnapshot.completedAt ?? '',
  )
  const existingCompletedAt = Date.parse(
    existing.stageSnapshot.completedAt ?? '',
  )
  if (candidateCompletedAt !== existingCompletedAt)
    return candidateCompletedAt > existingCompletedAt
  const candidateCreatedAt = Date.parse(candidate.createdAt)
  const existingCreatedAt = Date.parse(existing.createdAt)
  if (candidateCreatedAt !== existingCreatedAt)
    return candidateCreatedAt > existingCreatedAt
  return candidate.eventId.localeCompare(existing.eventId) > 0
}
