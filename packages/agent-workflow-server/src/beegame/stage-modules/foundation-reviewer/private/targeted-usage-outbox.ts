import { randomUUID } from 'node:crypto'
import type { UsageBillingClient } from '../../../../billing/public'
import {
  openReviewerTargetedJournal,
  ReviewJournalConflictError,
  type ReviewerTargetedExecutionLease,
} from './targeted-journal'
import { reviewerUsageEventId } from './usage-state'

/** Flushes only targeted dispatches already measured and durably sealed by the journal. */
export async function flushReviewerTargetedUsage(
  input: Parameters<typeof openReviewerTargetedJournal>[0],
  billing: UsageBillingClient,
  inheritedLease?: ReviewerTargetedExecutionLease,
) {
  if (billing.protocolVersion !== 1 || billing.ownerId !== input.identity.ownerId || typeof billing.submitUsage !== 'function')
    throw new Error('targeted billing owner mismatch')
  const bound = structuredClone(input)
  const journal = await openReviewerTargetedJournal(bound)
  if (inheritedLease && (inheritedLease.runId !== journal.runId || inheritedLease.scope !== journal.leaseScope))
    throw new Error('targeted execution lease run mismatch')
  const lease = inheritedLease ?? await journal.tryExecutionLease()
  if (lease.kind !== 'owned') return { execution: lease.kind, settled: false }
  const { assertOwned, release } = lease
  try {
    await assertOwned()
    const initial = await journal.read()
    const tasks = [...initial.factTasks, ...initial.semanticTasks]
    if (tasks.some(task => task.status === 'running' || [...(task.attemptHistory ?? []), ...(task.dispatch ? [task.dispatch] : [])].some(dispatch =>
      !Object.hasOwn(initial.usageByDispatch, dispatch.dispatchId))))
      return { execution: 'owned' as const, settled: false }

    async function append(event: Parameters<typeof journal.append>[1]) {
      const commandId = randomUUID()
      for (let retry = 0; ; retry++) {
        try {
          await assertOwned()
          return await journal.append(commandId, event)
        } catch (error) {
          if (!(error instanceof ReviewJournalConflictError) || retry >= 8) throw error
        }
      }
    }

    const sealed = await append({ kind: 'seal_usage' })
    for (const entry of sealed.billing?.entries ?? []) {
      if (entry.receipt) continue
      await assertOwned()
      const eventId = reviewerUsageEventId(journal.runId, entry.dispatchId, entry.usage)
      let receipt
      try {
        receipt = await billing.submitUsage({ ownerId: bound.identity.ownerId, projectId: bound.identity.projectId,
          sessionId: entry.dispatchId, turnId: entry.dispatchId, eventId, usage: { ...entry.usage },
          metadata: { producer: 'foundation-reviewer-targeted', runId: journal.runId, dispatchId: entry.dispatchId, kind: entry.kind, modelTier: entry.modelTier } })
      } catch { continue }
      await append({ kind: 'billing_ack', dispatchId: entry.dispatchId, receipt })
    }
    return { execution: 'owned' as const, settled: (await journal.read()).billing?.entries.every(entry => Boolean(entry.receipt)) ?? true }
  } finally { if (!inheritedLease) await release() }
}
