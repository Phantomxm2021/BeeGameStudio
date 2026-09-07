import { isAbsolute } from 'node:path'
import { z } from 'zod/v4'
import { createReviewerLifecycle, type ReviewerOperations } from './private/review-lifecycle'
import { reviewerInputDigest } from './private/review-publication'
import { reviewerCandidateInputDigest } from './private/candidate-contract'
import type { ReviewerStart } from './private/review-contract'
import type { RuntimeConfigurationClient } from '../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../billing/public'

export type { ReviewerStart as ReviewerStartInput } from './private/review-contract'
export type { ReviewerHandle, ReviewerResume as ReviewerResumeInput, ReviewerStop as ReviewerStopInput, ReviewerResult } from './private/initial-contract'
export type { ReviewerPublishedResult as ReviewerReviewResult } from './private/review-publication'
export type ReviewerConfiguration = Readonly<{ workspacePath: string }>
export type ReviewerInfrastructure = Readonly<{ runtimeConfiguration: RuntimeConfigurationClient; billing: UsageBillingClient }>

/** Only copied public input is accepted; no worker, journal, or admission callback escapes. */
export function foundationReviewerInputDigest(value: Pick<ReviewerStart, 'ownerId' | 'projectId' | 'input'>): string {
  const captured = structuredClone(value)
  const identity = z.object({ ownerId: z.string().min(1).max(200), projectId: z.string().min(1).max(200) }).strict().parse({ ownerId: captured.ownerId, projectId: captured.projectId })
  return 'kind' in captured.input ? reviewerCandidateInputDigest({ ...identity, input: captured.input })
    : reviewerInputDigest({ ...identity, ...captured.input })
}

/** Production entry point; application cutover remains a separate plan milestone. */
export function createFoundationReviewer(config: ReviewerConfiguration, infrastructure: ReviewerInfrastructure): ReviewerOperations {
  const parsed = z.object({ workspacePath: z.string().min(1) }).strict().parse(config)
  if (!isAbsolute(parsed.workspacePath)) throw new Error('Reviewer workspace must be absolute')
  const operations = createReviewerLifecycle(parsed.workspacePath, infrastructure)
  async function invoke<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch { throw new Error('Reviewer operation could not be accepted or safely completed') }
  }
  return Object.freeze({
    start: input => invoke(() => operations.start(input)),
    resume: input => invoke(() => operations.resume(input)),
    stop: input => invoke(() => operations.stop(input)),
    getResult: handle => invoke(() => operations.getResult(handle)),
  })
}
