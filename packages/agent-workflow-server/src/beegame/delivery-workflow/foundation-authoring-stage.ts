import type { FoundationAuthoringContext } from './foundation-authoring-context'
import { isAbsolute } from 'node:path'
import {
  commitAuthoredFoundationDocument,
  readAuthoredDocumentReceipt,
} from '../authored-document-receipt'
import { computeDocumentRevision, computeWorkspaceRevision } from './revision'
import { getGameDocumentContract } from './game-document-contracts'
import { foundationAuthoringSources } from './foundation-authoring-contract'
import {
  beginParallelFoundationAuthoring,
  recordFoundationCommit,
  recordFoundationFailure,
  readyDraftPaths,
} from './foundation-authoring-batch'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'
import type { WorkerTerminalResult } from './worker-contracts'
import {
  defaultAudit,
  readDocumentMetadata,
  parseSemanticVersion,
  documentMetadataIssues,
  type Dispatcher,
} from './document-publication-protocol'

function exactStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export async function startDocumentStage(input: {
  run: FoundationAuthoringContext
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (input.run.phase !== 'DOCUMENT_DRAFTING')
    throw new Error(
      `document stage requires DOCUMENT_DRAFTING, got ${input.run.phase}`,
    )
  const activeContract = input.run.activeDispatch?.request?.contract
  if (
    input.run.activeDispatch?.status === 'running' &&
    activeContract?.authoringMode === 'initial' &&
    (input.run.foundationDraftState.completedPaths.length !== 0 ||
      (activeContract.foundationDocumentPath as string | undefined) !==
        CANONICAL_FOUNDATION_DOCUMENTS[0])
  )
    throw new Error('legacy serial foundation authoring state is unsupported')
  if (input.run.activeDispatch?.status === 'running')
    return input.run.activeDispatch
  const foundationDraftState = input.run.foundationDraftState.documents
    ? input.run.foundationDraftState
    : input.run.foundationDraftState.completedPaths.length === 1 &&
        input.run.foundationDraftState.completedPaths[0] ===
          CANONICAL_FOUNDATION_DOCUMENTS[0]
      ? beginParallelFoundationAuthoring([
          CANONICAL_FOUNDATION_DOCUMENTS[0],
        ])
      : undefined
  if (foundationDraftState?.documents) {
    const pendingDrafts = readyDraftPaths(foundationDraftState)
    if (pendingDrafts.length) {
      return Promise.all(
        pendingDrafts.map(path =>
          input.dispatcher.dispatch({
            runId: input.run.runId,
            ownerId: input.run.ownerId,
            projectId: input.run.projectId,
            workspacePath: input.workspacePath,
            workerType: 'document-author',
            phase: 'DOCUMENT_DRAFTING',
            taskId: path,
            revision: input.run.revision.document,
            allowedPaths: [path],
            contract: {
              confirmedBriefDigest: input.run.confirmedBriefDigest,
              confirmedBriefContext: input.run.confirmedBriefContext,
              documentSet: 'foundation',
              systemDeliveryContract: buildSystemDeliveryContract(),
              authoringMode: 'parallel-draft',
              foundationDocumentPath: path,
              completeDocumentContract: getGameDocumentContract(path),
              availableUpstreamPaths: foundationAuthoringSources(path).map(
                section => section.path,
              ),
            },
          }),
        ),
      )
    }
    const hasUnsettledDraft = foundationDraftState.documents.some(
      document => document.status === 'drafting',
    )
    if (hasUnsettledDraft) return input.run.foundationDraftState
    return input.run.foundationDraftState
  }
  if (input.run.foundationDraftState.completedPaths.length !== 0)
    throw new Error('legacy serial foundation authoring state is unsupported')
  const initialPath = CANONICAL_FOUNDATION_DOCUMENTS[0]
  const previousDocumentMetadata = input.run.changeRequest
    ? (() => {
        const metadata = readDocumentMetadata(input.workspacePath, initialPath)
        return metadata ? { [initialPath]: metadata } : undefined
      })()
    : undefined
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    taskId: initialPath,
    revision: input.run.revision.document,
    allowedPaths: [initialPath],
    contract: {
      confirmedBriefDigest: input.run.confirmedBriefDigest,
      confirmedBriefContext: input.run.confirmedBriefContext,
      ...(input.run.changeRequest
        ? { changeRequest: input.run.changeRequest }
        : {}),
      documentSet: 'foundation',
      systemDeliveryContract: buildSystemDeliveryContract(),
      authoringMode: 'initial',
      foundationDocumentPath: initialPath,
      completeDocumentContract: getGameDocumentContract(initialPath),
      availableUpstreamPaths: foundationAuthoringSources(initialPath).map(
        source => source.path,
      ),
      ...(previousDocumentMetadata ? { previousDocumentMetadata } : {}),
    },
  })
}

