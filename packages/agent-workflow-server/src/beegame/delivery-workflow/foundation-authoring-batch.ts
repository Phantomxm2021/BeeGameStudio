import { getGameDocumentContract } from './game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DispatchRecord,
  type FoundationAuthoringStatus,
  type FoundationDocumentCheckpoint,
  type FoundationDocumentPath,
  type FoundationDraftState,
} from './types'

// The selected provider stopped delivering SSE events when all seven native
// authors started together during Chrome acceptance. Keep authoring parallel,
// but leave connection headroom for the runtime and refill the pool whenever
// one draft settles. This limits scheduling only; native sessions still own
// their thinking and file-operation sequence.
export const MAX_PARALLEL_FOUNDATION_DRAFTS = 4

function checkpoint(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
): FoundationDocumentCheckpoint {
  const value = state.documents?.find(document => document.path === path)
  if (!value) throw new Error(`foundation document is not in the batch: ${path}`)
  return value
}

function replace(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
  update: (value: FoundationDocumentCheckpoint) => FoundationDocumentCheckpoint,
): FoundationDraftState {
  const documents = state.documents?.map(document =>
    document.path === path ? update(document) : { ...document },
  )
  if (!documents)
    throw new Error('parallel foundation authoring state is missing')
  const next = { ...state, documents }
  return { ...next, completedPaths: foundationCommittedPrefix(next) }
}

export function beginParallelFoundationAuthoring(
  completedPaths: readonly FoundationDocumentPath[],
): FoundationDraftState {
  if (
    completedPaths.length !== 1 ||
    completedPaths[0] !== CANONICAL_FOUNDATION_DOCUMENTS[0]
  )
    throw new Error('parallel foundation authoring requires committed GDD')
  return {
    completedPaths: [...completedPaths],
    documents: CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => ({
      path,
      status: index === 0 ? 'committed' : 'pending',
    })),
  }
}

export function readyDraftPaths(
  state: FoundationDraftState,
): FoundationDocumentPath[] {
  const documents = state.documents ?? []
  const availableSlots = Math.max(
    0,
    MAX_PARALLEL_FOUNDATION_DRAFTS -
      documents.filter(document => document.status === 'drafting').length,
  )
  return documents
    .filter(document => document.path !== 'docs/GDD.md')
    .filter(document => document.status === 'pending')
    .filter(document =>
      getGameDocumentContract(document.path).upstreamSections.every(source =>
        documents.some(
          candidate =>
            candidate.path === source.path && candidate.status === 'committed',
        ),
      ),
    )
    .map(document => document.path)
    .slice(0, availableSlots)
}

export function recordFoundationDispatch(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
  status: Extract<FoundationAuthoringStatus, 'drafting'>,
  dispatch: DispatchRecord,
): FoundationDraftState {
  const current = checkpoint(state, path)
  if (dispatch.taskId !== path || dispatch.workerType !== 'document-author')
    throw new Error(`foundation dispatch does not match document: ${path}`)
  if (status === 'drafting' && current.status !== 'pending')
    throw new Error(`foundation document is not pending: ${path}`)
  return replace(state, path, value => ({
    ...value,
    status,
    dispatch: { ...dispatch },
    failureReason: undefined,
  }))
}

export function recordFoundationFailure(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
  reason: string,
): FoundationDraftState {
  if (!reason.trim()) throw new Error('foundation failure reason is required')
  const current = checkpoint(state, path)
  if (current.status !== 'drafting')
    throw new Error(`foundation document has no active dispatch: ${path}`)
  return replace(state, path, value => ({
    ...value,
    status: 'needs_action',
    dispatch: undefined,
    failureReason: reason,
  }))
}

export function recordFoundationHandlerFailure(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
  reason: string,
  dispatch: DispatchRecord,
): FoundationDraftState {
  if (!reason.trim()) throw new Error('foundation failure reason is required')
  const current = checkpoint(state, path)
  if (current.status !== 'drafting')
    throw new Error(`foundation document has no active dispatch: ${path}`)
  if (
    dispatch.taskId !== path ||
    dispatch.workerType !== 'document-author' ||
    dispatch.status !== 'completed' ||
    !dispatch.terminalResult
  )
    throw new Error(`foundation handler failure is not replayable: ${path}`)
  return replace(state, path, value => ({
    ...value,
    status: 'drafting',
    dispatch: { ...dispatch },
    failureReason: reason,
  }))
}

export function recordFoundationCommit(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
): FoundationDraftState {
  const current = checkpoint(state, path)
  if (current.status !== 'drafting')
    throw new Error(`foundation document must be drafting before commit: ${path}`)
  return replace(state, path, value => ({
    ...value,
    status: 'committed',
    dispatch: undefined,
    failureReason: undefined,
  }))
}

export function retryFoundationFailures(
  state: FoundationDraftState,
): FoundationDraftState {
  if (!state.documents) return state
  const documents = state.documents.map(document =>
    document.status === 'needs_action'
      ? {
          path: document.path,
          status: 'pending' as const,
        }
      : { ...document },
  )
  const next = { ...state, documents }
  return { ...next, completedPaths: foundationCommittedPrefix(next) }
}

export function foundationCommittedPrefix(
  state: FoundationDraftState,
): FoundationDocumentPath[] {
  const committed = new Set(
    (state.documents ?? [])
      .filter(document => document.status === 'committed')
      .map(document => document.path),
  )
  const prefix: FoundationDocumentPath[] = []
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    if (!committed.has(path)) break
    prefix.push(path)
  }
  return prefix
}
