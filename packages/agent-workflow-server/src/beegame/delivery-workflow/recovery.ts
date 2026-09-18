import { RETIRED_FOUNDATION_AUTHOR, assertNoRetiredAuthorRun } from './retired-foundation-author'
import { assertNoRetiredFoundationReviewRun, retiredFoundationRunningDispatches } from './retired-foundation-review'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { transitionDeliveryRun } from './transition'
import { isPublicStageActive } from './public-stage-routing'
import {
  computeDocumentRevision,
  computeResourceRevision,
  computeWorkspaceRevision,
} from './revision'
import {
  DELIVERY_RUN_SCHEMA_VERSION,
  type AcceptedWorkflowUnit,
  type DeliveryRun,
  type DispatchRecord,
  type WorkflowEvent,
  type WorkflowUnitAcceptedEvent,
} from './types'
import {
  WorkflowStoreError,
  type RunStore,
  type WorkflowLock,
  type WorkflowSnapshotInspection,
} from './run-store'
import {
  projectExactResumeRun,
  proveExactRawActiveUnitId,
} from './recovery-projector'

export {
  inspectWorkflowSnapshot,
  projectExactResumeRun,
  type WorkflowSnapshotInspection,
} from './recovery-projector'

const workspaceRecoveryQueues = new Map<string, Promise<void>>()
const workspaceResumeQueues = new Map<string, Promise<DeliveryRun>>()
export class WorkflowRecoveryTransactionError extends Error {
  constructor(
    message: string,
    readonly code: 'recovery_worker_stop_failed',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'WorkflowRecoveryTransactionError'
  }
}

function snapshotRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : undefined
}

function hasStaleFoundationWorkers(run: DeliveryRun): boolean {
  return Boolean(
      run.status !== 'running' &&
      retiredFoundationRunningDispatches(run).length > 0,
  )
}

function recoveryConflict(message: string): never {
  throw new WorkflowStoreError(message, 'recovery_checkpoint_conflict')
}

function acceptedUnitAlreadyJournaled(
  events: WorkflowEvent[],
  unitId: string,
): boolean {
  return events.some(
    event =>
      event.type === 'workflow.unit.accepted' &&
      snapshotRecord(event.unit)?.unitId === unitId,
  )
}

function acceptedEvent(input: {
  unit: AcceptedWorkflowUnit
  runId: string
  ownerId: string
  projectId: string
  revision: DeliveryRun['revision']
}): WorkflowUnitAcceptedEvent {
  return {
    eventId: randomUUID(),
    runId: input.runId,
    type: 'workflow.unit.accepted',
    phase: input.unit.phase,
    status: 'running',
    revision: input.revision,
    createdAt: input.unit.acceptedAt,
    projectId: input.projectId,
    ownerId: input.ownerId,
    unit: input.unit,
  }
}

function assertActiveRequestIdentity(input: {
  snapshot: Record<string, unknown>
  dispatch: Record<string, unknown>
  request: Record<string, unknown>
  workspacePath: string
  ownerId: string
  projectId: string
}): { dispatchId: string; runId: string } {
  const dispatchId = stringValue(input.dispatch.dispatchId)
  const runId = stringValue(input.snapshot.runId)
  const requestWorkspace = stringValue(input.request.workspacePath)
  const dispatchTaskId = stringValue(input.dispatch.taskId)
  const requestTaskId = stringValue(input.request.taskId)
  const dispatchRevision = stringValue(input.dispatch.revision)
  const requestRevision = stringValue(input.request.revision)
  if (
    !dispatchId ||
    !runId ||
    !dispatchTaskId ||
    !requestTaskId ||
    !dispatchRevision ||
    !requestRevision ||
    input.snapshot.ownerId !== input.ownerId ||
    input.snapshot.projectId !== input.projectId ||
    input.request.dispatchId !== dispatchId ||
    input.request.runId !== runId ||
    input.request.ownerId !== input.ownerId ||
    input.request.projectId !== input.projectId ||
    !requestWorkspace ||
    resolve(requestWorkspace) !== resolve(input.workspacePath) ||
    input.dispatch.status !== 'running' ||
    input.snapshot.phase !== input.dispatch.phase ||
    input.request.workerType !== input.dispatch.workerType ||
    input.request.phase !== input.dispatch.phase ||
    requestTaskId !== dispatchTaskId ||
    requestRevision !== dispatchRevision
  )
    recoveryConflict(
      'active dispatch request does not match the owned recovery checkpoint',
    )
  return { dispatchId, runId }
}

