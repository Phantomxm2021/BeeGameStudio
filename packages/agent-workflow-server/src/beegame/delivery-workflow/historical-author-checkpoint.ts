import type { DispatchRecord, FoundationDocumentPath } from './types'

/** Persisted legacy evidence only. Never use these DTOs to schedule Author work. */
export type HistoricalAuthoringStatus =
  | 'pending'
  | 'drafting'
  | 'committed'
  | 'needs_action'

export type HistoricalAuthorDocumentCheckpoint = {
  path: FoundationDocumentPath
  status: HistoricalAuthoringStatus
  upstreamDigests?: Record<string, string>
  dispatch?: DispatchRecord
  failureReason?: string
}

/** Preserve the on-disk shape for historical display and downstream evidence validation.
 * New Author execution stores its handle/result in authorStage, not these checkpoints.
 */
export type HistoricalAuthorDraftState = {
  completedPaths: FoundationDocumentPath[]
  documents?: HistoricalAuthorDocumentCheckpoint[]
}
