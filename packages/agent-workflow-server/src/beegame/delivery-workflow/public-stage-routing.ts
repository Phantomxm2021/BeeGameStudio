import type { DeliveryRun } from './types'

/** Completed stage links are provenance, not evidence that execution is still active. */
export function isFoundationStageActive(run: Pick<DeliveryRun, 'phase' | 'documentStep' | 'authorStage' | 'foundationReviewStage'>): boolean {
  return Boolean((run.authorStage || run.foundationReviewStage) &&
    (run.phase === 'DOCUMENT_DRAFTING' || run.phase === 'DOCUMENT_REVIEW' &&
      run.documentStep !== 'CHECKLIST_DRAFTING'))
}

export function isPublicStageActive(run: DeliveryRun): boolean {
  return isFoundationStageActive(run)
}
