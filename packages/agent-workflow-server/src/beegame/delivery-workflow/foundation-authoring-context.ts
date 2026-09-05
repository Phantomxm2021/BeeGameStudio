import type { DeliveryRun } from './types'

// The disk envelope stays unchanged; these are the only fields authors can see.
export type FoundationAuthoringContext = Pick<
  DeliveryRun,
  | 'runId'
  | 'ownerId'
  | 'projectId'
  | 'confirmedBriefDigest'
  | 'confirmedBriefContext'
  | 'phase'
  | 'documentStep'
  | 'status'
  | 'foundationDraftState'
  | 'activeDispatch'
  | 'changeRequest'
  | 'currentItemId'
  | 'blockedReason'
  | 'updatedAt'
> & { revision: Pick<DeliveryRun['revision'], 'document' | 'workspace'> }

export function projectAuthoringContext(
  run: DeliveryRun,
): FoundationAuthoringContext {
  if (run.phase !== 'DOCUMENT_DRAFTING')
    throw new Error('author context requires DOCUMENT_DRAFTING')
  return structuredClone({
    runId: run.runId,
    ownerId: run.ownerId,
    projectId: run.projectId,
    confirmedBriefDigest: run.confirmedBriefDigest,
    confirmedBriefContext: run.confirmedBriefContext,
    phase: run.phase,
    documentStep: run.documentStep,
    status: run.status,
    foundationDraftState: run.foundationDraftState,
    activeDispatch: run.activeDispatch,
    changeRequest: run.changeRequest,
    currentItemId: run.currentItemId,
    blockedReason: run.blockedReason,
    updatedAt: run.updatedAt,
    revision: {
      document: run.revision.document,
      workspace: run.revision.workspace,
    },
  })
}

export function applyAuthoringContext(
  run: DeliveryRun,
  result: FoundationAuthoringContext,
): DeliveryRun {
  if (run.phase !== 'DOCUMENT_DRAFTING')
    throw new Error('author update requires DOCUMENT_DRAFTING')
  if (
    result.runId !== run.runId ||
    result.ownerId !== run.ownerId ||
    result.projectId !== run.projectId
  )
    throw new Error('author update identity does not match its run')
  if (
    result.phase !== 'DOCUMENT_DRAFTING' &&
    !(
      result.phase === 'DOCUMENT_REVIEW' &&
      result.documentStep === 'FOUNDATION_REVIEW'
    )
  )
    throw new Error('author update has an invalid handoff')
  // Do not spread the result: stage-private code has no write authority over
  // audit state, resource state, implementation tasks or their revision fields.
  return {
    ...run,
    phase: result.phase,
    documentStep: result.documentStep,
    status: result.status,
    foundationDraftState: structuredClone(result.foundationDraftState),
    activeDispatch: structuredClone(result.activeDispatch),
    currentItemId: result.currentItemId,
    blockedReason: result.blockedReason,
    updatedAt: result.updatedAt,
    revision: {
      ...run.revision,
      document: result.revision.document,
      workspace: result.revision.workspace,
    },
  }
}
