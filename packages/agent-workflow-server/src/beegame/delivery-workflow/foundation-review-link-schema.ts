import { z } from 'zod/v4'
import { foundationReviewerInputDigest, type ReviewerStartInput, type ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { foundationRevisionInputDigest, type RevisionStartInput } from '../stage-modules/foundation-revision/public'
import { foundationPublicJson, foundationResultBinding, type FoundationCandidateResult } from './foundation-public-handoff'
import type { FoundationReviewLinkState } from './foundation-review-link'
import type { AuthorDocumentsResult } from '../stage-modules/foundation-authoring/public'
import { FOUNDATION_ACCEPTANCE_POLICY_VERSION, assertFoundationAcceptanceDecision } from './foundation-acceptance-policy'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().min(1).max(200)
const request = z.object({ protocolVersion: z.literal(1), requestId: id, ownerId: id, projectId: id,
  inputDigest: digest, input: z.json() }).strict()
const reviewerRequest = request.extend({ tokenBudget: z.number().int().positive().safe().nullable().optional() }).refine(value => {
  try { return value.inputDigest === foundationReviewerInputDigest({ ownerId: value.ownerId, projectId: value.projectId,
    input: value.input as ReviewerStartInput['input'], ...(value.tokenBudget === undefined ? {} : { tokenBudget: value.tokenBudget }) }) } catch { return false }
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
const policyAuthorization = z.object({ authorizationId: id, action: z.enum(['grant_repair_budget', 'switch_policy']), actorId: id,
  reason: z.string().min(1).max(2000), recordedAt: z.string().datetime(), fromPolicyVersion: id.optional(), toPolicyVersion: id,
  previousAutomaticRepairLimit: z.number().int().nonnegative().safe().optional(), newAutomaticRepairLimit: z.number().int().nonnegative().safe().optional() }).strict()
const riskDecision = z.object({ decisionId: id, findingId: id, action: z.literal('accept_risk'), actorId: id,
  reason: z.string().min(1).max(2000), recordedAt: z.string().datetime(), reviewResultId: digest, reviewResultDigest: digest,
  documentSetDigest: digest, policyVersion: z.literal(FOUNDATION_ACCEPTANCE_POLICY_VERSION) }).strict()
const acceptanceDecision = z.object({ policyVersion: z.literal(FOUNDATION_ACCEPTANCE_POLICY_VERSION), reviewResultId: digest,
  reviewResultDigest: digest, documentSetDigest: digest,
  disposition: z.enum(['accepted', 'accepted_with_advisories', 'repair_required', 'needs_action']),
  advisoryFindingIds: z.array(id), blockingFindingIds: z.array(id), waivedFindingIds: z.array(id),
  automaticRepairLimit: z.number().int().nonnegative().safe(), completedRepairCount: z.number().int().nonnegative().safe(),
  reason: z.string().min(1).max(2000), overrideReferences: z.array(riskDecision) }).strict()
function handle(producer: 'foundation-reviewer' | 'foundation-revision') {
  return z.object({ protocolVersion: z.literal(1), producer: z.literal(producer), id: z.uuid() }).strict()
}
function outcome(producer: 'foundation-reviewer' | 'foundation-revision') {
  const base = { handle: handle(producer), billingStatus: z.enum(['pending', 'settled']),
    progress: z.object({ modelResponses: z.number().int().nonnegative(), message: z.string().max(2000) }).strict().optional(),
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
  reviewTokenBudget: z.number().int().positive().safe().nullable().optional(),
  stopAfterReview: z.boolean().optional(),
  reviewOnlyComplete: z.literal(true).optional(),
  importedAuthorResult: authorResult.optional(),
  control: z.object({ sequence: z.number().int().nonnegative(), appliedSequence: z.number().int().nonnegative(),
    action: z.enum(['run', 'stop']), reason: z.string().min(1).max(2000).optional() }).strict(),
  invocation: z.union([
    z.object({ stage: z.literal('reviewer'), request: reviewerRequest, handle: handle('foundation-reviewer').optional(),
      outcome: outcome('foundation-reviewer').optional() }).strict(),
    z.object({ stage: z.literal('revision'), request: revisionRequest, handle: handle('foundation-revision').optional(),
      outcome: outcome('foundation-revision').optional() }).strict(),
  ]),
  sourceReview: reviewResult.optional(), repairSourceReview: reviewResult.optional(), latestReview: reviewResult.optional(), candidate: candidateResult.optional(),
  policyVersion: id.optional(), automaticRepairLimit: z.number().int().nonnegative().safe().optional(),
  completedRepairCount: z.number().int().nonnegative().safe().optional(), riskDecisions: z.array(riskDecision).optional(),
  invocationStartedAt: z.string().datetime().optional(), invocationCompletedAt: z.string().datetime().optional(),
  invocationLastObservedAt: z.string().datetime().optional(), invocationTimingRunning: z.boolean().optional(),
  currentCallElapsedMs: z.number().nonnegative().safe().optional(), historicalElapsedMs: z.number().nonnegative().safe().optional(),
  allowNoDocumentChangeOnce: z.boolean().optional(),
  policyAuthorizations: z.array(policyAuthorization).optional(), acceptanceDecision: acceptanceDecision.optional(),
  acceptedReview: reviewResult.optional(), observationError: z.boolean().optional(),
  convergenceStop: z.enum(['repair_budget_exhausted', 'no_document_change_blocked']).optional(),
}).strict().superRefine((link, context) => {
  const invocation = link.invocation
  if (link.stopAfterReview && (invocation.stage !== 'reviewer' || link.sequence !== 0 ||
      (invocation.request.input as unknown as ReviewerStartInput['input']).subject?.kind !== 'initial' ||
      link.sourceReview || link.latestReview || link.candidate || link.acceptedReview))
    context.addIssue({ code: 'custom', message: 'Reviewer-only policy cannot contain a successor or an accepted handoff' })
  if (link.reviewOnlyComplete && (!link.stopAfterReview || invocation.stage !== 'reviewer' ||
      invocation.outcome?.status !== 'completed' || invocation.outcome.billingStatus !== 'settled'))
    context.addIssue({ code: 'custom', message: 'Reviewer-only completion requires a settled review under the stop policy' })
  if (invocation.stage === 'reviewer' && invocation.request.tokenBudget !== link.reviewTokenBudget)
    context.addIssue({ code: 'custom', message: 'Reviewer budget does not match workflow policy' })
  const result = invocation.outcome?.status === 'completed' ? invocation.outcome.result as unknown as ReviewerReviewResult | FoundationCandidateResult : undefined
  if (link.reviewOnlyComplete && result?.producer === 'foundation-reviewer' &&
      (result.inputDigest !== invocation.request.inputDigest ||
        foundationPublicJson(result.subject) !== foundationPublicJson((invocation.request.input as unknown as ReviewerStartInput['input']).subject)))
    context.addIssue({ code: 'custom', message: 'Reviewer-only completion must bind the reviewed input and subject' })
  if (result && (result.ownerId !== invocation.request.ownerId || result.projectId !== invocation.request.projectId ||
      result.requestId !== invocation.request.requestId))
    context.addIssue({ code: 'custom', message: 'Foundation result identity does not match invocation' })
  if (invocation.stage === 'revision' && invocation.outcome && invocation.outcome.inputDigest !== invocation.request.inputDigest)
    context.addIssue({ code: 'custom', message: 'Revision outcome input does not match invocation' })
  for (const envelope of [link.sourceReview, link.repairSourceReview, link.latestReview, link.candidate, link.acceptedReview]) {
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
      (link.invocation.outcome.result as unknown as ReviewerReviewResult).resultId !== (link.acceptedReview as unknown as ReviewerReviewResult).resultId))
    context.addIssue({ code: 'custom', message: 'Checklist stop requires an accepted settled Reviewer pass' })
  if (link.policyVersion === FOUNDATION_ACCEPTANCE_POLICY_VERSION) {
    if (link.automaticRepairLimit === undefined || link.completedRepairCount === undefined)
      context.addIssue({ code: 'custom', message: 'Convergence policy requires a persisted repair budget' })
    if ((link.acceptedReview || link.convergenceStop) && !link.acceptanceDecision)
      context.addIssue({ code: 'custom', message: 'Convergence review completion requires a versioned acceptanceDecision' })
    const decisionReview = link.acceptedReview ?? link.latestReview ?? link.sourceReview
    if (link.acceptanceDecision && (!decisionReview || link.acceptanceDecision.reviewResultId !== (decisionReview as unknown as ReviewerReviewResult).resultId ||
        link.acceptanceDecision.documentSetDigest !== (decisionReview as unknown as ReviewerReviewResult).documentSetDigest ||
        link.acceptanceDecision.automaticRepairLimit !== link.automaticRepairLimit ||
        link.acceptanceDecision.completedRepairCount !== link.completedRepairCount))
      context.addIssue({ code: 'custom', message: 'Acceptance decision is not bound to the completed review' })
    if (link.acceptedReview && link.acceptanceDecision && !['accepted', 'accepted_with_advisories'].includes(link.acceptanceDecision.disposition))
      context.addIssue({ code: 'custom', message: 'Accepted review requires an accepting acceptanceDecision disposition' })
    if (link.acceptanceDecision && decisionReview) {
      try { const boundDecisionReview = decisionReview as unknown as ReviewerReviewResult
        const binding = foundationResultBinding({ ownerId: boundDecisionReview.ownerId, projectId: boundDecisionReview.projectId }, boundDecisionReview)
        const activeRiskDecisions = (link.riskDecisions ?? []).filter(decision => decision.reviewResultId === boundDecisionReview.resultId &&
          decision.reviewResultDigest === binding.resultDigest && decision.documentSetDigest === boundDecisionReview.documentSetDigest)
        assertFoundationAcceptanceDecision({ ownerId: boundDecisionReview.ownerId, projectId: boundDecisionReview.projectId,
        review: boundDecisionReview, decision: link.acceptanceDecision,
        riskDecisions: activeRiskDecisions, noDocumentChange: link.convergenceStop === 'no_document_change_blocked' }) }
      catch (error) { context.addIssue({ code: 'custom', message: String(error) }) }
    }
  } else if (link.policyVersion !== undefined || link.acceptanceDecision || link.riskDecisions || link.policyAuthorizations)
    context.addIssue({ code: 'custom', message: 'Legacy Foundation links cannot carry convergence policy state' })
}) as unknown as z.ZodType<FoundationReviewLinkState>
}
