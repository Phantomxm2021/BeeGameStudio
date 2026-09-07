import { z } from 'zod/v4'
import { applyReviewerFactEvent, factEventSchema, type ReviewerFactState } from './fact-state'
import { applyReviewerSemanticEvent, initialReviewerSemanticState, semanticEventSchema, type ReviewerSemanticState } from './semantic-state'
import { prepareReviewerSemanticInput } from './semantic-input'
import type { ReviewDocumentInput } from './prepare-review'
import { reviewerUsageEventSchema, applyReviewerUsageEvent, reviewerBillingUsage, type ReviewerUsageLedger } from './usage-state'
import { reviewerDigest } from './review-summary'

export const reviewerEventSchema = z.union([factEventSchema, reviewerUsageEventSchema,
  z.object({ kind: z.literal('lifecycle_stop'), reason: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal('lifecycle_resume') }).strict(),
  z.object({ kind: z.literal('lifecycle_failure'), code: z.enum(['execution_failed', 'publication_failed', 'billing_failed']) }).strict(),
  z.object({ kind: z.literal('begin_semantic') }).strict(),
  z.object({ kind: z.literal('semantic_stop') }).strict(),
  z.object({ kind: z.literal('semantic'), command: semanticEventSchema }).strict(),
])
export type ReviewerJournalEvent = z.infer<typeof reviewerEventSchema>
export type ReviewerJournalState = ReviewerFactState & { semantic?: ReviewerSemanticState; billing?: ReviewerUsageLedger;
  control?: { stopped: boolean; reason?: string; failure?: 'execution_failed' | 'publication_failed' | 'billing_failed' } }

/** One immutable log/lease for both phases; no cross-phase evidence handoff file. */
export function applyReviewerJournalEvent(prior: ReviewerJournalState, documents: readonly ReviewDocumentInput[],
  input: ReviewerJournalEvent, at: string, evidence: { path: string; digest: string; runId: string; ownerId?: string }): ReviewerJournalState {
  const event = reviewerEventSchema.parse(input)
  if (event.kind === 'seal_usage' || event.kind === 'billing_ack') return applyReviewerUsageEvent(prior, event, evidence)
  if (event.kind === 'lifecycle_failure') return { ...prior, control: { ...prior.control, stopped: prior.control?.stopped ?? false, failure: event.code } }
  if (event.kind === 'lifecycle_stop' || event.kind === 'lifecycle_resume') {
    const state = structuredClone(prior)
    state.control = event.kind === 'lifecycle_stop' ? { stopped: true, reason: event.reason } : { stopped: false }
    const command = { kind: event.kind === 'lifecycle_stop' ? 'stop' as const : 'resume' as const }
    if (state.semantic) {
      if (command.kind === 'stop' || state.semantic.phase === 'stopped' || state.semantic.phase === 'needs_action')
        state.semantic = applyReviewerSemanticEvent(state.semantic, prepareReviewerSemanticInput(documents, state).packets, command, at, evidence)
    } else if (command.kind === 'stop' || state.phase === 'stopped' || state.phase === 'needs_action') return { ...applyReviewerFactEvent(state, documents, command, at, evidence), control: state.control }
    return state
  }
  if (prior.control?.stopped && (event.kind === 'begin_semantic' || event.kind === 'resume' || (event.kind === 'semantic' && event.command.kind === 'resume')))
    throw new Error('review lifecycle is stopped; explicit lifecycle resume is required')
  const metered = event.kind === 'semantic' ? event.command : event
  if (metered.kind === 'usage' || metered.kind === 'accept' || metered.kind === 'fail') {
    const sealed = prior.billing?.entries.find(entry => entry.dispatchId === metered.dispatchId)
    if (sealed && reviewerDigest(sealed.usage) !== reviewerDigest(reviewerBillingUsage(metered.usage))) throw new Error('sealed review usage cannot change')
  }
  if (event.kind === 'semantic_stop') {
    // The phase-specific stop must also win before its first run/claim. Do not
    // silently turn a staged-facts no-op stop into a later semantic execution.
    const packets = prepareReviewerSemanticInput(documents, prior).packets
    const semantic = prior.semantic ?? initialReviewerSemanticState(packets, at)
    return { ...prior, semantic: applyReviewerSemanticEvent(semantic, packets, { kind: 'stop' }, at, evidence) }
  }
  if (event.kind === 'begin_semantic') {
    if (prior.semantic) throw new Error('semantic review is already initialized')
    const prepared = prepareReviewerSemanticInput(documents, prior)
    return { ...prior, semantic: initialReviewerSemanticState(prepared.packets, at) }
  }
  if (event.kind === 'semantic' || (prior.semantic && (event.kind === 'stop' || event.kind === 'resume'))) {
    if (!prior.semantic) throw new Error('semantic review has not been initialized')
    const command = event.kind === 'semantic' ? event.command : { kind: event.kind as 'stop' | 'resume' }
    if (command.kind === 'claim' && prior.collection.tasks.some(task => task.dispatch?.dispatchId === command.dispatchId || task.attemptHistory?.some(item => item.dispatchId === command.dispatchId)))
      throw new Error('review dispatch identity is already used by facts')
    return { ...prior, semantic: applyReviewerSemanticEvent(prior.semantic, prepareReviewerSemanticInput(documents, prior).packets, command, at, evidence) }
  }
  if (prior.semantic && event.kind !== 'usage') throw new Error('fact phase is already closed')
  return { ...applyReviewerFactEvent(prior, documents, event, at, evidence), ...(prior.semantic ? { semantic: prior.semantic } : {}) }
}
