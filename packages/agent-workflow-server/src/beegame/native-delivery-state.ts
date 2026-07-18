import { getObservedNativeAcceptance } from './native-acceptance-evidence'
import { getObservedNativeDocumentReview } from './native-document-review-evidence'
import { auditDocumentReadiness } from './document-readiness-audit'

export type NativeDeliveryStateReason =
  | 'document_review_missing'
  | 'document_review_running'
  | 'document_review_stale'
  | 'document_review_needs_revision'
  | 'document_review_blocked'
  | 'acceptance_missing'
  | 'acceptance_running'
  | 'acceptance_stale'
  | 'acceptance_failed'
  | 'acceptance_blocked'
  | 'accepted'

export type NativeDeliveryState = {
  status: 'not_run' | 'passed' | 'failed' | 'blocked' | 'stale'
  reason: NativeDeliveryStateReason
  summary: string
  observedAt?: string
}

/**
 * Derives delivery state exclusively from passively observed native Claude
 * Code Reviewer and Validator results. It does not infer project semantics,
 * start agents, or advance a workflow.
 */
export function getNativeDeliveryState(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}): NativeDeliveryState {
  const review = getObservedNativeDocumentReview(input)
  if (review.state === 'missing') {
    return {
      status: 'not_run',
      reason: 'document_review_missing',
      summary:
        'Document review has not produced a valid native terminal result.',
    }
  }
  if (review.state === 'running') {
    return {
      status: 'not_run',
      reason: 'document_review_running',
      summary: 'The native Document Reviewer is still running.',
      observedAt: review.createdAt,
    }
  }
  if (review.state === 'stale') {
    return {
      status: 'stale',
      reason: 'document_review_stale',
      summary: 'Project documents changed after the latest native review.',
      observedAt: review.evidence.createdAt,
    }
  }
  if (review.evidence.verdict === 'NEEDS_REVISION') {
    return {
      status: 'failed',
      reason: 'document_review_needs_revision',
      summary: review.evidence.summary,
      observedAt: review.evidence.createdAt,
    }
  }
  if (review.evidence.verdict === 'BLOCKED') {
    return {
      status: 'blocked',
      reason: 'document_review_blocked',
      summary: review.evidence.summary,
      observedAt: review.evidence.createdAt,
    }
  }

  const readiness = auditDocumentReadiness(input.workspacePath)
  if (!readiness.valid) {
    return {
      status: 'failed',
      reason: 'document_review_needs_revision',
      summary: [
        'Document review cannot be READY because deterministic project-contract checks failed.',
        ...readiness.issues,
      ].join(' '),
      observedAt: review.evidence.createdAt,
    }
  }

  const acceptance = getObservedNativeAcceptance(input)
  if (acceptance.state === 'missing') {
    return {
      status: 'not_run',
      reason: 'acceptance_missing',
      summary: 'Acceptance has not produced a valid native Validator result.',
      observedAt: review.evidence.createdAt,
    }
  }
  if (acceptance.state === 'running') {
    return {
      status: 'not_run',
      reason: 'acceptance_running',
      summary: 'The native acceptance Validator is still running.',
      observedAt: acceptance.createdAt,
    }
  }
  if (acceptance.state === 'stale') {
    return {
      status: 'stale',
      reason: 'acceptance_stale',
      summary: acceptance.evidence.summary,
      observedAt: acceptance.evidence.createdAt,
    }
  }
  return {
    status: acceptance.evidence.status,
    reason:
      acceptance.evidence.status === 'passed'
        ? 'accepted'
        : acceptance.evidence.status === 'blocked'
          ? 'acceptance_blocked'
          : 'acceptance_failed',
    summary: acceptance.evidence.summary,
    observedAt: acceptance.evidence.createdAt,
  }
}