type ReconciledProjectionSource = {
  inspection: WorkflowSnapshotInspection
  events: WorkflowEvent[]
  acceptedUnits: AcceptedWorkflowUnit[]
  receiptReconciliation?: {
    sourceInspection: WorkflowSnapshotInspection
    successorActiveUnitId: string
  }
}

async function reconcileActiveCanonicalReceipt(input: {
  inspection: WorkflowSnapshotInspection
  events: WorkflowEvent[]
  workspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
  assertMutationAuthority?: () => void | Promise<void>
}): Promise<ReconciledProjectionSource> {
  const snapshot = snapshotRecord(input.inspection.parsedValue)
  const dispatch = snapshotRecord(snapshot?.activeDispatch)
  const request = snapshotRecord(dispatch?.request)
  if (!snapshot || !dispatch || !request)
    return {
      inspection: input.inspection,
      events: input.events,
      acceptedUnits: [],
    }

  if (dispatch.workerType === 'document-author') {
    if (snapshotRecord(request.contract)?.documentSet !== 'checklist')
      recoveryConflict(RETIRED_FOUNDATION_AUTHOR)
    return { inspection: input.inspection, events: input.events, acceptedUnits: [] }
  }

  return {
    inspection: input.inspection,
    events: input.events,
    acceptedUnits: [],
  }
}

function assertRecoveryAuthority(input: {
  inspection: WorkflowSnapshotInspection
  ownerId: string
  projectId: string
  confirmedBriefContext: string
}): void {
  if (!input.confirmedBriefContext.trim())
    throw new WorkflowStoreError(
      'workflow recovery requires confirmed brief authority',
      'recovery_checkpoint_missing',
    )
  if (input.inspection.error?.code === 'ownership') throw input.inspection.error
  const snapshot = snapshotRecord(input.inspection.parsedValue)
  const schemaVersion = snapshot?.schemaVersion
  const obsoleteSchemaVersion =
    typeof schemaVersion === 'number' &&
    Number.isInteger(schemaVersion) &&
    schemaVersion < DELIVERY_RUN_SCHEMA_VERSION
  if (schemaVersion !== DELIVERY_RUN_SCHEMA_VERSION)
    throw (
      input.inspection.error ??
      new WorkflowStoreError(
        obsoleteSchemaVersion
          ? `workflow snapshot schema version ${schemaVersion} is obsolete; start a new workflow with schema version ${DELIVERY_RUN_SCHEMA_VERSION}`
          : `workflow snapshot schema version ${schemaVersion} is not the current version ${DELIVERY_RUN_SCHEMA_VERSION}`,
        obsoleteSchemaVersion ? 'obsolete' : 'invalid',
      )
    )
  const ownerId =
    input.inspection.currentRun?.ownerId ??
    (typeof snapshot?.ownerId === 'string' ? snapshot.ownerId : undefined)
  if (ownerId && ownerId !== input.ownerId)
    throw new WorkflowStoreError('workflow ownership mismatch', 'ownership')
  const projectId =
    input.inspection.currentRun?.projectId ??
    (typeof snapshot?.projectId === 'string' ? snapshot.projectId : undefined)
  if (projectId && projectId !== input.projectId)
    throw new WorkflowStoreError(
      'workflow snapshot does not belong to the owned project',
      'recovery_checkpoint_conflict',
    )
  const confirmedBriefContext =
    input.inspection.currentRun?.confirmedBriefContext ??
    (typeof snapshot?.confirmedBriefContext === 'string'
      ? snapshot.confirmedBriefContext
      : undefined)
  if (
    confirmedBriefContext &&
    confirmedBriefContext !== input.confirmedBriefContext
  )
    throw new WorkflowStoreError(
      'workflow confirmed brief authority conflicts with recovery input',
      'recovery_checkpoint_conflict',
    )
}

async function withWorkspaceRecoveryLock<T>(
  workspacePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = resolve(workspacePath)
  const previous = workspaceRecoveryQueues.get(key) ?? Promise.resolve()
  const queued = previous.catch(() => undefined).then(operation)
  const marker = queued.then(
    () => undefined,
    () => undefined,
  )
  workspaceRecoveryQueues.set(key, marker)
  try {
    return await queued
  } finally {
    if (workspaceRecoveryQueues.get(key) === marker)
      workspaceRecoveryQueues.delete(key)
  }
}

