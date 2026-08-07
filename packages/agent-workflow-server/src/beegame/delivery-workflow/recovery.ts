import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { transitionDeliveryRun } from './transition'
import {
  computeDocumentRevision,
  computeResourceContentDigest,
  computeResourceRevision,
  computeWorkspaceRevision,
} from './revision'
import { restoreAcceptedReviewRemediationHandoff } from './document-stage'
import { auditAssetContract, type AssetContractAudit } from '../asset-contract-audit'
import {
  DELIVERY_RUN_SCHEMA_VERSION,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
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

export function shouldRefreshProvisionalResourceInventory(
  run: Pick<DeliveryRun, 'phase' | 'resourceProductionState'>,
  audit: Pick<AssetContractAudit, 'valid' | 'requirements' | 'resources'>,
): boolean {
  if (
    !audit.valid ||
    run.phase !== 'RESOURCE_PREPARATION' ||
    run.resourceProductionState.currentTask !== 'RESOURCE_GATE'
  )
    return false

  const requiredRequirementIds = new Set(
    audit.requirements.filter(requirement => requirement.required).map(requirement => requirement.id),
  )
  const boundResourceIds = new Set(
    run.resourceProductionState.inventoryReceipt?.bindings
      .filter(binding => requiredRequirementIds.has(binding.requirementId))
      .flatMap(binding => binding.resourceIds) ?? [],
  )
  return audit.resources.some(
    resource =>
      resource.provisional &&
      resource.status === 'verified' &&
      resource.issues.length === 0 &&
      boundResourceIds.has(resource.id),
  )
}

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

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
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
    const identity = assertActiveRequestIdentity({
      ...input,
      snapshot,
      dispatch,
      request,
    })
    const contract = snapshotRecord(request.contract)
    const targetPath = stringValue(contract?.foundationDocumentPath)
    const completedPaths = stringArray(
      snapshotRecord(snapshot.foundationDraftState)?.completedPaths,
    )
    const targetIndex = targetPath
      ? CANONICAL_FOUNDATION_DOCUMENTS.indexOf(targetPath as never)
      : -1
    const rawActiveUnitId = proveExactRawActiveUnitId({
      inspection: input.inspection,
      workspacePath: input.workspacePath,
      ownerId: input.ownerId,
      projectId: input.projectId,
      confirmedBriefContext: input.confirmedBriefContext,
    })
    if (
      rawActiveUnitId !== `document:${targetPath}` ||
      contract?.authoringMode !== 'initial' ||
      !completedPaths ||
      targetIndex < 0 ||
      !sameStrings(
        completedPaths,
        CANONICAL_FOUNDATION_DOCUMENTS.slice(0, targetIndex),
      )
    )
      recoveryConflict(
        'canonical document receipt does not prove the exact active drafting unit',
      )
    const receipt = await reconcileCanonicalDocumentCommitReceipt({
      workspacePath: input.workspacePath,
      dispatchId: identity.dispatchId,
    })
    if (!receipt)
      return {
        inspection: input.inspection,
        events: input.events,
        acceptedUnits: [],
      }
    if (
      receipt.dispatchId !== identity.dispatchId ||
      receipt.targetPath !== targetPath ||
      receipt.documentId !==
        CANONICAL_PROJECT_DOCUMENT_IDS[
          targetPath as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
        ]
    )
      recoveryConflict(
        'canonical document receipt contradicts the proven active dispatch',
      )
    const confirmedBriefDigest = createHash('sha256')
      .update(input.confirmedBriefContext)
      .digest('hex')
    const [documentRevision, workspaceRevision] = await Promise.all([
      computeDocumentRevision(input.workspacePath, confirmedBriefDigest),
      computeWorkspaceRevision(input.workspacePath),
    ])
    const revision = {
      document: documentRevision,
      workspace: workspaceRevision,
    }
    const acceptedAt = receipt.updatedAt
    const unit: AcceptedWorkflowUnit = {
      eventSchemaVersion: 1,
      unitId: `document:${targetPath}`,
      kind: 'document',
      phase: 'DOCUMENT_DRAFTING',
      predecessorUnitIds:
        targetIndex === 0
          ? []
          : [`document:${CANONICAL_FOUNDATION_DOCUMENTS[targetIndex - 1]}`],
      inputRevision: documentRevision,
      dependencyDigests: { [targetPath]: receipt.finalDigest },
      dispatchId: identity.dispatchId,
      receiptRef: `.beegame/workflow/document-commits/${identity.dispatchId}.json`,
      acceptedAt,
      payload: { path: targetPath, revision: documentRevision },
    }
    const nextPath = CANONICAL_FOUNDATION_DOCUMENTS[targetIndex + 1]
    const documentReviewState =
      snapshotRecord(snapshot.documentReviewState) ?? {}
    const parsedValue = {
      ...snapshot,
      revision,
      status: 'running',
      activeDispatch: undefined,
      foundationDraftState: { completedPaths: [...completedPaths, targetPath] },
      ...(nextPath
        ? {
            phase: 'DOCUMENT_DRAFTING',
            documentStep: 'FOUNDATION_DRAFTING',
            currentItemId: nextPath,
          }
        : {
            phase: 'DOCUMENT_REVIEW',
            documentStep: 'FOUNDATION_REVIEW',
            currentItemId: FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS[0],
            documentReviewState: {
              ...documentReviewState,
              activeCycle: {
                requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
                completedCheckIds: [],
              },
            },
          }),
      updatedAt: acceptedAt,
    }
    const activeUnitId = nextPath
      ? `document:${nextPath}`
      : `review:${FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS[0]}`
    if (acceptedUnitAlreadyJournaled(input.events, unit.unitId))
      return {
        inspection: { ...input.inspection, parsedValue },
        events: input.events,
        acceptedUnits: [],
        receiptReconciliation: {
          sourceInspection: input.inspection,
          successorActiveUnitId: activeUnitId,
        },
      }
    return {
      inspection: { ...input.inspection, parsedValue },
      events: [
        ...input.events,
        acceptedEvent({ ...input, unit, runId: identity.runId, revision }),
      ],
      acceptedUnits: [unit],
      receiptReconciliation: {
        sourceInspection: input.inspection,
        successorActiveUnitId: activeUnitId,
      },
    }
  }

  if (dispatch.workerType === 'resource-content-author') {
    const identity = assertActiveRequestIdentity({
      ...input,
      snapshot,
      dispatch,
      request,
    })
    const receipt = await reconcileResourceContentCommitReceipt({
      workspacePath: input.workspacePath,
      dispatchId: identity.dispatchId,
      assertMutationAuthority: input.assertMutationAuthority,
    })
    if (!receipt)
      return {
        inspection: input.inspection,
        events: input.events,
        acceptedUnits: [],
      }
    const contract = snapshotRecord(request.contract)
    const resourceState = snapshotRecord(snapshot.resourceProductionState)
    const inventory = snapshotRecord(resourceState?.inventoryReceipt)
    if (
      request.phase !== 'RESOURCE_PREPARATION' ||
      contract?.task !== 'RESOURCE_CONTENT' ||
      resourceState?.currentTask !== 'RESOURCE_CONTENT' ||
      !inventory ||
      contract.inventoryRevision !== inventory.revision
    )
      recoveryConflict(
        'Resource Content receipt does not prove the exact active production unit',
      )
    const confirmedBriefDigest = createHash('sha256')
      .update(input.confirmedBriefContext)
      .digest('hex')
    const [documentRevision, workspaceRevision] = await Promise.all([
      computeDocumentRevision(input.workspacePath, confirmedBriefDigest),
      computeWorkspaceRevision(input.workspacePath),
    ])
    const revision = {
      document: documentRevision,
      workspace: workspaceRevision,
    }
    const acceptedAt = new Date().toISOString()
    if (receipt.action === 'needs_inventory') {
      const parsedValue = {
        ...snapshot,
        revision,
        status: 'running',
        activeDispatch: undefined,
        resourceProductionState: { currentTask: 'RESOURCE_INVENTORY' },
        updatedAt: acceptedAt,
      }
      return {
        inspection: { ...input.inspection, parsedValue },
        events: input.events,
        acceptedUnits: [],
      }
    }
    const terminal = createResourceContentTerminalFromReceipt({
      workspacePath: input.workspacePath,
      revision: stringValue(dispatch.revision) ?? documentRevision,
      receipt,
    })
    if (terminal.status !== 'completed')
      recoveryConflict('Resource Content receipt is not a committed terminal')
    const contentDigest = await computeResourceContentDigest(
      input.workspacePath,
    )
    const unit: AcceptedWorkflowUnit = {
      eventSchemaVersion: 1,
      unitId: 'resource:content',
      kind: 'resource-content',
      phase: 'RESOURCE_PREPARATION',
      predecessorUnitIds: ['resource:inventory'],
      inputRevision: contentDigest,
      dependencyDigests: { content: contentDigest },
      dispatchId: identity.dispatchId,
      receiptRef: `.beegame/workflow/resource-content-commits/${identity.dispatchId}.json`,
      acceptedAt,
      payload: { contentDigest },
    }
    const parsedValue = {
      ...snapshot,
      revision,
      phase: 'RESOURCE_PREPARATION',
      status: 'running',
      activeDispatch: undefined,
      resourceProductionState: {
        ...resourceState,
        currentTask: 'RESOURCE_GATE',
        contentReceipt: { contentDigest, acceptedAt },
      },
      updatedAt: acceptedAt,
    }
    if (acceptedUnitAlreadyJournaled(input.events, unit.unitId))
      return {
        inspection: { ...input.inspection, parsedValue },
        events: input.events,
        acceptedUnits: [],
      }
    return {
      inspection: { ...input.inspection, parsedValue },
      events: [
        ...input.events,
        acceptedEvent({ ...input, unit, runId: identity.runId, revision }),
      ],
      acceptedUnits: [unit],
    }
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
  if (schemaVersion !== DELIVERY_RUN_SCHEMA_VERSION)
    throw (
      input.inspection.error ??
      new WorkflowStoreError(
        `workflow snapshot schema version ${schemaVersion} is not the current version ${DELIVERY_RUN_SCHEMA_VERSION}`,
        typeof schemaVersion === 'number' &&
          Number.isInteger(schemaVersion) &&
          schemaVersion < DELIVERY_RUN_SCHEMA_VERSION
          ? 'obsolete'
          : 'invalid',
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
        return {
          run: source.currentRun,
          resume:
            source.currentRun.status !== 'completed' &&
            source.currentRun.activeDispatch?.status !== 'running',
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
  store?: RunStore,
): Promise<DeliveryRun> {
  const dispatch = run.activeDispatch
  if (
    !workspacePath ||
    !dispatch ||
    dispatch.workerType !== 'resource-content-author' ||
    dispatch.terminalResult
  )
    return run
  const assertMutationAuthority = async () => {
    if (!store)
      recoveryConflict(
        'Resource Content receipt recovery has no workflow store authority',
      )
    const current = (await store.inspectWorkflowSnapshot()).currentRun
    if (
      !current ||
      current.runId !== run.runId ||
      current.activeDispatch?.dispatchId !== dispatch.dispatchId ||
      current.activeDispatch.terminalResult
    )
      recoveryConflict(
        'Resource Content receipt recovery lost exact dispatch authority',
      )
  }
  const receipt = await reconcileResourceContentCommitReceipt({
    workspacePath,
    dispatchId: dispatch.dispatchId,
    assertMutationAuthority,
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
}): Promise<{
  run: DeliveryRun
  lease: WorkflowLock
  unlock: () => Promise<void>
}> {
  const lease = await input.store.lock(input.runId, async () => {
    const current = (await input.store.inspectWorkflowSnapshot()).currentRun
    if (!current || current.runId !== input.runId) return false
    if (current.activeDispatch?.status !== 'running') return false
    return input.sessionIsOpen
      ? input.sessionIsOpen(current.activeDispatch)
      : true
  })
  try {
    const run = await input.store.reconcile(
      input.sessionIsOpen ?? (async () => false),
      lease,
    )
    if (!run || run.runId !== input.runId)
      throw new Error('delivery run not found')
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
    if (
      acquired.run.status === 'completed' ||
      acquired.run.activeDispatch?.status === 'running'
    )
      return acquired.run
    acquired.run = await restoreCanonicalDocumentCommit(
      acquired.run,
      input.workspacePath,
    )
    acquired.run = await restoreResourceContentCommit(
      acquired.run,
      input.workspacePath,
      input.store,
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
    acquired.run = await restoreCanonicalDocumentCommit(
      acquired.run,
      input.workspacePath,
    )
    acquired.run = await restoreResourceContentCommit(
      acquired.run,
      input.workspacePath,
      input.store,
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
    const resourceRefresh =
      !restoredHandoff &&
      !changedReview &&
      input.workspacePath &&
      shouldRefreshProvisionalResourceInventory(
        acquired.run,
        auditAssetContract(input.workspacePath),
      )
    const retryBaseRun = resourceRefresh
      ? {
          ...acquired.run,
          resourceProductionState: {
            currentTask: 'RESOURCE_INVENTORY' as const,
          },
        }
      : acquired.run
    const replayable =
      !input.taskId && acquired.run.activeDispatch?.terminalResult
    const resumed =
      restoredHandoff ??
      changedReview ??
      transitionDeliveryRun(
        {
          ...retryBaseRun,
          activeDispatch: replayable ? retryBaseRun.activeDispatch : undefined,
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
    return input.store.commit(
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
}