export async function completeFoundationDocumentDraft(input: {
  run: FoundationAuthoringContext
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
}): Promise<FoundationAuthoringContext> {
  if (input.run.phase !== 'DOCUMENT_DRAFTING')
    throw new Error('foundation author completion requires DOCUMENT_DRAFTING')
  const authoringMode =
    input.run.activeDispatch?.request?.contract.authoringMode
  if (authoringMode === 'parallel-draft')
    return completeParallelFoundationDraft(input)
  const completedPaths = input.run.foundationDraftState.completedPaths
  if (
    authoringMode !== 'initial' ||
    completedPaths.length !== 0 ||
    (input.run.activeDispatch?.request?.contract
      .foundationDocumentPath as string | undefined) !==
      CANONICAL_FOUNDATION_DOCUMENTS[0]
  )
    throw new Error('legacy serial foundation authoring state is unsupported')
  const expectedPath = CANONICAL_FOUNDATION_DOCUMENTS[0]

  const normalizedWrittenPaths = input.terminal.writtenPaths.map(path =>
    path.split('\\').join('/'),
  )
  const dispatchId = input.run.activeDispatch?.dispatchId
  let commitReceipt = dispatchId
    ? await readAuthoredDocumentReceipt(input.workspacePath, dispatchId)
    : undefined
  let authoredCommitIssue: string | undefined
  if (!commitReceipt && dispatchId) {
    try {
      commitReceipt = await commitAuthoredFoundationDocument({
        workspacePath: input.workspacePath,
        dispatchId,
        targetPath: expectedPath,
      })
    } catch (error) {
      authoredCommitIssue =
        error instanceof Error
          ? error.message
          : 'authored document validation failed'
    }
  }
  const hasCommittedDocument =
    commitReceipt !== undefined &&
    commitReceipt.status === 'committed' &&
    commitReceipt.targetPath === expectedPath &&
    Boolean(commitReceipt.finalDigest)
  const canonicalizationIssues = authoredCommitIssue
    ? [`${expectedPath}: ${authoredCommitIssue}`]
    : []
  const metadata = readDocumentMetadata(input.workspacePath, expectedPath)
  const version = metadata ? parseSemanticVersion(metadata.version) : undefined
  const issues = [
    ...(!hasCommittedDocument
      ? [`${expectedPath}: committed canonical Markdown receipt is missing`]
      : []),
    ...(!exactStringSet(normalizedWrittenPaths, [expectedPath])
      ? [
          `initial document author must write exactly the active canonical document: ${expectedPath}`,
        ]
      : []),
    ...(normalizedWrittenPaths.some(
      path => isAbsolute(path) || path.split('/').includes('..'),
    )
      ? ['initial document author returned an unsafe document path']
      : []),
    ...canonicalizationIssues,
    ...(!metadata ||
    !version ||
    !Number.isFinite(Date.parse(metadata.updatedAt))
      ? [`${expectedPath}: canonical front matter is incomplete or invalid`]
      : []),
    ...documentMetadataIssues({
      workspacePath: input.workspacePath,
      writtenPaths: normalizedWrittenPaths,
      previous:
        input.run.activeDispatch?.request?.contract.previousDocumentMetadata,
    }),
    ...((input.terminal.resolvedFindingIds?.length ?? 0) > 0
      ? ['initial document author cannot resolve review findings']
      : []),
  ]
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const initialFoundationFailure =
    input.run.activeDispatch?.request?.contract.authoringMode === 'initial' &&
    input.run.activeDispatch?.request?.contract.documentSet === 'foundation'
  const failedActiveDispatch =
    issues.length && initialFoundationFailure && input.run.activeDispatch
      ? {
          ...input.run.activeDispatch,
          status: 'failed' as const,
          terminalResult: undefined,
          failureReason: issues.join('; '),
          finishedAt: new Date().toISOString(),
        }
      : input.run.activeDispatch
  const base: FoundationAuthoringContext = {
    ...input.run,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    // Retain the failed initial-author dispatch as terminal diagnostic evidence.
    activeDispatch: issues.length ? failedActiveDispatch : undefined,
    currentItemId: expectedPath,
    status: issues.length ? 'needs_action' : input.run.status,
    blockedReason: issues.length ? issues.join('; ') : undefined,
    updatedAt: new Date().toISOString(),
  }
  if (issues.length) return base

  const nextCompletedPaths = [...completedPaths, expectedPath]
  return {
    ...base,
    foundationDraftState: beginParallelFoundationAuthoring(nextCompletedPaths),
    currentItemId: undefined,
    blockedReason: undefined,
  }
}

