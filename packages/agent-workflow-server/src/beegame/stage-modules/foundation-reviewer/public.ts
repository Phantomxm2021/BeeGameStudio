import { isAbsolute } from 'node:path'
import { z } from 'zod/v4'
import { createSingleReviewerLifecycle, type SingleReviewerOperations } from './private/single-agent-lifecycle'
import { singleReviewInputDigest, type SingleReviewStart } from './private/single-agent-publication'
import type { RuntimeConfigurationClient } from '../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../billing/public'
// Diagnostic-only extension. Does not grant stage execution or mutate admission/billing evidence.
export { createEvidenceWriter as createReviewerEvidenceWriter, evidenceSecrets as reviewerEvidenceSecrets,
  redactEvidence as redactReviewerEvidence, type EvidenceIds as ReviewerEvidenceIds,
  type RequestIds as ReviewerEvidenceRequestIds } from './private/single-agent-evidence'

export type { SingleReviewStart as ReviewerStartInput, SingleReviewHandle as ReviewerHandle,
  SingleReviewResume as ReviewerResumeInput, SingleReviewStop as ReviewerStopInput,
  SingleReviewResult as ReviewerResult, SingleReviewPublishedResult as ReviewerReviewResult } from './private/single-agent-publication'
export type ReviewerConfiguration = Readonly<{ workspacePath: string }>
export type ReviewerInfrastructure = Readonly<{ runtimeConfiguration: RuntimeConfigurationClient; billing: UsageBillingClient }>

/** Only copied public input is accepted; no worker, journal, or admission callback escapes. */
export function foundationReviewerInputDigest(value: Pick<SingleReviewStart, 'ownerId' | 'projectId' | 'input' | 'tokenBudget'>): string {
  return singleReviewInputDigest(structuredClone(value))
}

/** Sole production entry point for the isolated single-agent full audit. */
export function createFoundationReviewer(config: ReviewerConfiguration, infrastructure: ReviewerInfrastructure): SingleReviewerOperations {
  const parsed = z.object({ workspacePath: z.string().min(1) }).strict().parse(config)
  if (!isAbsolute(parsed.workspacePath)) throw new Error('Reviewer workspace must be absolute')
  const operations = createSingleReviewerLifecycle(parsed.workspacePath, infrastructure)
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
