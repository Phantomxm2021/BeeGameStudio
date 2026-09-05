import type {
  DispatchRecord,
  FoundationDocumentPath,
  FoundationDraftState,
  WorkerDispatchRequest,
} from './types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

export function assertAuthorAcceptedDispatch(
  request: WorkerDispatchRequest,
  taskId: string,
): void {
  if (
    (request.contract.authoringMode !== 'initial' &&
      request.contract.authoringMode !== 'parallel-draft') ||
    request.contract.foundationDocumentPath !== taskId ||
    request.allowedPaths?.length !== 1 ||
    request.allowedPaths[0] !== taskId
  )
    throw new Error(
      'accepted document unit contradicts its completed dispatch contract',
    )
}

export function mapAuthorDispatches(
  state: FoundationDraftState,
  update: (dispatch: DispatchRecord | undefined) => DispatchRecord | undefined,
): FoundationDraftState {
  return {
    ...state,
    ...(state.documents
      ? {
          documents: state.documents.map(document => ({
            ...document,
            dispatch: update(document.dispatch),
          })),
        }
      : {}),
  }
}

export function newlyCommittedAuthorPaths(
  previous: FoundationDraftState,
  next: FoundationDraftState,
): FoundationDocumentPath[] {
  const paths =
    previous.documents && next.documents
      ? next.documents
          .filter(document => document.status === 'committed')
          .filter(
            document =>
              previous.documents!.find(
                candidate => candidate.path === document.path,
              )?.status !== 'committed',
          )
          .map(document => document.path)
      : next.completedPaths.slice(previous.completedPaths.length)
  if (paths.length > 1)
    throw new Error(
      'accepted document transition contains more than one dispatch-backed unit',
    )
  return paths
}

export function precedingAuthorUnit(state: FoundationDraftState): string[] {
  const path = state.completedPaths.at(-1)
  return path ? ['document:' + path] : []
}

export function authorHandoffCheckpoints(state: FoundationDraftState) {
  return state.documents
    ? state.documents.map(({ path, status }) => ({ path, status }))
    : CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
        path,
        status: state.completedPaths.includes(path)
          ? ('committed' as const)
          : ('pending' as const),
      }))
}

export function authorReadyForHandoff(state: FoundationDraftState): boolean {
  if (state.documents)
    return CANONICAL_FOUNDATION_DOCUMENTS.every(path =>
      state.documents!.some(
        document => document.path === path && document.status === 'committed',
      ),
    )
  return (
    state.completedPaths.length === CANONICAL_FOUNDATION_DOCUMENTS.length &&
    CANONICAL_FOUNDATION_DOCUMENTS.every(path =>
      state.completedPaths.includes(path),
    )
  )
}

export function preserveAuthorSession(
  request: WorkerDispatchRequest | undefined,
): boolean {
  return request?.contract.authoringMode === 'parallel-draft'
}

import {
  recordFoundationDispatch,
  recordFoundationFailure,
} from './foundation-authoring-batch'

export function claimAuthorBatchDispatch(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
  dispatch: DispatchRecord,
) {
  return {
    foundationDraftState: recordFoundationDispatch(
      state,
      path,
      'drafting',
      dispatch,
    ),
  }
}

export function failAuthorBatchDispatch(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
  reason: string,
) {
  return {
    foundationDraftState: recordFoundationFailure(state, path, reason),
    status: 'needs_action' as const,
  }
}

// This module owns only author state. It cannot receive or return audit/revision state.
export function foundationPathFor(
  request: WorkerDispatchRequest,
): FoundationDocumentPath | undefined {
  const path = request.contract.foundationDocumentPath
  const mode = request.contract.authoringMode
  return request.workerType === 'document-author' &&
    (mode === 'initial' || mode === 'parallel-draft') &&
    typeof path === 'string' &&
    CANONICAL_FOUNDATION_DOCUMENTS.includes(path as FoundationDocumentPath)
    ? (path as FoundationDocumentPath)
    : undefined
}

export function parallelFoundationPathFor(
  request: WorkerDispatchRequest,
): FoundationDocumentPath | undefined {
  return request.contract.authoringMode === 'parallel-draft'
    ? foundationPathFor(request)
    : undefined
}

export function isInitialAuthorRequest(
  request: WorkerDispatchRequest | undefined,
): boolean {
  return Boolean(
    request &&
      request.contract.authoringMode === 'initial' &&
      foundationPathFor(request),
  )
}

export function authorDispatch(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
): DispatchRecord | undefined {
  return state.documents?.find(document => document.path === path)?.dispatch
}

export function locateAuthorDispatch(
  state: FoundationDraftState,
  dispatchId: string,
) {
  const document = state.documents?.find(
    document => document.dispatch?.dispatchId === dispatchId,
  )
  return document?.dispatch
    ? { record: document.dispatch, path: document.path }
    : undefined
}

export function runningAuthorDispatches(
  state: FoundationDraftState,
): DispatchRecord[] {
  return (state.documents ?? []).flatMap(document =>
    document.dispatch?.status === 'running' ? [document.dispatch] : [],
  )
}

export function replaceAuthorDispatch(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
  dispatch: DispatchRecord,
): FoundationDraftState {
  if (!state.documents)
    throw new Error('parallel foundation authoring state is missing')
  return {
    ...state,
    documents: state.documents.map(document =>
      document.path === path ? { ...document, dispatch } : { ...document },
    ),
  }
}

export function retryAuthorState(
  state: FoundationDraftState,
  taskId?: string,
): { state: FoundationDraftState; revived: boolean; actionable: boolean } {
  let revived = false
  const actionable = !!state.documents?.some(
    document => document.status === 'needs_action',
  )
  if (!state.documents) return { state, revived, actionable }
  const documents = state.documents.map(document => {
    if (
      document.status !== 'needs_action' ||
      (taskId && document.path !== taskId)
    )
      return document
    revived = true
    return {
      ...document,
      status: 'pending' as const,
      dispatch: undefined,
      failureReason: undefined,
    }
  })
  return { state: { ...state, documents }, revived, actionable }
}

export function stopAuthorState(
  state: FoundationDraftState,
  reason: string,
  interrupt: (record: DispatchRecord) => DispatchRecord,
): FoundationDraftState {
  return {
    ...state,
    ...(state.documents
      ? {
          documents: state.documents.map(document =>
            document.dispatch?.status === 'running'
              ? {
                  ...document,
                  status: 'needs_action' as const,
                  failureReason: reason,
                  dispatch: interrupt(document.dispatch),
                }
              : document,
          ),
        }
      : {}),
  }
}
