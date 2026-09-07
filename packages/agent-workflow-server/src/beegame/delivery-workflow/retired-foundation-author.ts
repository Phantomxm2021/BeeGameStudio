import type { WorkerDispatchRequest } from './types'

export const RETIRED_FOUNDATION_AUTHOR =
  'Legacy eight-document authoring is retired; start a new invocation through the foundation-authoring public module. Historical records cannot be resumed.'

/** Recognition only: an unconsumed historical pause cannot execute or hand off.
 * Consumed controls remain readable evidence for already-started downstream work. */
export function assertNoRetiredAuthorHandoff(events: readonly {
  type?: unknown; runId?: unknown; foundationAuthoringPause?: unknown
}[], runId: string): void {
  const marker = events.findLast(event =>
    (event.type === 'run.created' || event.type === 'foundation.authoring.pause_changed') &&
    event.foundationAuthoringPause !== undefined)
  if (marker && (marker.runId !== runId || marker.foundationAuthoringPause !== null))
    throw new Error(RETIRED_FOUNDATION_AUTHOR)
}

/** Empty pre-invocation runs and public-module links are not legacy execution. */
export function assertNoRetiredAuthorRun(run: {
  phase?: unknown; authorStage?: unknown; foundationDraftState?: unknown; activeDispatch?: unknown
}): void {
  if (run.authorStage) return
  const draft = run.foundationDraftState as { completedPaths?: unknown[]; documents?: unknown[] } | undefined
  if (run.phase === 'DOCUMENT_DRAFTING' &&
    (draft?.completedPaths?.length || draft?.documents?.length))
    throw new Error(RETIRED_FOUNDATION_AUTHOR)
  const dispatch = run.activeDispatch as { workerType?: unknown; request?: WorkerDispatchRequest } | undefined
  if (dispatch?.workerType === 'document-author') {
    if (!dispatch.request) throw new Error(RETIRED_FOUNDATION_AUTHOR)
    assertSharedDocumentWorker(dispatch.request)
  }
}

/** Checklist is the only document author owned by the shared workflow. */
export function assertSharedDocumentWorker(request: WorkerDispatchRequest): void {
  if (request.workerType === 'document-author' &&
    (request.contract.documentSet !== 'checklist' || request.phase !== 'DOCUMENT_REVIEW'))
    throw new Error(RETIRED_FOUNDATION_AUTHOR)
}
