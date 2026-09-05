import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { foundationAuthoringSources } from './foundation-authoring-contract'
import {
  record,
  stringValue,
  stringArray,
  sameStrings,
} from './recovery-values'

export function authorUnitPredecessors(unitId: string): string[] | undefined {
  const index = CANONICAL_FOUNDATION_DOCUMENTS.findIndex(
    path => 'document:' + path === unitId,
  )
  if (index < 0) return undefined
  return index === 0
    ? []
    : ['document:' + CANONICAL_FOUNDATION_DOCUMENTS[index - 1]!]
}

export function validateAuthorCompletedProofs(input: {
  completedPaths: unknown
  provenUnitIds: ReadonlySet<string>
  reject(
    code: 'recovery_checkpoint_missing' | 'recovery_checkpoint_conflict',
    message: string,
  ): never
}): void {
  const paths = stringArray(input.completedPaths)
  if (!paths) return
  if (
    !sameStrings(paths, CANONICAL_FOUNDATION_DOCUMENTS.slice(0, paths.length))
  )
    input.reject(
      'recovery_checkpoint_conflict',
      'snapshot completed documents are outside the current canonical prefix',
    )
  for (const path of paths)
    if (!input.provenUnitIds.has('document:' + path))
      input.reject(
        'recovery_checkpoint_missing',
        `snapshot-completed document ${path} has no dispatch-bound accepted journal event`,
      )
}

type AuthorRecoverySnapshot = {
  phase?: unknown
  documentStep?: unknown
  runId?: unknown
  ownerId?: unknown
  projectId?: unknown
  confirmedBriefDigest?: unknown
  revision?: unknown
  activeDispatch?: unknown
  currentItemId?: unknown
  foundationDraftState?: unknown
}

export function recoverAuthorActiveUnit(input: {
  snapshot: AuthorRecoverySnapshot
  workspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
  reject(
    code: 'recovery_checkpoint_conflict' | 'recovery_checkpoint_missing',
    message: string,
  ): never
}): string | undefined {
  const { snapshot } = input
  const dispatch = record(snapshot.activeDispatch)
  const currentItemId = stringValue(snapshot.currentItemId)
  if (
    currentItemId &&
    CANONICAL_FOUNDATION_DOCUMENTS.includes(currentItemId as never)
  ) {
    if (
      snapshot.phase !== 'DOCUMENT_DRAFTING' ||
      snapshot.documentStep !== 'FOUNDATION_DRAFTING'
    )
      input.reject(
        'recovery_checkpoint_conflict',
        'canonical document current item contradicts the raw workflow phase',
      )
    const request = record(dispatch?.request)
    if (!dispatch || !request)
      input.reject(
        'recovery_checkpoint_missing',
        'unfinished canonical document has no active dispatch proof',
      )
    const contract = record(request.contract)
    if (
      contract?.authoringMode === 'initial' &&
      currentItemId !== CANONICAL_FOUNDATION_DOCUMENTS[0]
    )
      input.reject(
        'recovery_checkpoint_conflict',
        'legacy serial initial authoring may only target the GDD',
      )
    const dispatchId = stringValue(dispatch.dispatchId)
    const runId = stringValue(snapshot.runId)
    const dispatchTaskId = stringValue(dispatch.taskId)
    const requestTaskId = stringValue(request.taskId)
    const dispatchRevision = stringValue(dispatch.revision)
    const requestRevision = stringValue(request.revision)
    const documentRevision = stringValue(record(snapshot.revision)?.document)
    const requestWorkspacePath = stringValue(request.workspacePath)
    const allowedPaths = stringArray(request.allowedPaths)
    const completedPaths = stringArray(
      record(snapshot.foundationDraftState)?.completedPaths,
    )
    const targetIndex = CANONICAL_FOUNDATION_DOCUMENTS.indexOf(
      currentItemId as never,
    )
    const expectedBriefDigest = createHash('sha256')
      .update(input.confirmedBriefContext)
      .digest('hex')
    const upstreamPaths = stringArray(contract?.availableUpstreamPaths)
    if (
      !dispatchId ||
      !runId ||
      !dispatchTaskId ||
      !requestTaskId ||
      !dispatchRevision ||
      !requestRevision ||
      !documentRevision ||
      !requestWorkspacePath ||
      dispatch.status !== 'running' ||
      dispatch.workerType !== 'document-author' ||
      dispatch.phase !== 'DOCUMENT_DRAFTING' ||
      dispatchTaskId !== currentItemId ||
      request.dispatchId !== dispatchId ||
      request.runId !== runId ||
      request.ownerId !== input.ownerId ||
      request.projectId !== input.projectId ||
      snapshot.ownerId !== input.ownerId ||
      snapshot.projectId !== input.projectId ||
      resolve(requestWorkspacePath) !== resolve(input.workspacePath) ||
      request.workerType !== dispatch.workerType ||
      request.phase !== dispatch.phase ||
      requestTaskId !== currentItemId ||
      requestRevision !== dispatchRevision ||
      dispatchRevision !== documentRevision ||
      snapshot.confirmedBriefDigest !== expectedBriefDigest ||
      contract?.confirmedBriefDigest !== expectedBriefDigest ||
      contract?.documentSet !== 'foundation' ||
      contract.authoringMode !== 'initial' ||
      contract.foundationDocumentPath !== currentItemId ||
      !allowedPaths ||
      !sameStrings(allowedPaths, [currentItemId]) ||
      !upstreamPaths ||
      !sameStrings(
        upstreamPaths,
        foundationAuthoringSources(currentItemId as never).map(
          source => source.path,
        ),
      ) ||
      !completedPaths ||
      targetIndex < 0 ||
      !sameStrings(
        completedPaths,
        CANONICAL_FOUNDATION_DOCUMENTS.slice(0, targetIndex),
      )
    )
      input.reject(
        'recovery_checkpoint_conflict',
        'canonical document current item contradicts its active dispatch proof',
      )
    return 'document:' + currentItemId
  }
  return undefined
}

