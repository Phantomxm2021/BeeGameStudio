import { parseReviewerInitialStart, type ReviewerInitialStart } from './initial-contract'
import { createReviewerRegistrationStore, type ReviewerRequestRegistration } from './review-registration'

export type ReviewerRegistration = ReviewerRequestRegistration<ReviewerInitialStart>
export function createReviewerRegistrations(workspacePath: string, ownerId: string) {
  return createReviewerRegistrationStore(workspacePath, ownerId, parseReviewerInitialStart)
}
