import { z } from 'zod/v4'
import { reviewerInitialStartSchema, parseReviewerInitialStart } from './initial-contract'
import { reviewerCandidateStartSchema, parseReviewerCandidateStart, type ReviewerCandidateStart } from './candidate-contract'
import { createReviewerRegistrationStore } from './review-registration'

export const reviewerStartSchema = z.union([reviewerInitialStartSchema, reviewerCandidateStartSchema])
export type ReviewerStart = z.infer<typeof reviewerStartSchema>
export function isReviewerCandidateStart(value: ReviewerStart): value is ReviewerCandidateStart {
  return 'kind' in value.input
}
export function parseReviewerStart(value: unknown): ReviewerStart {
  const start = reviewerStartSchema.parse(value)
  return isReviewerCandidateStart(start) ? parseReviewerCandidateStart(start) : parseReviewerInitialStart(start)
}
export function createReviewerAllRegistrations(workspacePath: string, ownerId: string) {
  return createReviewerRegistrationStore(workspacePath, ownerId, parseReviewerStart)
}
