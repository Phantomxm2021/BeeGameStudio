import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { transitionDeliveryRun } from './transition'
import { computeDocumentRevision, computeResourceRevision } from './revision'
import { restoreAcceptedReviewRemediationHandoff } from './document-stage'
import {
  DELIVERY_RUN_SCHEMA_VERSION,
  type DeliveryRun,
  type DispatchRecord,
  type WorkflowEvent,
} from './types'
import {
  WorkflowStoreError,
  type RunStore,
  type WorkflowSnapshotInspection,
} from './run-store'
import { projectExactResumeRun } from './recovery-projector'
import {
  migrateWorkflowSnapshot,
  SnapshotMigrationError,
} from './snapshot-migrations'
import { reconcileCanonicalDocumentCommitReceipt } from '../native-canonical-document-tool'
import {
  createResourceContentTerminalFromReceipt,
  reconcileResourceContentCommitReceipt,
} from '../native-resource-content-tool'

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
  if (
    typeof schemaVersion === 'number' &&
    Number.isInteger(schemaVersion) &&
    schemaVersion > DELIVERY_RUN_SCHEMA_VERSION
  )
    throw (
      input.inspection.error ??
      new WorkflowStoreError(
        `workflow snapshot schema version ${schemaVersion} is newer than current version ${DELIVERY_RUN_SCHEMA_VERSION}`,
        'invalid',
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

function migrationInspection(
  inspection: WorkflowSnapshotInspection,
): WorkflowSnapshotInspection {
  if (inspection.error?.code !== 'obsolete') return inspection
  try {
    const migrated = migrateWorkflowSnapshot(inspection.parsedValue)
    return {
      ...inspection,
      parsedValue: migrated.value,
      currentRun: migrated.value as DeliveryRun,
      error: undefined,
    }
  } catch (error) {
    if (
      error instanceof SnapshotMigrationError &&
      error.code === 'ambiguous_completed_unit'
    )
      throw new WorkflowStoreError(
        error.message,
        'recovery_checkpoint_conflict',
      )
    throw new WorkflowStoreError(
      error instanceof Error
        ? error.message
        : 'workflow snapshot migration failed',
      error instanceof SnapshotMigrationError &&
        error.code === 'unsupported_version'
        ? 'obsolete'
        : 'invalid',
    )
  }
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
        return {
          run: source.currentRun,
          resume:
            source.currentRun.status !== 'completed' &&
            source.currentRun.activeDispatch?.status !== 'running',
        }
      }
      try {
        await input.stopWorkspaceWorkers(
          'recovering obsolete or invalid delivery workflow',
        )
      } catch (error) {
        throw new WorkflowRecoveryTransactionError(
          'stale workflow workers could not be stopped',
          'recovery_worker_stop_failed',
          { cause: error },
        )
      }

      const stoppedSource = await input.store.inspectWorkflowSnapshot()
      if (stoppedSource.digest !== source.digest)
        throw new WorkflowStoreError(
          'workflow snapshot changed while stale workers were stopping',
          'recovery_snapshot_changed',
        )
      const migratedSource = migrationInspection(source)
      const projection = await projectExactResumeRun({
        inspection: migratedSource,
        events: await input.store.readEvents(),
        workspacePath,
        ownerId: input.ownerId,
        projectId: input.projectId,
        confirmedBriefContext: input.confirmedBriefContext,
      })
      const beforeReplacement = await input.store.inspectWorkflowSnapshot()
      if (beforeReplacement.digest !== source.digest)
        throw new WorkflowStoreError(
          'workflow snapshot changed during reconstruction',
          'recovery_snapshot_changed',
        )

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
        sourceSnapshotDigest: source.digest,
        replayedUnitIds: projection.replayedUnitIds,
        ...(projection.activeUnitId
          ? { activeUnitId: projection.activeUnitId }
          : {}),
      }
      await input.store.save({
        ...projection.run,
        pendingEvents: [reconstructedEvent],
      })
      const persisted = await input.store.load()
      if (!persisted || persisted.runId !== projection.run.runId)
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

async function restoreCanonicalDocumentCommit(
  run: DeliveryRun,
  workspacePath?: string,
): Promise<DeliveryRun> {
  const dispatch = run.activeDispatch
  if (
    !workspacePath ||
    !dispatch ||
    dispatch.workerType !== 'document-author' ||
    dispatch.request?.contract.authoringMode === 'repair-planning' ||
    dispatch.terminalResult
  )
    return run
  const receipt = await reconcileCanonicalDocumentCommitReceipt({
    workspacePath,
    dispatchId: dispatch.dispatchId,
  })
  if (!receipt) return run
  const finishedAt = new Date().toISOString()
  return {
    ...run,
    activeDispatch: {
      ...dispatch,
      status: 'completed',
      finishedAt,
      terminalResult: {
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: [receipt.targetPath],
        resolvedFindingIds: [],
      },
    },
    blockedReason: undefined,
    updatedAt: finishedAt,
  }
}

async function restoreResourceContentCommit(
  run: DeliveryRun,
  workspacePath?: string,
): Promise<DeliveryRun> {
  const dispatch = run.activeDispatch
  if (
    !workspacePath ||
    !dispatch ||
    dispatch.workerType !== 'resource-content-author' ||
    dispatch.terminalResult
  )
    return run
  const receipt = await reconcileResourceContentCommitReceipt({
    workspacePath,
    dispatchId: dispatch.dispatchId,
  })
  if (!receipt) return run
  const finishedAt = new Date().toISOString()
  return {
    ...run,
    activeDispatch: {
      ...dispatch,
      status: 'completed',
      finishedAt,
      failureReason: undefined,
      terminalResult: createResourceContentTerminalFromReceipt({
        workspacePath,
        revision: dispatch.revision,
        receipt,
      }),
    },
    blockedReason: undefined,
    updatedAt: finishedAt,
  }
}

function reviewRetryIsLocked(run: DeliveryRun): boolean {
  const cycle = run.documentReviewState.activeCycle
  return Boolean(
    run.phase === 'DOCUMENT_REVIEW' &&
      run.documentStep !== 'CHECKLIST_DRAFTING' &&
      cycle &&
      cycle.acceptedSemanticResult,
  )
}

async function unlockReviewForChangedRevision(input: {
  run: DeliveryRun
  workspacePath?: string
}): Promise<DeliveryRun | undefined> {
  const cycle = input.run.documentReviewState.activeCycle
  if (!cycle || !input.workspacePath || !reviewRetryIsLocked(input.run))
    return undefined
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const currentRevision =
    cycle.scope !== 'complete'
      ? documentRevision
      : await computeResourceRevision(input.workspacePath, documentRevision)
  if (currentRevision === cycle.sourceRevision) return undefined
  return {
    ...input.run,
    status: 'running',
    blockedReason: undefined,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      ...(cycle.scope === 'complete' ? { resource: currentRevision } : {}),
      implementation: undefined,
    },
    tasks: [],
    evidence:
      cycle.scope !== 'complete'
        ? {}
        : {
            resourcePreparation: input.run.evidence.resourcePreparation,
          },
    documentReviewState: {
      ...input.run.documentReviewState,
      ...(cycle.scope === 'foundation'
        ? {
            foundationApproval: undefined,
            checklistApproval: undefined,
            comprehensiveApproval: undefined,
          }
        : cycle.scope === 'checklist'
          ? {
              checklistApproval: undefined,
              comprehensiveApproval: undefined,
            }
          : { comprehensiveApproval: undefined }),
      activeCycle: undefined,
    },
    updatedAt: new Date().toISOString(),
  }
}

