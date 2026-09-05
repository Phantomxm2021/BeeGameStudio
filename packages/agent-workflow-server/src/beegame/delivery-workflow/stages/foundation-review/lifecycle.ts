import type { DispatchRecord, WorkflowUsage } from '../../types'
import { projectTaskTerminalEvidence } from '../../task-terminal-evidence'

/** The only task kinds whose lifecycle is owned by the Foundation Reviewer. */
export type FoundationReviewLifecycleTaskKind =
  | 'document-facts'
  | 'semantic'
  | 'confirmation'

export type FoundationReviewLifecycleTaskStatus =
  | 'pending'
  | 'running'
  | 'retryable'
  | 'completed'
  | 'needs_action'

/**
 * Read-only task projection used by Reviewer lifecycle operations.
 *
 * The evidence fields that are not normally present on one of these task
 * kinds are intentionally represented as well.  Retry eligibility is an
 * absence-sensitive rule: dropping an old receipt/result during projection
 * must not make a stale task look like a clean model-configuration failure.
 */
type FoundationReviewLifecycleTaskEvidence = Readonly<{
  taskId: string
  revision: string
  packetDigest: string
  status: FoundationReviewLifecycleTaskStatus
  attempt: number
  dispatch?: Readonly<DispatchRecord>
  attemptHistory?: readonly Readonly<DispatchRecord>[]
  terminalDigest?: string
  usage?: Readonly<WorkflowUsage>
  durationMs?: number
  failureReason?: string
  receiptPath?: string
  receiptDigest?: string
  resultPath?: string
  resultDigest?: string
  receipt?: unknown
  result?: unknown
  admittedResult?: unknown
}>

export type FoundationReviewLifecycleTask =
  | (FoundationReviewLifecycleTaskEvidence & {
      kind: 'document-facts'
      factKeyCount: number
      modelTier: 'fast'
    })
  | (FoundationReviewLifecycleTaskEvidence & {
      kind: 'semantic'
      checkId: string
      modelTier: 'fast' | 'balanced'
    })
  | (FoundationReviewLifecycleTaskEvidence & {
      kind: 'confirmation'
      checkId: string
      sourceTaskId: string
      modelTier: 'strong'
    })

export type FoundationReviewLifecycleRetryResult = Readonly<{
  tasks: FoundationReviewLifecycleTask[]
  revived: boolean
}>

export type FoundationReviewInterruptDispatch = (
  dispatch: DispatchRecord,
) => DispatchRecord

const FOUNDATION_MODEL_CONFIGURATION_FAILURES = new Set([
  'foundation fact fast model is not configured',
  'foundation fact extractor fast model is not configured',
  'foundation semantic fast model is not configured',
  'foundation semantic balanced model is not configured',
  'foundation semantic strong model is not configured',
  'foundation semantic model is not configured',
])

function copyUsage(usage: Readonly<WorkflowUsage>): WorkflowUsage {
  return {
    input_tokens: usage.input_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_creation_tokens: usage.cache_creation_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  }
}

/** Copy the public dispatch shape, including its nested protocol values. */
function copyDispatch(dispatch: Readonly<DispatchRecord>): DispatchRecord {
  return {
    dispatchId: dispatch.dispatchId,
    workerType: dispatch.workerType,
    phase: dispatch.phase,
    ...(dispatch.taskId === undefined ? {} : { taskId: dispatch.taskId }),
    revision: dispatch.revision,
    status: dispatch.status,
    ...(dispatch.terminalEvidencePath === undefined
      ? {}
      : { terminalEvidencePath: dispatch.terminalEvidencePath }),
    ...(dispatch.failureReason === undefined
      ? {}
      : { failureReason: dispatch.failureReason }),
    ...(dispatch.request === undefined
      ? {}
      : { request: structuredClone(dispatch.request) }),
    ...(dispatch.terminalResult === undefined
      ? {}
      : { terminalResult: structuredClone(dispatch.terminalResult) }),
    ...(dispatch.startingUsage === undefined
      ? {}
      : { startingUsage: copyUsage(dispatch.startingUsage) }),
    ...(dispatch.usage === undefined
      ? {}
      : { usage: copyUsage(dispatch.usage) }),
    startedAt: dispatch.startedAt,
    ...(dispatch.finishedAt === undefined
      ? {}
      : { finishedAt: dispatch.finishedAt }),
  }
}