async function completeParallelFoundationDraft(input: {
  run: FoundationAuthoringContext
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
}): Promise<FoundationAuthoringContext> {
  const path =
    input.run.activeDispatch?.request?.contract.foundationDocumentPath
  if (
    typeof path !== 'string' ||
    !CANONICAL_FOUNDATION_DOCUMENTS.includes(path as FoundationDocumentPath)
  )
    throw new Error('parallel foundation draft path is invalid')
  const canonicalPath = path as FoundationDocumentPath
  const normalizedWrittenPaths = input.terminal.writtenPaths.map(value =>
    value.split('\\').join('/'),
  )
  const dispatchId = input.run.activeDispatch?.dispatchId
  const receipt = dispatchId
    ? await readAuthoredDocumentReceipt(input.workspacePath, dispatchId)
    : undefined
  const issues = [
    ...(!receipt ||
    receipt.status !== 'committed' ||
    receipt.targetPath !== canonicalPath
      ? [`${canonicalPath}: committed Markdown stream receipt is missing`]
      : []),
    ...(!exactStringSet(normalizedWrittenPaths, [canonicalPath])
      ? [`parallel document author must write exactly ${canonicalPath}`]
      : []),
    ...(normalizedWrittenPaths.some(
      value => isAbsolute(value) || value.split('/').includes('..'),
    )
      ? ['parallel document author returned an unsafe document path']
      : []),
    ...((input.terminal.resolvedFindingIds?.length ?? 0) > 0
      ? ['parallel document author cannot resolve review findings']
      : []),
  ]
  if (issues.length)
    return {
      ...input.run,
      activeDispatch: undefined,
      foundationDraftState: recordFoundationFailure(
        input.run.foundationDraftState,
        canonicalPath,
        issues.join('; '),
      ),
      status: 'needs_action',
      blockedReason: issues.join('; '),
    }
  const foundationDraftState = recordFoundationCommit(
    input.run.foundationDraftState,
    canonicalPath,
  )
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const base: FoundationAuthoringContext = {
    ...input.run,
    activeDispatch: undefined,
    foundationDraftState,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    currentItemId: undefined,
    blockedReason: undefined,
    updatedAt: new Date().toISOString(),
  }
  if (
    foundationDraftState.completedPaths.length <
    CANONICAL_FOUNDATION_DOCUMENTS.length
  )
    return base
  const readiness = await defaultAudit(input.workspacePath, {
    includeChecklist: false,
    includeAssetManifest: false,
  })
  if (!readiness.valid)
    return {
      ...base,
      status: 'needs_action',
      blockedReason: readiness.issues.join('; '),
    }
  return {
    ...base,
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
  }
}
