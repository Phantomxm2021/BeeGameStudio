import { z } from 'zod/v4'
import { reviewerDigest } from './review-summary'
import type { ReviewerJournalState } from './review-state'
import type { WorkflowUsage } from './domain/types'

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const reviewerBillingUsageSchema = z.object({ prompt_tokens: count, completion_tokens: count, cache_read_tokens: count,
  cache_creation_tokens: count, total_tokens: count }).strict().refine(value => value.total_tokens >= value.prompt_tokens + value.completion_tokens)
const record = z.object({ eventId: z.string().min(1), duplicate: z.boolean(), weightedTokensDelta: z.number().finite(), creditsMicro: z.number().finite() }).strict()
const common = { protocolVersion: z.literal(1), ownerId: z.string().min(1), eventId: z.string().min(1), idempotencyKey: z.string().min(1),
  pricingVersion: z.literal('weighted-v1'), usageSource: z.literal('runtime_snapshot'), usage: reviewerBillingUsageSchema }
export const reviewerBillingReceiptSchema = z.union([
  z.object({ ...common, skipped: z.literal(true), duplicate: z.literal(false) }).strict(),
  z.object({ ...common, duplicate: z.boolean(), recorded: record, debited: record }).strict(),
])
export const reviewerUsageEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seal_usage') }).strict(),
  z.object({ kind: z.literal('billing_ack'), dispatchId: z.string().min(1).max(200), receipt: reviewerBillingReceiptSchema }).strict(),
])
export type ReviewerUsageLedger = { ownerId: string; runId: string; entries: {
  dispatchId: string; usage: z.infer<typeof reviewerBillingUsageSchema>; kind: 'document-facts' | 'semantic' | 'confirmation'; modelTier: 'fast' | 'balanced' | 'strong';
  receipt?: z.infer<typeof reviewerBillingReceiptSchema>
}[] }
export function reviewerBillingUsage(value: WorkflowUsage) {
  return reviewerBillingUsageSchema.parse({ prompt_tokens: value.input_tokens, completion_tokens: value.completion_tokens,
    cache_read_tokens: value.cache_read_tokens, cache_creation_tokens: value.cache_creation_tokens, total_tokens: value.total_tokens })
}
export function reviewerUsageEventId(runId: string, dispatchId: string, usage: z.infer<typeof reviewerBillingUsageSchema>) {
  return `usage-terminal:foundation-reviewer:${runId}:${dispatchId}:${reviewerDigest(usage)}`
}
export function applyReviewerUsageEvent(prior: ReviewerJournalState, input: z.infer<typeof reviewerUsageEventSchema>, binding: { runId: string; ownerId?: string }): ReviewerJournalState {
  const event = reviewerUsageEventSchema.parse(input)
  if (!binding.ownerId) throw new Error('review usage journal owner is missing')
  const state = structuredClone(prior)
  const ledger: ReviewerUsageLedger = state.billing ?? { ownerId: binding.ownerId, runId: binding.runId, entries: [] }
  if (ledger.ownerId !== binding.ownerId || ledger.runId !== binding.runId) throw new Error('review usage ledger identity mismatch')
  state.billing = ledger
  if (event.kind === 'seal_usage') {
    const tasks = [...state.collection.tasks, ...(state.semantic?.collection.tasks ?? [])]
    if (tasks.some(task => task.status === 'running')) throw new Error('cannot seal usage before native cleanup')
    for (const task of tasks) for (const dispatch of [...(task.attemptHistory ?? []), ...(task.dispatch ? [task.dispatch] : [])]) {
      const observed = task.kind === 'document-facts' ? state.usageByDispatch : state.semantic!.usageByDispatch
      if (!Object.hasOwn(observed, dispatch.dispatchId)) throw new Error('review dispatch has no measured usage to seal')
      const usage = reviewerBillingUsage(observed[dispatch.dispatchId]!)
      const priorEntry = ledger.entries.find(entry => entry.dispatchId === dispatch.dispatchId)
      if (priorEntry) {
        if (reviewerDigest(priorEntry.usage) !== reviewerDigest(usage)) throw new Error('sealed review usage changed')
      } else ledger.entries.push({ dispatchId: dispatch.dispatchId, kind: task.kind, modelTier: task.modelTier, usage })
    }
  } else {
    const entry = ledger.entries.find(item => item.dispatchId === event.dispatchId)
    if (!entry) throw new Error('review billing acknowledgement has no sealed usage')
    const expectedId = reviewerUsageEventId(binding.runId, entry.dispatchId, entry.usage)
    const receipt = event.receipt
    if (receipt.ownerId !== binding.ownerId || receipt.eventId !== expectedId || receipt.idempotencyKey !== expectedId || reviewerDigest(receipt.usage) !== reviewerDigest(entry.usage))
      throw new Error('review billing acknowledgement binding mismatch')
    if ('skipped' in receipt && entry.usage.total_tokens !== 0) throw new Error('nonzero review usage cannot be skipped')
    if (entry.receipt && reviewerDigest(entry.receipt) !== reviewerDigest(receipt)) throw new Error('review billing acknowledgement changed')
    entry.receipt = structuredClone(receipt)
  }
  return state
}
