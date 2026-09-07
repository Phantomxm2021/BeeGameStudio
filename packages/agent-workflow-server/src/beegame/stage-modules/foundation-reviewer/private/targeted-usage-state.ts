import { z } from 'zod/v4'
import {
  reviewerBillingReceiptSchema,
  reviewerBillingUsage,
  reviewerBillingUsageSchema,
  reviewerUsageEventId,
  reviewerUsageEventSchema,
} from './usage-state'
import { reviewerDigest } from './review-summary'
import type { WorkflowUsage } from './domain/types'
import type { ReviewerTargetedState } from './targeted-state'

/** Targeted billing deliberately reuses the Reviewer billing wire contracts. */
export const targetedUsageEventSchema = reviewerUsageEventSchema
export type ReviewerTargetedUsageEvent = z.infer<typeof targetedUsageEventSchema>
export type TargetedUsageEntry = {
  dispatchId: string
  usage: z.infer<typeof reviewerBillingUsageSchema>
  kind: 'fact' | 'semantic'
  modelTier: 'fast' | 'strong'
  receipt?: z.infer<typeof reviewerBillingReceiptSchema>
}
export type TargetedUsageLedger = {
  ownerId: string
  runId: string
  sealed: boolean
  entries: TargetedUsageEntry[]
}

function sameUsage(left: WorkflowUsage | z.infer<typeof reviewerBillingUsageSchema>, right: WorkflowUsage | z.infer<typeof reviewerBillingUsageSchema>): boolean {
  const a = 'input_tokens' in left ? reviewerBillingUsage(left as WorkflowUsage) : left
  const b = 'input_tokens' in right ? reviewerBillingUsage(right as WorkflowUsage) : right
  return a.prompt_tokens === b.prompt_tokens && a.completion_tokens === b.completion_tokens &&
    a.cache_read_tokens === b.cache_read_tokens && a.cache_creation_tokens === b.cache_creation_tokens && a.total_tokens === b.total_tokens
}

/** Rejects a late runtime snapshot that would mutate a sealed billing fact. */
export function assertTargetedUsageCanChange(state: ReviewerTargetedState, dispatchId: string, usage: WorkflowUsage): void {
  if (!state.billing?.sealed) return
  const entry = state.billing.entries.find(item => item.dispatchId === dispatchId)
  // A later retry is a new dispatch and must be measurable after an earlier
  // seal. Only an already-sealed dispatch is immutable.
  if (entry && !sameUsage(entry.usage, usage)) throw new Error('targeted sealed usage cannot change')
}

export function applyReviewerTargetedUsageEvent(
  prior: ReviewerTargetedState,
  input: ReviewerTargetedUsageEvent,
  binding: { runId: string; ownerId?: string },
): ReviewerTargetedState {
  const event = targetedUsageEventSchema.parse(input)
  if (!binding.ownerId) throw new Error('targeted usage journal owner is missing')
  const state = structuredClone(prior)
  const ledger: TargetedUsageLedger = state.billing ?? { ownerId: binding.ownerId, runId: binding.runId, sealed: false, entries: [] }
  if (ledger.ownerId !== binding.ownerId || ledger.runId !== binding.runId) throw new Error('targeted usage ledger identity mismatch')
  state.billing = ledger

  const allTasks = [...state.factTasks, ...state.semanticTasks]
  if (event.kind === 'seal_usage') {
    if (allTasks.some(task => task.status === 'running')) throw new Error('cannot seal targeted usage before native cleanup')
    for (const task of allTasks) {
      for (const dispatch of [...(task.attemptHistory ?? []), ...(task.dispatch ? [task.dispatch] : [])]) {
        const observed = Object.hasOwn(state.usageByDispatch, dispatch.dispatchId) ? state.usageByDispatch[dispatch.dispatchId] : undefined
        if (!observed) throw new Error('targeted dispatch has no measured usage to seal')
        const usage = reviewerBillingUsage(observed)
        const existing = ledger.entries.find(entry => entry.dispatchId === dispatch.dispatchId)
        if (existing) {
          if (!sameUsage(existing.usage, usage)) throw new Error('targeted sealed usage changed')
        } else ledger.entries.push({ dispatchId: dispatch.dispatchId, usage, kind: task.kind, modelTier: task.kind === 'fact' ? 'fast' : 'strong' })
      }
    }
    ledger.sealed = true
  } else {
    if (!ledger.sealed) throw new Error('targeted billing acknowledgement requires sealed usage')
    const entry = ledger.entries.find(item => item.dispatchId === event.dispatchId)
    if (!entry) throw new Error('targeted billing acknowledgement has no sealed usage')
    const receipt = event.receipt
    const expectedId = reviewerUsageEventId(binding.runId, entry.dispatchId, entry.usage)
    if (receipt.ownerId !== binding.ownerId || receipt.eventId !== expectedId || receipt.idempotencyKey !== expectedId || !sameUsage(entry.usage, receipt.usage))
      throw new Error('targeted billing acknowledgement binding mismatch')
    if ('skipped' in receipt && entry.usage.total_tokens !== 0) throw new Error('nonzero targeted usage cannot be skipped')
    if (entry.receipt && reviewerDigest(entry.receipt) !== reviewerDigest(receipt)) throw new Error('targeted billing acknowledgement changed')
    entry.receipt = structuredClone(receipt)
  }
  return state
}
