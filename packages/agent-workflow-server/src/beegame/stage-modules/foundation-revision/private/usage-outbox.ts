import type { UsageBillingClient } from '../../../../billing/public'
import { openRevisionAttemptStore } from './attempt-store'
import { prepareRevisionRequest } from './request-preparation'

/** Delivers only immutable terminal facts through the existing billing owner.
 * Concurrent/replayed deliveries use the same authority idempotency key; a
 * transport failure or lost local ack is retried, never treated as a new fact.
 * This component neither prices usage nor adopts/closes an active process.
 */
export async function flushRevisionUsage(
  workspacePath: string,
  requestValue: unknown,
  billing: UsageBillingClient,
) {
  const prepared = prepareRevisionRequest(requestValue)
  const { request } = prepared
  if (
    billing.protocolVersion !== 1 ||
    billing.ownerId !== request.ownerId ||
    typeof billing.submitUsage !== 'function'
  )
    throw new Error('Revision billing owner mismatch')
  const store = await openRevisionAttemptStore(workspacePath, request)
  const initial = await store.readUsageOutbox()
  for (const entry of initial.entries) {
    if (entry.receipt) continue
    let receipt
    try {
      receipt = await billing.submitUsage({
        ownerId: request.ownerId,
        projectId: request.projectId,
        sessionId: entry.attemptId,
        turnId: entry.attemptId,
        eventId: entry.eventId,
        usage: { ...entry.usage },
        metadata: {
          producer: 'foundation-revision',
          requestId: request.requestId,
          attemptId: entry.attemptId,
          documentPath: entry.documentPath,
          receiptDigest: entry.receiptDigest,
        },
      })
    } catch {
      continue
    }
    // Do not swallow a malformed receipt or an uncertain durable ack. The
    // caller may retry this same sealed fact but cannot infer successful ack.
    await store.acknowledgeUsage({ attemptId: entry.attemptId, receipt })
  }
  const current = await store.readUsageOutbox()
  const pending = current.entries.filter(entry => !entry.receipt).length
  return {
    settled: current.activeAttemptIds.length === 0 && pending === 0,
    pending,
    acknowledged: current.entries.length - pending,
    active: current.activeAttemptIds.length,
  }
}
