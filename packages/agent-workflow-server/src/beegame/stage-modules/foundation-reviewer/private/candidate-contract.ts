import { z } from 'zod/v4'
import { prepareReviewerFirstCandidate, prepareReviewerRetryCandidate } from './candidate-handoff'
import { prepareReviewerTargetedAudit } from './targeted-preparation'
import { reviewerDigest } from './review-summary'
import { reviewerCandidateSubject, type ReviewerPreparedCandidate } from './targeted-preparation'
import { reviewerInputDigest } from './review-publication'
import { reviewerFullFormatPolicyDigest } from './recheck-contract'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const binding = z.object({ ownerId: id, projectId: id, resultId: digest, resultDigest: digest }).strict()
const publicValue = z.unknown().refine(value => value !== undefined, 'copied public result is required')
const source = { sourceResult: publicValue, sourceBinding: binding, candidateResult: publicValue, candidateBinding: binding }
export const reviewerCandidateInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first'), ...source }).strict(),
  z.object({ kind: z.literal('retry'), ...source, previousCandidateResult: publicValue, previousCandidateBinding: binding,
    previousRecheckResult: publicValue, previousRecheckBinding: binding }).strict(),
])
export const reviewerCandidateStartSchema = z.object({ protocolVersion: z.literal(1), requestId: id, ownerId: id, projectId: id,
  inputDigest: digest, input: reviewerCandidateInputSchema }).strict()
export type ReviewerCandidateInput = z.infer<typeof reviewerCandidateInputSchema>
export type ReviewerCandidateStart = z.infer<typeof reviewerCandidateStartSchema>

export function prepareReviewerCandidateInput(value: ReviewerCandidateInput) {
  const input = reviewerCandidateInputSchema.parse(structuredClone(value))
  return input.kind === 'retry' ? prepareReviewerRetryCandidate(input) : prepareReviewerFirstCandidate(input)
}

export function reviewerCandidateMode(candidate: ReviewerPreparedCandidate): 'targeted' | 'full_format' {
  if (candidate.operations.length > 0 && candidate.operations.every(operation => operation.scope === 'document') &&
    candidate.source.issues.every(entry => entry.issue.reasonCode === 'DOCUMENT_FORMAT_INVALID' && entry.issue.remediation.scope === 'document'))
    return 'full_format'
  // Mixed and localized format work has no frozen recheck authority.
  prepareReviewerTargetedAudit(candidate)
  return 'targeted'
}

/** Public input identity includes copied predecessor bindings, not only current document bytes. */
export function reviewerCandidateInputDigest(value: { ownerId: string; projectId: string; input: ReviewerCandidateInput }) {
  const input = reviewerCandidateInputSchema.parse(value.input)
  const candidate = prepareReviewerCandidateInput(input)
  if (candidate.source.ownerId !== value.ownerId || candidate.source.projectId !== value.projectId)
    throw new Error('candidate review owner or project mismatch')
  if (reviewerCandidateMode(candidate) === 'full_format') return reviewerDigest({ kind: 'full-format-candidate-review',
    ownerId: value.ownerId, projectId: value.projectId, input, policyDigest: reviewerFullFormatPolicyDigest(),
    reviewInputDigest: reviewerInputDigest({ ...value, subject: reviewerCandidateSubject(candidate), documents: candidate.documents }) })
  const prepared = prepareReviewerTargetedAudit(candidate)
  return reviewerDigest({ kind: 'candidate-review', ownerId: value.ownerId, projectId: value.projectId,
    targetedInputDigest: prepared.inputDigest, input })
}

export function parseReviewerFormatCandidateStart(value: unknown): ReviewerCandidateStart {
  const start = parseReviewerCandidateStart(value)
  if (reviewerCandidateMode(prepareReviewerCandidateInput(start.input)) !== 'full_format') throw new Error('full format candidate required')
  return start
}

export function parseReviewerCandidateStart(value: unknown): ReviewerCandidateStart {
  const start = reviewerCandidateStartSchema.parse(structuredClone(value))
  if (reviewerCandidateInputDigest(start) !== start.inputDigest) throw new Error('candidate review input digest mismatch')
  return start
}
