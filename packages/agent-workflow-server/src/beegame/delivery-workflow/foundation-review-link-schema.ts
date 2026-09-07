import { z } from 'zod/v4'
import { foundationReviewerInputDigest, type ReviewerStartInput, type ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { foundationRevisionInputDigest, type RevisionStartInput } from '../stage-modules/foundation-revision/public'
import { foundationResultBinding, type FoundationCandidateResult } from './foundation-public-handoff'
import type { FoundationReviewLinkState } from './foundation-review-link'
import type { AuthorDocumentsResult } from '../stage-modules/foundation-authoring/public'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(200)
const request = z.object({ protocolVersion: z.literal(1), requestId: id, ownerId: id, projectId: id,
  inputDigest: digest, input: z.json() }).strict()
const reviewerRequest = request.refine(value => {
  try { return value.inputDigest === foundationReviewerInputDigest({ ownerId: value.ownerId, projectId: value.projectId,
    input: value.input as ReviewerStartInput['input'] }) } catch { return false }
}, 'Reviewer public request digest mismatch')
const revisionRequest = request.refine(value => {
  try { return value.inputDigest === foundationRevisionInputDigest({ ownerId: value.ownerId, projectId: value.projectId,
    input: value.input as RevisionStartInput['input'] }) } catch { return false }
}, 'Revision public request digest mismatch')
function resultSchema(producer: 'foundation-reviewer' | 'foundation-revision') {
  return z.json().refine(value => {
    try {
      const result = value as unknown as ReviewerReviewResult | FoundationCandidateResult
      if (result.producer !== producer || !result.ownerId || !result.projectId || !result.requestId) return false
      if (producer === 'foundation-reviewer' ? !['passed', 'issues_found'].includes(result.kind) : result.kind !== 'candidate_ready') return false
      foundationResultBinding({ ownerId: result.ownerId, projectId: result.projectId }, result)
      return true
    } catch { return false }
  }, 'Foundation public result binding mismatch')
}
const reviewResult = resultSchema('foundation-reviewer')
const candidateResult = resultSchema('foundation-revision')
function handle(producer: 'foundation-reviewer' | 'foundation-revision') {
  return z.object({ protocolVersion: z.literal(1), producer: z.literal(producer), id: z.uuid() }).strict()
}
function outcome(producer: 'foundation-reviewer' | 'foundation-revision') {
  const base = { handle: handle(producer), billingStatus: z.enum(['pending', 'settled']),
    ...(producer === 'foundation-revision' ? { inputDigest: digest } : {}) }
  return z.union([
    z.object({ ...base, status: z.enum(['running', 'stopped']) }).strict(),
    z.object({ ...base, status: z.literal('needs_action'), reason: z.string().min(1), resumable: z.boolean() }).strict(),
    z.object({ ...base, status: z.literal('failed'), reason: z.string().min(1), code: id }).strict(),
    z.object({ ...base, status: z.literal('completed'), result: producer === 'foundation-reviewer' ? reviewResult : candidateResult }).strict(),
  ])
}
// Persistence of public envelopes only. Stage admission remains in its public
// API; the workflow does not reproduce issue/repair/private-state validation.
export function createFoundationReviewLinkSchema(authorResult: z.ZodType<AuthorDocumentsResult>) {
return z.object({
  protocolVersion: z.literal(1), authorResultId: digest, sequence: z.number().int().nonnegative(),
  importedAuthorResult: authorResult.optional(),
  control: z.object({ sequence: z.number().int().nonnegative(), appliedSequence: z.number().int().nonnegative(),
    action: z.enum(['run', 'stop']), reason: z.string().min(1).max(2000).optional() }).strict(),
  invocation: z.union([
    z.object({ stage: z.literal('reviewer'), request: reviewerRequest, handle: handle('foundation-reviewer').optional(),
      outcome: outcome('foundation-reviewer').optional() }).strict(),
    z.object({ stage: z.literal('revision'), request: revisionRequest, handle: handle('foundation-revision').optional(),
      outcome: outcome('foundation-revision').optional() }).strict(),
  ]),
  sourceReview: reviewResult.optional(), candidate: candidateResult.optional(),
  previous: z.object({ candidate: candidateResult, recheck: reviewResult }).strict().optional(),
  acceptedReview: reviewResult.optional(), observationError: z.boolean().optional(),
}).strict().superRefine((link, context) => {
  const invocation = link.invocation
  const result = invocation.outcome?.status === 'completed' ? invocation.outcome.result as unknown as ReviewerReviewResult | FoundationCandidateResult : undefined
  if (result && (result.ownerId !== invocation.request.ownerId || result.projectId !== invocation.request.projectId ||
      result.requestId !== invocation.request.requestId))
    context.addIssue({ code: 'custom', message: 'Foundation result identity does not match invocation' })
  if (invocation.stage === 'revision' && invocation.outcome && invocation.outcome.inputDigest !== invocation.request.inputDigest)
    context.addIssue({ code: 'custom', message: 'Revision outcome input does not match invocation' })
  for (const envelope of [link.sourceReview, link.candidate, link.previous?.candidate, link.previous?.recheck, link.acceptedReview]) {
    if (!envelope) continue
    const bound = envelope as unknown as ReviewerReviewResult | FoundationCandidateResult
    if (bound.ownerId !== invocation.request.ownerId || bound.projectId !== invocation.request.projectId)
      context.addIssue({ code: 'custom', message: 'Foundation predecessor belongs to another identity' })
  }
  if (link.control.appliedSequence > link.control.sequence)
    context.addIssue({ code: 'custom', message: 'Foundation control acknowledgment exceeds requested sequence' })
  if (link.invocation.outcome && (!link.invocation.handle || link.invocation.outcome.handle.id !== link.invocation.handle.id))
    context.addIssue({ code: 'custom', message: 'Foundation outcome handle does not match invocation' })
  if (link.acceptedReview && (link.invocation.stage !== 'reviewer' || link.invocation.outcome?.status !== 'completed' ||
      link.invocation.outcome.billingStatus !== 'settled' ||
      (link.acceptedReview as unknown as ReviewerReviewResult).kind !== 'passed' ||
      (link.invocation.outcome.result as unknown as ReviewerReviewResult).resultId !== (link.acceptedReview as unknown as ReviewerReviewResult).resultId))
    context.addIssue({ code: 'custom', message: 'Checklist stop requires an accepted settled Reviewer pass' })
}) as unknown as z.ZodType<FoundationReviewLinkState>
}
