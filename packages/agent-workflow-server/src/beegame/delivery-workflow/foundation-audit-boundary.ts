import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'

export const FOUNDATION_AUDIT_UNAVAILABLE =
  'foundation audit implementation unavailable'

export function canStartFoundationAudit(run: DeliveryRun): boolean {
  const documents = run.foundationDraftState.documents
  if (documents)
    return CANONICAL_FOUNDATION_DOCUMENTS.every(path =>
      documents.some(
        document => document.path === path && document.status === 'committed',
      ),
    )
  return (
    run.foundationDraftState.completedPaths.length ===
      CANONICAL_FOUNDATION_DOCUMENTS.length &&
    CANONICAL_FOUNDATION_DOCUMENTS.every(path =>
      run.foundationDraftState.completedPaths.includes(path),
    )
  )
}

export function applyFoundationAuditBoundary(input: {
  run: DeliveryRun
}): DeliveryRun {
  if (!canStartFoundationAudit(input.run)) return input.run
  // The clean cutover deliberately stops here. Task 2 owns the replacement
  // audit implementation and its dispatch contract.
  return {
    ...input.run,
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    status: 'needs_action',
    activeDispatch: undefined,
    blockedReason: FOUNDATION_AUDIT_UNAVAILABLE,
    thinking: 'idle',
  }
}
