import { createReviewerInitialLifecycle, createReviewerFormatCandidateLifecycle, type ReviewerInfrastructure } from './initial-lifecycle'
import { reviewerCandidateMode, prepareReviewerCandidateInput, type ReviewerCandidateStart } from './candidate-contract'
import { createReviewerTargetedLifecycle } from './targeted-lifecycle'
import { createReviewerAllRegistrations, isReviewerCandidateStart, parseReviewerStart, type ReviewerStart } from './review-contract'
import { reviewerResumeSchema, reviewerStopSchema, type ReviewerHandle, type ReviewerResume, type ReviewerStop, type ReviewerResult } from './initial-contract'

export type ReviewerOperations = { start(input: ReviewerStart): Promise<ReviewerHandle>; resume(input: ReviewerResume): Promise<ReviewerResult>;
  stop(input: ReviewerStop): Promise<ReviewerResult>; getResult(handle: ReviewerHandle): Promise<ReviewerResult> }

/** The two execution modes belong to one Reviewer, with one public identity namespace. */
export function createReviewerLifecycle(workspacePath: string, infrastructure: ReviewerInfrastructure): ReviewerOperations {
  const initial = createReviewerInitialLifecycle(workspacePath, infrastructure)
  const targeted = createReviewerTargetedLifecycle(workspacePath, infrastructure)
  const fullFormat = createReviewerFormatCandidateLifecycle(workspacePath, infrastructure)
  const candidateLifecycle = (start: ReviewerCandidateStart) => reviewerCandidateMode(prepareReviewerCandidateInput(start.input)) === 'full_format' ? fullFormat : targeted
  const registrations = createReviewerAllRegistrations(workspacePath, infrastructure.billing.ownerId)
  async function forHandle(handle: ReviewerHandle) {
    const registration = await registrations.load(handle)
    return isReviewerCandidateStart(registration.start) ? candidateLifecycle(registration.start) : initial
  }
  return Object.freeze({
    async start(value: ReviewerStart) {
      const input = parseReviewerStart(value)
      return isReviewerCandidateStart(input) ? candidateLifecycle(input).start(input) : initial.start(input)
    },
    async getResult(handle: ReviewerHandle) { return (await forHandle(handle)).getResult(handle) },
    async resume(value: ReviewerResume) {
      const request = reviewerResumeSchema.parse(value)
      return (await forHandle(request.handle)).resume(request)
    },
    async stop(value: ReviewerStop) {
      const request = reviewerStopSchema.parse(value)
      return (await forHandle(request.handle)).stop(request)
    },
  })
}
