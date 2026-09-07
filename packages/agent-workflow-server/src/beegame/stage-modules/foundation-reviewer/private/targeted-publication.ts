import type { FoundationFactReceipt } from './domain/foundation-fact-extraction'
import type { ReviewerPreparedCandidate } from './targeted-preparation'
import { reviewerCandidateSubject, prepareReviewerTargetedAudit } from './targeted-preparation'
import { summarizeReviewerTargeted } from './targeted-summary'
import { reviewerInputDigest, publishReviewerDerivedResult, type ReviewerPublishedResult } from './review-publication'
import { reviewerDigest, reviewerPolicyDigest } from './review-summary'
import { reviewerTargetedPolicyDigest, reviewerTargetedEvidenceSchema, type ReviewerTargetedPublicEvidence } from './recheck-contract'
import { parseReviewerSourceResult } from './review-handoff'
import { z } from 'zod/v4'
import type { ReviewerTargetedState } from './targeted-state'

/** In-memory final public value; durable publication will require owner journal receipts. */
export function buildReviewerTargetedResult(input: { requestId: string; candidate: ReviewerPreparedCandidate; facts: readonly FoundationFactReceipt[];
  semantic: Parameters<typeof summarizeReviewerTargeted>[2] }): ReviewerPublishedResult & { recheck: ReviewerTargetedPublicEvidence } {
  const requestId = z.string().min(1).max(200).parse(input.requestId)
  const candidate = structuredClone(input.candidate)
  const summary = summarizeReviewerTargeted(candidate, input.facts, input.semantic)
  const subject = reviewerCandidateSubject(candidate)
  const recheck = reviewerTargetedEvidenceSchema.parse({ kind: 'targeted', round: summary.round, candidateResultDigest: summary.candidateResultDigest,
    policyDigest: reviewerTargetedPolicyDigest(), decision: summary.decision,
    issueVerdicts: summary.issueVerdicts, documentVerdicts: summary.documentVerdicts })
  const body = { protocolVersion: 1 as const, producer: 'foundation-reviewer' as const, requestId,
    ownerId: candidate.source.ownerId, projectId: candidate.source.projectId,
    inputDigest: reviewerInputDigest({ ownerId: candidate.source.ownerId, projectId: candidate.source.projectId, subject, documents: candidate.documents }),
    subject, kind: summary.kind, documentSetDigest: candidate.candidate.documentSetDigest, documents: structuredClone(candidate.candidate.documents),
    policyDigest: reviewerPolicyDigest(), issueRegistryDigest: summary.issueRegistryDigest, evidenceDigest: summary.evidenceDigest,
    issues: summary.issues, recheck }
  const result = { ...body, resultId: reviewerDigest(body) }
  const parsed = parseReviewerSourceResult(result, { ownerId: result.ownerId, projectId: result.projectId, resultId: result.resultId, resultDigest: reviewerDigest(result) })
  if (parsed.recheck?.kind !== 'targeted') throw new Error('targeted publication evidence missing')
  return { ...parsed, recheck: parsed.recheck }
}

/** Only the owner uses this with a state replayed from its immutable journal. */
export function buildReviewerTargetedResultFromState(input: { requestId: string; candidate: ReviewerPreparedCandidate; state: ReviewerTargetedState }) {
  const captured = structuredClone(input)
  const { state, candidate } = captured
  if (state.inputDigest !== prepareReviewerTargetedAudit(candidate).inputDigest ||
    state.candidateId !== candidate.candidate.candidateId || state.candidateResultId !== candidate.candidate.resultId)
    throw new Error('targeted publication state binding mismatch')
  if (!['deterministic_failed', 'targeted_staged'].includes(state.phase) || !state.deterministic ||
    state.factTasks.some(task => task.status !== 'completed') || state.semanticTasks.some(task => task.status !== 'completed'))
    throw new Error('targeted publication requires completed owner evidence')
  for (const task of [...state.factTasks, ...state.semanticTasks]) {
    if (!task.receiptPath?.startsWith('.beegame/workflow/foundation-reviewer/state/') ||
      !/^[a-f0-9]{64}$/.test(task.receiptDigest ?? '') || !task.terminalDigest || task.dispatch?.status !== 'completed')
      throw new Error('targeted publication is missing owned acceptance receipts')
  }
  const facts = state.factTasks.flatMap(task => task.factReceipts ?? [])
  if (reviewerDigest(facts) !== reviewerDigest(state.factReceipts)) throw new Error('targeted publication fact receipts changed')
  const semantic = state.semanticTasks.map(task => {
    if (!task.issueId || task.semanticOutput === undefined) throw new Error('targeted publication semantic receipt is incomplete')
    return { issueId: task.issueId, output: task.semanticOutput }
  })
  const summary = summarizeReviewerTargeted(candidate, facts, semantic)
  if (reviewerDigest(summary) !== reviewerDigest(state.summary ?? null) ||
    (state.phase === 'deterministic_failed') !== state.deterministic.failed)
    throw new Error('targeted publication summary disagrees with owner replay')
  return buildReviewerTargetedResult({ requestId: captured.requestId, candidate, facts, semantic })
}

export async function publishReviewerTargetedResult(input: { workspacePath: string } & Parameters<typeof buildReviewerTargetedResultFromState>[0]) {
  const result = buildReviewerTargetedResultFromState(input)
  return publishReviewerDerivedResult(input.workspacePath, result)
}
