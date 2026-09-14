import { z } from 'zod/v4'
import type { AuthorDocumentsResult } from '../stage-modules/foundation-authoring/public'
import { foundationReviewerInputDigest, type ReviewerStartInput, type ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { foundationResultBinding } from './foundation-public-handoff'
import type { FoundationReviewLinkState } from './foundation-review-link'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(200)
const progress = z.object({ modelResponses: z.number().int().nonnegative(), message: z.string().max(2000) }).strict().optional()
const request = z.object({ protocolVersion: z.literal(1), requestId: id, ownerId: id, projectId: id,
  inputDigest: digest, input: z.json() }).strict()
const reviewerRequest = request.refine(value => {
  try { return value.inputDigest === foundationReviewerInputDigest({ ownerId: value.ownerId, projectId: value.projectId,
    input: value.input as ReviewerStartInput['input'] }) } catch { return false }
}, 'Reviewer public request digest mismatch')
const reviewResult = z.json().refine(value => {
  try {
    const result = value as unknown as ReviewerReviewResult
    if (result.protocolVersion !== 6 || result.producer !== 'foundation-reviewer' ||
        !result.ownerId || !result.projectId || !result.requestId) return false
    foundationResultBinding({ ownerId: result.ownerId, projectId: result.projectId }, result)
    return true
  } catch { return false }
}, 'Foundation review result binding mismatch')
const handle = z.object({ protocolVersion: z.literal(1), producer: z.literal('foundation-reviewer'), id: z.uuid() }).strict()
const outcome = z.union([
  z.object({ handle, billingStatus: z.enum(['pending', 'settled']), progress,
    status: z.enum(['running', 'stopped']) }).strict(),
  z.object({ handle, billingStatus: z.enum(['pending', 'settled']), progress,
    status: z.literal('needs_action'), reason: z.string().min(1), resumable: z.boolean() }).strict(),
  z.object({ handle, billingStatus: z.enum(['pending', 'settled']), progress,
    status: z.literal('failed'), reason: z.string().min(1), code: id }).strict(),
  z.object({ handle, billingStatus: z.enum(['pending', 'settled']), progress,
    status: z.literal('completed'), result: reviewResult }).strict(),
])

/** Persist only the single review-and-correct workflow. */
export function createFoundationReviewLinkSchema(authorResult: z.ZodType<AuthorDocumentsResult>) {
  return z.object({
    protocolVersion: z.literal(1), authorResultId: digest,
    importedAuthorResult: authorResult.optional(),
    control: z.object({ sequence: z.number().int().nonnegative(), appliedSequence: z.number().int().nonnegative(),
      action: z.enum(['run', 'stop']), reason: z.string().min(1).max(2000).optional() }).strict(),
    invocation: z.object({ stage: z.literal('reviewer'), request: reviewerRequest, handle: handle.optional(),
      outcome: outcome.optional() }).strict(),
    acceptedReview: reviewResult.optional(),
    invocationStartedAt: z.string().datetime().optional(), invocationCompletedAt: z.string().datetime().optional(),
    invocationLastObservedAt: z.string().datetime().optional(), invocationTimingRunning: z.boolean().optional(),
    currentCallElapsedMs: z.number().nonnegative().safe().optional(), historicalElapsedMs: z.number().nonnegative().safe().optional(),
    observationError: z.boolean().optional(),
  }).strict().superRefine((link, context) => {
    const invocation = link.invocation
    const result = invocation.outcome?.status === 'completed'
      ? invocation.outcome.result as unknown as ReviewerReviewResult : undefined
    if (result && (result.ownerId !== invocation.request.ownerId || result.projectId !== invocation.request.projectId ||
        result.requestId !== invocation.request.requestId))
      context.addIssue({ code: 'custom', message: 'Foundation result identity does not match invocation' })
    for (const envelope of [link.acceptedReview]) {
      if (!envelope) continue
      const bound = envelope as unknown as ReviewerReviewResult
      if (bound.ownerId !== invocation.request.ownerId || bound.projectId !== invocation.request.projectId)
        context.addIssue({ code: 'custom', message: 'Foundation predecessor belongs to another identity' })
    }
    if (link.control.appliedSequence > link.control.sequence)
      context.addIssue({ code: 'custom', message: 'Foundation control acknowledgment exceeds requested sequence' })
    if (invocation.outcome && (!invocation.handle || invocation.outcome.handle.id !== invocation.handle.id))
      context.addIssue({ code: 'custom', message: 'Foundation outcome handle does not match invocation' })
    if (link.acceptedReview && (invocation.outcome?.status !== 'completed' || invocation.outcome.billingStatus !== 'settled' ||
        (invocation.outcome.result as unknown as ReviewerReviewResult).resultId !==
        (link.acceptedReview as unknown as ReviewerReviewResult).resultId))
      context.addIssue({ code: 'custom', message: 'Checklist stop requires an accepted settled review pass' })
  }) as unknown as z.ZodType<FoundationReviewLinkState>
}
