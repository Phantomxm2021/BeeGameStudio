import { getGameDocumentContract } from './game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DispatchRecord,
  type FoundationAuthoringStatus,
  type FoundationDocumentCheckpoint,
  type FoundationDocumentPath,
  type FoundationDraftState,
} from './types'

const DIGEST = /^[a-f0-9]{64}$/

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
    .map(document => document.path)
    .slice(0, availableSlots)
}

export function readyCalibrationPaths(
  state: FoundationDraftState,
): FoundationDocumentPath[] {
  const committed = new Set(
    (state.documents ?? [])
      .filter(document => document.status === 'committed')
      .map(document => document.path),
  )
  return (state.documents ?? [])
    .filter(document => document.status === 'drafted')
    .filter(document =>
      getGameDocumentContract(document.path).upstreamSections.every(source =>
        committed.has(source.path),
      ),
    )
    .map(document => document.path)
}

export function recordFoundationDraft(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
  input: { digest: string; workerSessionId: string },
): FoundationDraftState {
  if (!DIGEST.test(input.digest))
    throw new Error('foundation draft digest must be lowercase sha256')
  if (!input.workerSessionId.trim())
    throw new Error('foundation draft worker session is required')
  const current = checkpoint(state, path)
  if (current.status !== 'pending' && current.status !== 'drafting')
    throw new Error(`foundation document is not pending or drafting: ${path}`)
  return replace(state, path, value => ({
    path: value.path,
    status: 'drafted',
    draftDigest: input.digest,
    workerSessionId: input.workerSessionId,
  }))
}

export function recordFoundationDispatch(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
  status: Extract<FoundationAuthoringStatus, 'drafting' | 'calibrating'>,
  dispatch: DispatchRecord,
): FoundationDraftState {
  const current = checkpoint(state, path)
  if (dispatch.taskId !== path || dispatch.workerType !== 'document-author')
    throw new Error(`foundation dispatch does not match document: ${path}`)
  if (status === 'drafting' && current.status !== 'pending')
    throw new Error(`foundation document is not pending: ${path}`)
  if (
    status === 'calibrating' &&
    (current.status !== 'drafted' ||
      !readyCalibrationPaths(state).includes(path))
  )
    throw new Error(`foundation document is not ready to calibrate: ${path}`)
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
  if (current.status !== 'drafting' && current.status !== 'calibrating')
    throw new Error(`foundation document has no active dispatch: ${path}`)
  return replace(state, path, value => ({
    ...value,
    status: 'needs_action',
    dispatch: undefined,
    failureReason: reason,
  }))
}

export function recordFoundationCommit(
  state: FoundationDraftState,
  path: FoundationDocumentPath,
): FoundationDraftState {
  const current = checkpoint(state, path)
  if (current.status !== 'drafted' && current.status !== 'calibrating')
    throw new Error(`foundation document must be drafted before commit: ${path}`)
  const ready = readyCalibrationPaths(state)
  if (current.status === 'drafted' && !ready.includes(path))
    throw new Error(`foundation document upstream authority is incomplete: ${path}`)
  return replace(state, path, value => ({
    ...value,
    status: 'committed',
    dispatch: undefined,
    failureReason: undefined,
  }))
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
