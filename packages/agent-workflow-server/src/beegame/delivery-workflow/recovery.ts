import { transitionDeliveryRun } from './transition'
import { computeDocumentRevision, computeResourceRevision } from './revision'
import { restoreAcceptedReviewRemediationHandoff } from './document-stage'
import type { DeliveryRun, DispatchRecord } from './types'
import type { RunStore } from './run-store'
import { reconcileCanonicalDocumentCommitReceipt } from '../native-canonical-document-tool'

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

function withResourcePreparationAttempt(run: DeliveryRun): DeliveryRun {
  if (
    run.phase !== 'RESOURCE_PREPARATION' ||
    !run.blockedReason ||
    (run.status !== 'needs_action' &&
      run.status !== 'failed' &&
      run.status !== 'blocked')
  )
    return run
  const activeCycle = run.documentReviewState.activeCycle
  if (
    activeCycle?.acceptedSemanticResult &&
    activeCycle.activeTarget === 'resource'
  )
    return run
  return {
    ...run,
    resourcePreparationAttempt: Math.max(
      1,
      run.resourcePreparationAttempt ?? 0,
    ),
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
    cycle.scope === 'foundation'
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
      cycle.scope === 'foundation'
        ? {}
        : {
            resourcePreparation: input.run.evidence.resourcePreparation,
          },
    documentReviewState: {
      ...input.run.documentReviewState,
      ...(cycle.scope === 'foundation'
        ? { foundationApproval: undefined, comprehensiveApproval: undefined }
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
              ...withResourcePreparationAttempt(acquired.run),
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
          ...withResourcePreparationAttempt(acquired.run),
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