async function resumeWorkspaceOnce(input: {
  key: string
  store: RunStore
  run: DeliveryRun
  resumeCurrentRun: (run: DeliveryRun) => Promise<void>
}): Promise<DeliveryRun> {
  const existing = workspaceResumeQueues.get(input.key)
  if (existing) return existing
  const pending = (async () => {
    await input.resumeCurrentRun(input.run)
    const current = await input.store.load()
    return current?.runId === input.run.runId ? current : input.run
  })()
  workspaceResumeQueues.set(input.key, pending)
  try {
    return await pending
  } finally {
    if (workspaceResumeQueues.get(input.key) === pending)
      workspaceResumeQueues.delete(input.key)
  }
}

export async function recoverAndResumeRun(input: {
  store: RunStore
  workspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
  stopWorkspaceWorkers: (reason: string) => Promise<void>
  resumeCurrentRun: (run: DeliveryRun) => Promise<void>
}): Promise<DeliveryRun> {
  const workspacePath = resolve(input.workspacePath)
  if (resolve(input.store.workspacePath) !== workspacePath)
    throw new WorkflowStoreError(
      'workflow store does not belong to the recovery workspace',
      'ownership',
    )
  const transaction = await withWorkspaceRecoveryLock(
    workspacePath,
    async (): Promise<{ run: DeliveryRun; resume: boolean }> => {
      const source = await input.store.inspectWorkflowSnapshot()
      assertRecoveryAuthority({ ...input, inspection: source })
      if (source.currentRun) {
        if (!source.currentRun.authorStage) assertNoRetiredFoundationReviewRun(source.currentRun)
        let currentRun = source.currentRun
        if (hasStaleFoundationWorkers(currentRun)) {
          try {
            await input.stopWorkspaceWorkers(
              'recovering stale foundation workers from a terminal delivery run',
            )
          } catch (error) {
            throw new WorkflowRecoveryTransactionError(
              'stale workflow workers could not be stopped',
              'recovery_worker_stop_failed',
              { cause: error },
            )
          }
          currentRun =
            (await input.store.reconcile(async () => false)) ?? currentRun
        }
        return {
          run: currentRun,
          resume:
            currentRun.status !== 'completed' &&
            currentRun.activeDispatch?.status !== 'running',
        }
      }
      try {
        await input.stopWorkspaceWorkers(
          'recovering invalid current delivery workflow',
        )
      } catch (error) {
        throw new WorkflowRecoveryTransactionError(
          'stale workflow workers could not be stopped',
          'recovery_worker_stop_failed',
          { cause: error },
        )
      }

      const stoppedSource = await input.store.inspectWorkflowSnapshot()
      assertRecoveryAuthority({ ...input, inspection: stoppedSource })
      if (stoppedSource.currentRun) {
        return {
          run: stoppedSource.currentRun,
          resume:
            stoppedSource.currentRun.status !== 'completed' &&
            stoppedSource.currentRun.activeDispatch?.status !== 'running',
        }
      }
      const stoppedRecord = snapshotRecord(stoppedSource.parsedValue)
      // Shutdown must be acknowledged before rejection. Unsupported projects
      // must never reach receipt reconciliation or reconstruct a review state.
      if (stoppedRecord) assertNoRetiredFoundationReviewRun(stoppedRecord)
      const runId = stringValue(stoppedRecord?.runId)
      if (!runId)
        throw new WorkflowStoreError(
          'workflow recovery requires an exact durable run identity',
          'recovery_checkpoint_missing',
        )
      const lease = await input.store.lock(runId, async () => false)
      try {
        const lockedSource = await input.store.inspectWorkflowSnapshot()
        assertRecoveryAuthority({ ...input, inspection: lockedSource })
        if (lockedSource.currentRun) {
          return {
            run: lockedSource.currentRun,
            resume:
              lockedSource.currentRun.status !== 'completed' &&
              lockedSource.currentRun.activeDispatch?.status !== 'running',
          }
        }
        const events = await input.store.readEvents()
        const assertMutationAuthority = async () => {
          const current = await input.store.inspectWorkflowSnapshot()
          if (current.digest !== lockedSource.digest)
            recoveryConflict(
              'workflow snapshot changed during canonical receipt recovery',
            )
        }
        const reconciled = await reconcileActiveCanonicalReceipt({
          inspection: lockedSource,
          events,
          workspacePath,
          ownerId: input.ownerId,
          projectId: input.projectId,
          confirmedBriefContext: input.confirmedBriefContext,
          assertMutationAuthority,
        })
        const projection = await projectExactResumeRun({
          inspection: reconciled.inspection,
          events: reconciled.events,
          workspacePath,
          ownerId: input.ownerId,
          projectId: input.projectId,
          confirmedBriefContext: input.confirmedBriefContext,
          ...(reconciled.receiptReconciliation
            ? { receiptReconciliation: reconciled.receiptReconciliation }
            : {}),
        })
        const createdAt = new Date().toISOString()
        const reconstructedEvent: WorkflowEvent = {
          eventId: randomUUID(),
          runId: projection.run.runId,
          type: 'workflow.run.reconstructed',
          phase: projection.run.phase,
          status: projection.run.status,
          revision: projection.run.revision,
          createdAt,
          projectId: projection.run.projectId,
          ownerId: projection.run.ownerId,
          sourceSnapshotDigest: lockedSource.digest,
          replayedUnitIds: projection.replayedUnitIds,
          ...(projection.activeUnitId
            ? { activeUnitId: projection.activeUnitId }
            : {}),
        }
        const persisted = await input.store.replaceSnapshotIfDigest({
          expectedDigest: lockedSource.digest,
          run: projection.run,
          event: reconstructedEvent,
          acceptedUnits: reconciled.acceptedUnits,
          lease,
        })
        if (persisted.runId !== projection.run.runId)
          throw new WorkflowStoreError(
            'reconstructed workflow snapshot could not be reloaded',
            'io',
          )
        return {
          run: persisted,
          resume:
            persisted.status !== 'completed' &&
            persisted.activeDispatch?.status !== 'running',
        }
      } finally {
        await input.store.unlock(lease)
      }
    },
  )
  if (!transaction.resume) return transaction.run
  return resumeWorkspaceOnce({
    key: workspacePath,
    store: input.store,
    run: transaction.run,
    resumeCurrentRun: input.resumeCurrentRun,
  })
}


