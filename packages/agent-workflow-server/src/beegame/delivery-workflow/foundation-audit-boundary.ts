import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'

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
