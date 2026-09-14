import { z } from 'zod'
import type { UsageBillingClient, UsageBillingInput } from '../../../../billing/public'
import { authorDigest } from './contract'
import type { createAuthorPersistence } from './persistence'
import type { AuthorUsage } from './contract'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const usageSchema = z.strictObject({ prompt_tokens: count, completion_tokens: count,
  cache_read_tokens: count, cache_creation_tokens: count, total_tokens: count })
const entrySchema = z.strictObject({ dispatchId: z.string().uuid(), usage: usageSchema,
  sealed: z.boolean(), submitted: z.boolean() })
const journalSchema = z.strictObject({ ownerId: z.string(), projectId: z.string(), runId: z.string().uuid(),
  entries: z.record(z.string(), entrySchema) })
type Journal = z.infer<typeof journalSchema>
type Binding = Pick<Journal, 'ownerId' | 'projectId' | 'runId'>

/** Private durable facts/outbox, not a price calculator or billing authority. */
export function createAuthorUsageJournal(store: ReturnType<typeof createAuthorPersistence>, binding: Binding,
  billing?: UsageBillingClient) {
  const identity = { ...binding }
  if (billing && (billing.protocolVersion !== 1 || billing.ownerId !== identity.ownerId))
    throw new Error('Author billing owner mismatch')
  const key = authorDigest(['author-usage-journal', identity.runId])
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation); tail = next.catch(() => undefined); return next
  }
  async function load(): Promise<Journal> {
    const raw = await store.load<unknown>(key)
    if (!raw) return { ...identity, entries: {} }
    const journal = journalSchema.parse(raw)
    if (journal.ownerId !== identity.ownerId || journal.projectId !== identity.projectId || journal.runId !== identity.runId)
      throw new Error('Author usage journal identity mismatch')
    for (const [id, entry] of Object.entries(journal.entries)) {
      if (id !== entry.dispatchId || (entry.submitted && !entry.sealed)) throw new Error('Invalid author usage entry')
    }
    return journal
  }
  return {
    async status(): Promise<{ pending: number }> {
      const journal = await load()
      return { pending: Object.values(journal.entries).filter(entry => !entry.submitted).length }
    },
    observe(dispatchId: string, value: AuthorUsage | undefined, sealed = false): Promise<void> {
      const usage = value === undefined ? undefined : usageSchema.parse(value)
      z.string().uuid().parse(dispatchId)
      return serialize(async () => {
        const journal = await load()
        const previous = journal.entries[dispatchId]
        if (!usage && !previous) return
        const nextUsage = usage ?? previous!.usage
        if (previous?.sealed) {
          if (authorDigest(previous.usage) !== authorDigest(nextUsage)) throw new Error('Sealed author usage changed')
          return
        }
        if (previous && !sealed && authorDigest(previous.usage) === authorDigest(nextUsage)) return
        journal.entries[dispatchId] = { dispatchId, usage: nextUsage, sealed, submitted: false }
        await store.save(key, journal)
      })
    },
    /** The caller holds the run lease; no prior native process can still add facts. */
    sealInterrupted(): Promise<void> {
      return serialize(async () => {
        const journal = await load()
        let changed = false
        for (const entry of Object.values(journal.entries)) if (!entry.sealed) { entry.sealed = true; changed = true }
        if (changed) await store.save(key, journal)
      })
    },
    flush(): Promise<{ pending: number }> {
      return serialize(async () => {
        const journal = await load()
        for (const entry of Object.values(journal.entries)) {
          if (!entry.sealed || entry.submitted || !billing) continue
          const input: UsageBillingInput = { ownerId: identity.ownerId, projectId: identity.projectId,
            // The authority accepts cumulative snapshots per native job/session.
            // Separate document jobs must never share one cumulative session.
            sessionId: entry.dispatchId, turnId: entry.dispatchId,
            eventId: `usage-terminal:foundation-authoring:${identity.runId}:${entry.dispatchId}:${authorDigest(entry.usage)}`,
            usage: { ...entry.usage }, metadata: { producer: 'foundation-authoring', runId: identity.runId, dispatchId: entry.dispatchId } }
          try { await billing.submitUsage(input) } catch { continue }
          // A failed local receipt write deliberately leaves the same authority key replayable.
          entry.submitted = true
          await store.save(key, journal)
        }
        return { pending: Object.values(journal.entries).filter(entry => entry.sealed && !entry.submitted).length }
      })
    },
  }
}
