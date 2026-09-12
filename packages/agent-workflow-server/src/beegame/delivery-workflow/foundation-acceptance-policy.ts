import { foundationPublicDigest, foundationResultBinding, type FoundationHandoffIdentity } from './foundation-public-handoff'
import type { ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'

/** Version frozen when a new public foundation review chain is initialized. */
export const FOUNDATION_ACCEPTANCE_POLICY_VERSION = 'foundation-acceptance.v1' as const
export const DEFAULT_AUTOMATIC_REPAIR_LIMIT = 2

export type FoundationAcceptanceDisposition =
  | 'accepted'
  | 'accepted_with_advisories'
  | 'repair_required'
  | 'needs_action'

export type FoundationRiskDecision = {
  decisionId: string
  findingId: string
  action: 'accept_risk'
  actorId: string
  reason: string
  recordedAt: string
  reviewResultId: string
  reviewResultDigest: string
  documentSetDigest: string
  policyVersion: typeof FOUNDATION_ACCEPTANCE_POLICY_VERSION
}

export type FoundationAcceptanceDecision = {
  policyVersion: typeof FOUNDATION_ACCEPTANCE_POLICY_VERSION
  reviewResultId: string
  reviewResultDigest: string
  documentSetDigest: string
  disposition: FoundationAcceptanceDisposition
  advisoryFindingIds: string[]
  blockingFindingIds: string[]
  waivedFindingIds: string[]
  automaticRepairLimit: number
  completedRepairCount: number
  reason: string
  overrideReferences: FoundationRiskDecision[]
}

export type FoundationPolicyAuthorization = {
  authorizationId: string
  action: 'grant_repair_budget' | 'switch_policy'
  actorId: string
  reason: string
  recordedAt: string
  fromPolicyVersion?: string
  toPolicyVersion: string
  previousAutomaticRepairLimit?: number
  newAutomaticRepairLimit?: number
}

type PolicyInput = FoundationHandoffIdentity & {
  review: ReviewerReviewResult
  policyVersion?: string
  automaticRepairLimit: number
  completedRepairCount: number
  noDocumentChange?: boolean
  riskDecisions?: readonly FoundationRiskDecision[]
}

function issueEntries(review: ReviewerReviewResult) {
  const raw = (review as unknown as { issues?: unknown }).issues
  if (!Array.isArray(raw)) throw new Error('Foundation review finding registry is missing')
  if (review.kind === 'passed' && raw.length !== 0) throw new Error('Passed Foundation review cannot contain findings')
  if (review.kind !== 'passed' && review.kind !== 'issues_found') throw new Error('Foundation review kind is invalid')
  if (review.kind === 'issues_found' && (raw.length < 1 || raw.length > 200)) throw new Error('Foundation issue result has invalid finding count')
  return raw.map(entry => {
    if (!entry || typeof entry !== 'object' || !('issue' in entry)) throw new Error('Foundation finding entry is invalid')
    const issue = (entry as { issue?: unknown }).issue
    if (!issue || typeof issue !== 'object') throw new Error('Foundation finding is invalid')
    const value = issue as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id.trim() || typeof value.severity !== 'string' ||
        !['LOW', 'MEDIUM', 'HIGH'].includes(value.severity))
      throw new Error('Foundation finding severity or ID is invalid')
    return issue as { id: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' }
  })
}

/**
 * Deterministic workflow policy. It classifies a completed, settled Reviewer
 * result; it does not inspect prose, invoke another agent, or alter the
 * original report. Every accepted risk must be explicitly bound to the exact
 * report and document set that produced it.
 */
export function evaluateFoundationAcceptance(input: PolicyInput): FoundationAcceptanceDecision {
  if (input.policyVersion !== FOUNDATION_ACCEPTANCE_POLICY_VERSION)
    throw new Error('Foundation acceptance policy version is not supported by this evaluator')
  if (!Number.isSafeInteger(input.automaticRepairLimit) || input.automaticRepairLimit < 0 ||
      !Number.isSafeInteger(input.completedRepairCount) || input.completedRepairCount < 0)
    throw new Error('Foundation acceptance repair budget is invalid')
  const binding = foundationResultBinding({ ownerId: input.ownerId, projectId: input.projectId }, input.review)
  const entries = issueEntries(input.review)
  const ids = entries.map(issue => issue.id)
  if (new Set(ids).size !== ids.length) throw new Error('Foundation review contains duplicate finding IDs')
  const byId = new Map(entries.map(issue => [issue.id, issue]))
  const waivers = [...(input.riskDecisions ?? [])]
  if (new Set(waivers.map(waiver => waiver.decisionId)).size !== waivers.length)
    throw new Error('Foundation risk decision IDs must be unique')
  const waived = new Set<string>()
  for (const waiver of waivers) {
    if (waiver.policyVersion !== FOUNDATION_ACCEPTANCE_POLICY_VERSION || waiver.action !== 'accept_risk' ||
        !waiver.decisionId.trim() || !waiver.actorId.trim() || !waiver.reason.trim() ||
        Number.isNaN(Date.parse(waiver.recordedAt)) ||
        waiver.reviewResultId !== input.review.resultId || waiver.reviewResultDigest !== binding.resultDigest ||
        waiver.documentSetDigest !== input.review.documentSetDigest || !byId.has(waiver.findingId) ||
        waived.has(waiver.findingId))
      throw new Error('Foundation risk decision is not bound to this review')
    waived.add(waiver.findingId)
  }
  const advisoryFindingIds = entries.filter(issue => issue.severity === 'LOW' && !waived.has(issue.id)).map(issue => issue.id)
  const blockingFindingIds = entries.filter(issue => issue.severity !== 'LOW' && !waived.has(issue.id)).map(issue => issue.id)
  const waivedFindingIds = entries.filter(issue => waived.has(issue.id)).map(issue => issue.id)
  const hasFindings = entries.length > 0
  const disposition: FoundationAcceptanceDisposition = blockingFindingIds.length === 0
    ? (hasFindings ? 'accepted_with_advisories' : 'accepted')
    : input.noDocumentChange || input.completedRepairCount >= input.automaticRepairLimit ? 'needs_action' : 'repair_required'
  const reason = disposition === 'accepted'
    ? 'Reviewer completed with no findings.'
    : disposition === 'accepted_with_advisories'
      ? `${advisoryFindingIds.length} advisory finding(s) and ${waivedFindingIds.length} explicitly accepted finding(s) retained; no automatic repair required.`
      : disposition === 'repair_required'
        ? `${blockingFindingIds.length} unwaived blocking finding(s) require revision.`
        : input.noDocumentChange
          ? `No document change was observed and ${blockingFindingIds.length} blocking finding(s) remain.`
          : `Automatic repair budget exhausted with ${blockingFindingIds.length} blocking finding(s) remaining.`
  return {
    policyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION,
    reviewResultId: input.review.resultId,
    reviewResultDigest: binding.resultDigest,
    documentSetDigest: input.review.documentSetDigest,
    disposition,
    advisoryFindingIds,
    blockingFindingIds,
    waivedFindingIds,
    automaticRepairLimit: input.automaticRepairLimit,
    completedRepairCount: input.completedRepairCount,
    reason,
    overrideReferences: structuredClone(waivers),
  }
}

export function createFoundationRiskDecision(input: FoundationHandoffIdentity & {
  review: ReviewerReviewResult
  findingId: string
  actorId: string
  reason: string
  decisionId: string
  recordedAt: string
}): FoundationRiskDecision {
  if (!input.actorId.trim() || !input.reason.trim() || !input.decisionId.trim())
    throw new Error('Foundation risk decision requires an actor, reason and decision ID')
  const binding = foundationResultBinding({ ownerId: input.ownerId, projectId: input.projectId }, input.review)
  const entries = issueEntries(input.review)
  if (!entries.some(issue => issue.id === input.findingId)) throw new Error('Foundation risk decision references an unknown finding')
  return { decisionId: input.decisionId, findingId: input.findingId, action: 'accept_risk', actorId: input.actorId,
    reason: input.reason, recordedAt: input.recordedAt, reviewResultId: input.review.resultId,
    reviewResultDigest: binding.resultDigest, documentSetDigest: input.review.documentSetDigest,
    policyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION }
}

/** Re-check a durable decision before publication or snapshot admission. */
export function assertFoundationAcceptanceDecision(input: FoundationHandoffIdentity & {
  review: ReviewerReviewResult
  decision: FoundationAcceptanceDecision
  riskDecisions: readonly FoundationRiskDecision[]
  noDocumentChange?: boolean
}): FoundationAcceptanceDecision {
  const recomputed = evaluateFoundationAcceptance({ ...input, policyVersion: input.decision.policyVersion,
    automaticRepairLimit: input.decision.automaticRepairLimit,
    completedRepairCount: input.decision.completedRepairCount,
    noDocumentChange: input.noDocumentChange,
    riskDecisions: input.riskDecisions })
  if (foundationPublicDigest(recomputed) !== foundationPublicDigest(input.decision))
    throw new Error('Foundation acceptance decision does not match the bound review or policy')
  return recomputed
}