export async function reconcileAuthorRecoveryReceipt(input: {
  workspacePath: string
  dispatchId: string
  targetPath: string | undefined
  completedPaths: string[] | undefined
  authoringMode: unknown
  rawActiveUnitId: string | undefined
  confirmedBriefContext: string
  reject(message: string): never
}) {
  const { targetPath, completedPaths, rawActiveUnitId } = input
  const targetIndex = targetPath
    ? CANONICAL_FOUNDATION_DOCUMENTS.indexOf(targetPath as never)
    : -1
  if (
    rawActiveUnitId !== `document:${targetPath}` ||
    input.authoringMode !== 'initial' ||
    !targetPath ||
    targetPath !== CANONICAL_FOUNDATION_DOCUMENTS[0] ||
    !completedPaths ||
    targetIndex < 0 ||
    !sameStrings(
      completedPaths,
      CANONICAL_FOUNDATION_DOCUMENTS.slice(0, targetIndex),
    )
  )
    input.reject(
      'canonical document receipt does not prove the exact active drafting unit',
    )
  const receipt = await reconcileAuthoredDocumentReceipt({
    workspacePath: input.workspacePath,
    dispatchId: input.dispatchId,
  })
  if (!receipt) return undefined
  if (receipt.status !== 'committed')
    input.reject(
      'canonical Foundation document receipt is missing committed authority',
    )
  if (
    receipt.dispatchId !== input.dispatchId ||
    receipt.targetPath !== targetPath ||
    receipt.documentId !==
      CANONICAL_PROJECT_DOCUMENT_IDS[
        targetPath as keyof typeof CANONICAL_PROJECT_DOCUMENT_IDS
      ]
  )
    input.reject(
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
    dependencyDigests: {
      [targetPath]: receipt.finalDigest,
    },
    dispatchId: input.dispatchId,
    receiptRef: `.beegame/workflow/document-commits/${input.dispatchId}.json`,
    acceptedAt,
    payload: { path: targetPath, revision: documentRevision },
  }
  const nextPath = CANONICAL_FOUNDATION_DOCUMENTS[targetIndex + 1]
  return {
    unit,
    revision,
    acceptedAt,
    nextPath,
    completedPaths: [...completedPaths, targetPath],
  }
}

export async function restoreAuthorDispatchReceipt(
  workspacePath: string | undefined,
  dispatch: DispatchRecord | undefined,
) {
  if (
    !workspacePath ||
    !dispatch ||
    dispatch.workerType !== 'document-author' ||
    dispatch.terminalResult
  )
    return undefined
  const contract = dispatch.request?.contract
  if (
    contract?.authoringMode === 'initial' &&
    contract.foundationDocumentPath !== CANONICAL_FOUNDATION_DOCUMENTS[0]
  )
    throw new Error('legacy serial initial authoring may only target the GDD')
  const receipt = await reconcileAuthoredDocumentReceipt({
    workspacePath,
    dispatchId: dispatch.dispatchId,
  })
  if (!receipt) return undefined
  const finishedAt = new Date().toISOString()
  return {
    dispatch: {
      ...dispatch,
      status: 'completed' as const,
      finishedAt,
      terminalResult: {
        workerType: 'document-author' as const,
        status: 'completed' as const,
        writtenPaths: [receipt.targetPath],
        resolvedFindingIds: [],
      },
    },
    finishedAt,
  }
}

import { reconcileAuthoredDocumentReceipt } from '../authored-document-receipt'
import { computeDocumentRevision, computeWorkspaceRevision } from './revision'
import {
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type AcceptedWorkflowUnit,
  type DispatchRecord,
} from './types'