export async function reconcileRunOnStartup(input: {
  store: RunStore
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<DeliveryRun | null> {
  const initial = await input.store.load()
  if (!initial) return null
  if (isPublicStageActive(initial)) return initial
  const acquired = await acquireAndLoad({
    store: input.store,
    runId: initial.runId,
    sessionIsOpen: input.sessionIsOpen,
  })
  try {
    return acquired.run
  } finally {
    await acquired.unlock()
  }
}

async function acquireAndLoad(input: {
  store: RunStore
  runId: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<{
  run: DeliveryRun
  lease: WorkflowLock
  unlock: () => Promise<void>
}> {
  const lease = await input.store.lock(input.runId, async () => {
    const current = (await input.store.inspectWorkflowSnapshot()).currentRun
    if (!current || current.runId !== input.runId) return false
    const runningDispatches = [
      ...(current.activeDispatch?.status === 'running'
        ? [current.activeDispatch]
        : []),
      ...retiredFoundationRunningDispatches(current),
    ]
    if (!runningDispatches.length) return false
    if (!input.sessionIsOpen) return true
    return (await Promise.all(runningDispatches.map(dispatch => input.sessionIsOpen!(dispatch)))).some(Boolean)
  })
  try {
    const beforeRecovery = await input.store.load(lease)
    if (beforeRecovery && !isPublicStageActive(beforeRecovery)) {
      assertNoRetiredAuthorRun(beforeRecovery)
      assertNoRetiredFoundationReviewRun(beforeRecovery)
    }
    const run = await input.store.reconcile(
      input.sessionIsOpen ?? (async () => false),
      lease,
    )
    if (!run || run.runId !== input.runId)
      throw new Error('delivery run not found')
    if (isPublicStageActive(run))
      throw new Error('Public author invocation must be controlled through its module, not legacy recovery')
    return { run, lease, unlock: () => input.store.unlock(lease) }
  } catch (error) {
    await input.store.unlock(lease)
    throw error
  }
}

export async function resumeRun(input: {
  store: RunStore
  runId: string
  workspacePath?: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<DeliveryRun> {
  const acquired = await acquireAndLoad(input)
  try {
    const foundationFactRunning = retiredFoundationRunningDispatches(acquired.run).length > 0
    if (
      acquired.run.status === 'completed' ||
      acquired.run.activeDispatch?.status === 'running' ||
      foundationFactRunning
    )
      return acquired.run
    const retryable =
      acquired.run.status === 'needs_action' ||
      acquired.run.status === 'blocked' ||
      acquired.run.status === 'stopped' ||
      acquired.run.status === 'failed'
    const resumed =
      (retryable
        ? transitionDeliveryRun(
            {
              ...acquired.run,
              activeDispatch: acquired.run.activeDispatch?.terminalResult
                ? acquired.run.activeDispatch
                : undefined,
            },
            { type: 'retry' },
          )
        : acquired.run)
    return input.store.commit(
      resumed,
      {
        runId: resumed.runId,
        type: 'run.resumed',
        phase: resumed.phase,
        status: resumed.status,
        revision: resumed.revision,
      },
      undefined,
      acquired.lease,
    )
  } finally {
    await acquired.unlock()
  }
}

export async function retryRun(input: {
  store: RunStore
  runId: string
  workspacePath?: string
  taskId?: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<DeliveryRun> {
  const acquired = await acquireAndLoad(input)
  try {
    // A successful retry can race a duplicate browser request or a stale
    // workflow-card snapshot. The first request has already resumed the same
    // durable run, so repeating it must be an idempotent read rather than an
    // invalid state transition.
    if (
      acquired.run.status === 'running' &&
      !acquired.run.activeDispatch?.terminalResult
    )
      return acquired.run
    const acceptanceRevisionMismatch =
      acquired.run.phase === 'ACCEPTANCE' &&
      acquired.run.activeDispatch?.failureReason ===
        'acceptance evidence does not match the workspace' &&
      Boolean(input.workspacePath)
    const acceptanceRetryRevision = acceptanceRevisionMismatch
      ? await computeWorkspaceRevision(input.workspacePath!)
      : undefined
    const retryBase = acceptanceRetryRevision
      ? {
          ...acquired.run,
          revision: {
            ...acquired.run.revision,
            implementation: acceptanceRetryRevision,
            workspace: acceptanceRetryRevision,
          },
        }
      : acquired.run
    const replayable =
      !input.taskId && retryBase.activeDispatch?.terminalResult
    const resumed =
      transitionDeliveryRun(
        {
          ...retryBase,
          activeDispatch: replayable ? retryBase.activeDispatch : undefined,
        },
        { type: 'retry', ...(input.taskId ? { taskId: input.taskId } : {}) },
      )
    return input.store.commit(
      resumed,
      {
        runId: resumed.runId,
        type: 'run.retry_requested',
        phase: resumed.phase,
        status: resumed.status,
        revision: resumed.revision,
        taskId: input.taskId,
      },
      undefined,
      acquired.lease,
    )
  } finally {
    await acquired.unlock()
  }
}

export async function stopRun(input: {
  store: RunStore
  runId: string
  reason: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
  stopDispatch?: (dispatchId: string, reason: string) => Promise<unknown>
}): Promise<DeliveryRun> {
  const acquired = await acquireAndLoad({
    store: input.store,
    runId: input.runId,
    sessionIsOpen: input.sessionIsOpen,
  })
  let persisted: DeliveryRun
  const dispatchIds = new Set<string>()
  if (acquired.run.activeDispatch?.status === 'running')
    dispatchIds.add(acquired.run.activeDispatch.dispatchId)
  try {
    const stopped = transitionDeliveryRun(acquired.run, {
      type: 'stop',
      reason: input.reason,
    })
    const interruptedDispatch = (dispatch: DispatchRecord): DispatchRecord => ({
      ...dispatch,
      status: 'interrupted',
      finishedAt: new Date().toISOString(),
      failureReason: input.reason,
    })
    persisted = {
      ...stopped,
      activeDispatch:
        stopped.activeDispatch?.status === 'running'
          ? interruptedDispatch(stopped.activeDispatch)
          : stopped.activeDispatch,
    }
    persisted = await input.store.commit(
      persisted,
      {
        runId: persisted.runId,
        type: 'run.stopped',
        phase: persisted.phase,
        status: persisted.status,
        revision: persisted.revision,
        reason: input.reason,
      },
      undefined,
      acquired.lease,
    )
  } finally {
    await acquired.unlock()
  }
  const stopResults = await Promise.allSettled(
    [...dispatchIds].map(dispatchId =>
      input.stopDispatch?.(dispatchId, input.reason),
    ),
  )
  const failedStop = stopResults.find(result => result.status === 'rejected')
  if (failedStop?.status === 'rejected') throw failedStop.reason
  return persisted
}