function copyOptionalEvidence(
  task: Readonly<FoundationReviewLifecycleTask>,
): FoundationReviewLifecycleTask {
  const base = {
    taskId: task.taskId,
    kind: task.kind,
    revision: task.revision,
    packetDigest: task.packetDigest,
    status: task.status,
    attempt: task.attempt,
    modelTier: task.modelTier,
    ...(!('factKeyCount' in task) || task.factKeyCount === undefined
      ? {}
      : { factKeyCount: task.factKeyCount }),
    ...(!('checkId' in task) || task.checkId === undefined ? {} : { checkId: task.checkId }),
    ...(!('sourceTaskId' in task) || task.sourceTaskId === undefined
      ? {}
      : { sourceTaskId: task.sourceTaskId }),
    ...(task.dispatch === undefined
      ? {}
      : { dispatch: copyDispatch(task.dispatch) }),
    ...(task.attemptHistory === undefined
      ? {}
      : { attemptHistory: task.attemptHistory.map(copyDispatch) }),
    ...(task.terminalDigest === undefined
      ? {}
      : { terminalDigest: task.terminalDigest }),
    ...(task.usage === undefined ? {} : { usage: copyUsage(task.usage) }),
    ...(task.durationMs === undefined ? {} : { durationMs: task.durationMs }),
    ...(task.failureReason === undefined
      ? {}
      : { failureReason: task.failureReason }),
    ...(task.receiptPath === undefined
      ? {}
      : { receiptPath: task.receiptPath }),
    ...(task.receiptDigest === undefined
      ? {}
      : { receiptDigest: task.receiptDigest }),
    ...(task.resultPath === undefined ? {} : { resultPath: task.resultPath }),
    ...(task.resultDigest === undefined
      ? {}
      : { resultDigest: task.resultDigest }),
    ...(task.receipt === undefined
      ? {}
      : { receipt: structuredClone(task.receipt) }),
    ...(task.result === undefined
      ? {}
      : { result: structuredClone(task.result) }),
    ...(task.admittedResult === undefined
      ? {}
      : { admittedResult: structuredClone(task.admittedResult) }),
  }
  return base as FoundationReviewLifecycleTask
}

function isReviewTaskKind(
  value: unknown,
): value is FoundationReviewLifecycleTaskKind {
  return (
    value === 'document-facts' ||
    value === 'semantic' ||
    value === 'confirmation'
  )
}

/** Copy one full persisted task into the Reviewer lifecycle projection. */
export function projectFoundationReviewLifecycleTask(
  task: Readonly<FoundationReviewLifecycleTask>,
): FoundationReviewLifecycleTask {
  if (!isReviewTaskKind(task.kind))
    throw new Error(
      'foundation review lifecycle only accepts reviewer task kinds',
    )
  return copyOptionalEvidence(task)
}

function isEligibleFoundationReviewRetryTask(
  task: FoundationReviewLifecycleTask,
  taskId: string | undefined,
): boolean {
  return (
    (!taskId || task.taskId === taskId) &&
    task.status === 'needs_action' &&
    task.attempt === 0 &&
    FOUNDATION_MODEL_CONFIGURATION_FAILURES.has(task.failureReason ?? '') &&
    task.dispatch === undefined &&
    task.terminalDigest === undefined &&
    task.usage === undefined &&
    task.durationMs === undefined &&
    task.receiptPath === undefined &&
    task.receiptDigest === undefined &&
    task.resultDigest === undefined &&
    task.resultPath === undefined &&
    task.receipt === undefined &&
    task.result === undefined &&
    task.admittedResult === undefined
  )
}

function isUserStoppedFoundationReviewTask(
  task: FoundationReviewLifecycleTask,
  taskId: string | undefined,
): boolean {
  return (
    (!taskId || task.taskId === taskId) &&
    task.status === 'retryable' &&
    task.dispatch?.status === 'interrupted' &&
    /(?:user|operator) stopped/i.test(task.failureReason ?? '')
  )
}

/**
 * Apply the Reviewer-owned retry policy to a copied task projection.
 *
 * The caller remains responsible for choosing the Reviewer task collection;
 * this function deliberately has no run or audit-state envelope.
 */
export function retryFoundationReviewTasks(input: {
  tasks: readonly FoundationReviewLifecycleTask[]
  taskId?: string
}): FoundationReviewLifecycleRetryResult {
  let revived = false
  const tasks = input.tasks.map(source => {
    const task = projectFoundationReviewLifecycleTask(source)
    if (
      !isEligibleFoundationReviewRetryTask(task, input.taskId) &&
      !isUserStoppedFoundationReviewTask(task, input.taskId)
    )
      return task
    revived = true
    return { ...task, status: 'pending' as const, failureReason: undefined }
  })
  return { tasks, revived }
}

/**
 * Project a user stop onto one active Reviewer task.
 *
 * Active membership is selected by the global adapter.  The stage therefore
 * only checks the exact condition present in the old stop path: a running
 * dispatch.  The interrupt callback runs before terminal evidence projection
 * and receives an isolated dispatch copy.
 */
export function stopFoundationReviewTask(input: {
  task: FoundationReviewLifecycleTask
  reason: string
  interruptDispatch: FoundationReviewInterruptDispatch
}): FoundationReviewLifecycleTask {
  const task = projectFoundationReviewLifecycleTask(input.task)
  if (task.dispatch?.status !== 'running') return task

  const interrupted = copyDispatch(
    input.interruptDispatch(copyDispatch(task.dispatch)),
  )
  const projected = projectTaskTerminalEvidence(
    {
      ...task,
      status: 'retryable' as const,
      attempt: Math.max(0, task.attempt - 1),
      failureReason: input.reason,
      dispatch: interrupted,
    } as never,
    interrupted,
  ) as unknown as FoundationReviewLifecycleTask
  return copyOptionalEvidence(projected)
}
