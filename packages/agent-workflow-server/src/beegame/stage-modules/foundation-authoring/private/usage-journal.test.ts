import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UsageBillingClient, UsageBillingInput } from '../../../../billing/public'
import { createAuthorPersistence } from './persistence'
import { createAuthorUsageJournal } from './usage-journal'

const usage = { prompt_tokens: 10, completion_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 12 }
async function setup() {
  const rootPath = await realpath(await mkdtemp(join(tmpdir(), 'author-usage-')))
  const store = createAuthorPersistence({ rootPath })
  const binding = { ownerId: 'owner', projectId: 'project', runId: randomUUID() }
  const calls: UsageBillingInput[] = []
  let fail = false
  const billing: UsageBillingClient = { protocolVersion: 1, ownerId: 'owner', async submitUsage(input) {
    calls.push(structuredClone(input))
    if (fail) throw new Error('SECRET backend error')
    return { protocolVersion: 1, ownerId: 'owner', eventId: input.eventId, idempotencyKey: input.eventId,
      pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot', usage: input.usage, duplicate: false, skipped: true }
  } }
  return { store, binding, calls, billing, set fail(value: boolean) { fail = value } }
}

test('usage is durable before terminal but submitted once only after sealing', async () => {
  const fixture = await setup()
  const journal = createAuthorUsageJournal(fixture.store, fixture.binding, fixture.billing)
  const id = randomUUID()
  await journal.observe(id, usage)
  await journal.flush()
  expect(fixture.calls).toHaveLength(0)
  expect(await journal.status()).toEqual({ pending: 1 })
  await journal.observe(id, usage, true)
  await journal.flush(); await journal.flush()
  expect(fixture.calls).toHaveLength(1)
  expect(fixture.calls[0]).toMatchObject({ ownerId: 'owner', projectId: 'project', sessionId: id, turnId: id, usage })
  expect(await journal.status()).toEqual({ pending: 0 })
  await expect(journal.observe(id, { ...usage, total_tokens: 13 }, true)).rejects.toThrow('Sealed')
})

test('billing failure survives restart and replays the exact event, never its error payload', async () => {
  const fixture = await setup(); fixture.fail = true
  const journal = createAuthorUsageJournal(fixture.store, fixture.binding, fixture.billing)
  await journal.observe(randomUUID(), usage, true)
  expect(await journal.flush()).toEqual({ pending: 1 })
  fixture.fail = false
  const recovered = createAuthorUsageJournal(fixture.store, fixture.binding, fixture.billing)
  expect(await recovered.flush()).toEqual({ pending: 0 })
  expect(fixture.calls[0]).toEqual(fixture.calls[1])
  expect(JSON.stringify(fixture.calls)).not.toContain('SECRET')
})

test('a crashed observed turn seals its last durable usage without executing a new model', async () => {
  const fixture = await setup()
  await createAuthorUsageJournal(fixture.store, fixture.binding, fixture.billing).observe(randomUUID(), usage)
  const recovered = createAuthorUsageJournal(fixture.store, fixture.binding, fixture.billing)
  await recovered.sealInterrupted(); await recovered.flush()
  expect(fixture.calls).toHaveLength(1)
  expect(fixture.calls[0]!.usage).toEqual(usage)
})

test('owner mismatch is rejected before submitting facts', async () => {
  const fixture = await setup()
  expect(() => createAuthorUsageJournal(fixture.store, { ...fixture.binding, ownerId: 'foreign' }, fixture.billing)).toThrow('owner mismatch')
  expect(fixture.calls).toHaveLength(0)
})

test('independent document jobs have independent cumulative billing session identities', async () => {
  const fixture = await setup()
  const journal = createAuthorUsageJournal(fixture.store, fixture.binding, fixture.billing)
  const first = randomUUID(); const second = randomUUID()
  await journal.observe(first, usage, true); await journal.observe(second, usage, true)
  await journal.flush()
  expect(fixture.calls).toHaveLength(2)
  expect(fixture.calls[0]!.sessionId).not.toBe(fixture.calls[1]!.sessionId)
  expect(fixture.calls.map(input => input.metadata!.runId)).toEqual([fixture.binding.runId, fixture.binding.runId])
})