export async function reconcileRunOnStartup(input: {
  store: RunStore
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<DeliveryRun | null> {
  return input.store.reconcile(input.sessionIsOpen ?? (async () => false))
}

async function acquireAndLoad(input: {
  store: RunStore
  runId: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<{ run: DeliveryRun; unlock: () => Promise<void> }> {
  const run = await input.store.load()
  if (!run || run.runId !== input.runId)
    throw new Error('delivery run not found')
  await input.store.lock(run.runId, async () => {
    if (run.activeDispatch?.status !== 'running') return false
    return input.sessionIsOpen ? input.sessionIsOpen(run.activeDispatch) : true
  })
  return { run, unlock: () => input.store.unlock(run.runId) }
}

export async function resumeRun(input: {
  store: RunStore
  runId: string
  workspacePath?: string
  sessionIsOpen?: (dispatch: DispatchRecord) => Promise<boolean>
}): Promise<DeliveryRun> {
  const reconciled = await input.store.reconcile(
    input.sessionIsOpen ?? (async () => false),
  )
  if (!reconciled || reconciled.runId !== input.runId)
    throw new Error('delivery run not found')
  const acquired = await acquireAndLoad(input)
  try {
    acquired.run = await restoreCanonicalDocumentCommit(
      acquired.run,
      input.workspacePath,
    )
    acquired.run = await restoreResourceContentCommit(
      acquired.run,
      input.workspacePath,
    )
    if (acquired.run.status === 'completed') return acquired.run
    const restoredHandoff = restoreAcceptedReviewRemediationHandoff(
      acquired.run,
    )
    const retryable =
      acquired.run.status === 'needs_action' ||
      acquired.run.status === 'blocked' ||
      acquired.run.status === 'stopped' ||
      acquired.run.status === 'failed'
    const changedReview = restoredHandoff
      ? undefined
      : await unlockReviewForChangedRevision({
          run: acquired.run,
          workspacePath: input.workspacePath,
        })
    if (reviewRetryIsLocked(acquired.run) && !restoredHandoff && !changedReview)
      return acquired.run
    const resumed =
      restoredHandoff ??
      changedReview ??
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
    return input.store.commit(resumed, {
      runId: resumed.runId,
      type: 'run.resumed',
      phase: resumed.phase,
      status: resumed.status,
      revision: resumed.revision,
    })
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
  const reconciled = await input.store.reconcile(
    input.sessionIsOpen ?? (async () => false),
  )
  if (!reconciled || reconciled.runId !== input.runId)
    throw new Error('delivery run not found')
  const acquired = await acquireAndLoad(input)
  try {
    acquired.run = await restoreCanonicalDocumentCommit(
      acquired.run,
      input.workspacePath,
    )
    acquired.run = await restoreResourceContentCommit(
      acquired.run,
      input.workspacePath,
    )
    // A successful retry can race a duplicate browser request or a stale
    // workflow-card snapshot. The first request has already resumed the same
    // durable run, so repeating it must be an idempotent read rather than an
    // invalid state transition.
    if (
      acquired.run.status === 'running' &&
      !acquired.run.activeDispatch?.terminalResult
    )
      return acquired.run
    const restoredHandoff = restoreAcceptedReviewRemediationHandoff(
      acquired.run,
    )
    const changedReview = restoredHandoff
      ? undefined
      : await unlockReviewForChangedRevision({
          run: acquired.run,
          workspacePath: input.workspacePath,
        })
    if (reviewRetryIsLocked(acquired.run) && !restoredHandoff && !changedReview)
      return acquired.run
    const replayable =
      !input.taskId && acquired.run.activeDispatch?.terminalResult
    const resumed =
      restoredHandoff ??
      changedReview ??
      transitionDeliveryRun(
        {
          ...acquired.run,
          activeDispatch: replayable ? acquired.run.activeDispatch : undefined,
        },
        { type: 'retry', ...(input.taskId ? { taskId: input.taskId } : {}) },
      )
    return input.store.commit(resumed, {
      runId: resumed.runId,
      type: 'run.retry_requested',
      phase: resumed.phase,
      status: resumed.status,
      revision: resumed.revision,
      taskId: input.taskId,
    })
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
  try {
    const stopped = transitionDeliveryRun(acquired.run, {
      type: 'stop',
      reason: input.reason,
    })
    const persisted = {
      ...stopped,
      activeDispatch:
        stopped.activeDispatch?.status === 'running'
          ? {
              ...stopped.activeDispatch,
              status: 'interrupted' as const,
              finishedAt: new Date().toISOString(),
            }
          : stopped.activeDispatch,
    }
    if (acquired.run.activeDispatch?.status === 'running')
      await input.stopDispatch?.(
        acquired.run.activeDispatch.dispatchId,
        input.reason,
      )
    return input.store.commit(persisted, {
      runId: persisted.runId,
      type: 'run.stopped',
      phase: persisted.phase,
      status: persisted.status,
      revision: persisted.revision,
      reason: input.reason,
    })
  } finally {
    await acquired.unlock()
  }
}
