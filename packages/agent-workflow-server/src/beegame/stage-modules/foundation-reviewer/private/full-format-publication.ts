import { buildReviewerPublishedResult } from './review-publication'
import { reviewerCandidateSubject, type ReviewerPreparedCandidate } from './targeted-preparation'
import { reviewerCandidateMode } from './candidate-contract'
import { reviewerFullFormatEvidenceSchema, reviewerFullFormatPolicyDigest } from './recheck-contract'
import { reviewerDigest } from './review-summary'
import { parseReviewerSourceResult } from './review-handoff'
import type { ReviewerJournalState } from './review-state'

/** Whole-document format repair starts a fresh full review, not an impact recheck. */
export function buildReviewerFullFormatResult(input: { requestId: string; candidate: ReviewerPreparedCandidate; state: ReviewerJournalState }) {
  const captured = structuredClone(input)
  const { candidate } = captured
  if (reviewerCandidateMode(candidate) !== 'full_format') throw new Error('full format publication requires document format authority')
  const initial = buildReviewerPublishedResult({ identity: { ownerId: candidate.source.ownerId,
    projectId: candidate.source.projectId, requestId: captured.requestId }, subject: reviewerCandidateSubject(candidate),
    documents: candidate.documents, state: captured.state })
  const { resultId: discarded, ...review } = initial
  const recheck = reviewerFullFormatEvidenceSchema.parse({ kind: 'full_format', round: candidate.candidate.round,
    candidateResultDigest: reviewerDigest(candidate.candidate), policyDigest: reviewerFullFormatPolicyDigest(), nextRound: 1 })
  const body = { ...review, recheck }
  const result = { ...body, resultId: reviewerDigest(body) }
  return parseReviewerSourceResult(result, { ownerId: result.ownerId, projectId: result.projectId,
    resultId: result.resultId, resultDigest: reviewerDigest(result) })
}
