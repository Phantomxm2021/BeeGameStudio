import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushReviewerUsage } from '../usage-outbox'
import { openReviewerFactJournal } from '../fact-journal'
import { reviewFixtureDocuments, fixtureUsage } from '../test-fixtures/review-fixture'
import { prepareFoundationReview } from '../prepare-review'

type BillingInput = Parameters<Parameters<typeof flushReviewerUsage>[1]['submitUsage']>[0]
const identity = { ownerId: 'billing-owner', projectId: 'project', requestId: 'request' }
const zero = { input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }
function receipt(input: BillingInput, duplicate = false) {
  const common = { protocolVersion: 1 as const, ownerId: input.ownerId, eventId: input.eventId, idempotencyKey: input.eventId,
    pricingVersion: 'weighted-v1' as const, usageSource: 'runtime_snapshot' as const, usage: { ...input.usage } }
  if (input.usage.total_tokens === 0) return { ...common, skipped: true as const, duplicate: false as const }
  return { ...common, duplicate, recorded: { eventId: 'recorded', duplicate, weightedTokensDelta: 1, creditsMicro: 1 },
    debited: { eventId: 'debited', duplicate, weightedTokensDelta: 1, creditsMicro: 1 } }
}
async function fixture(run: (input: Parameters<typeof openReviewerFactJournal>[0], journal: Awaited<ReturnType<typeof openReviewerFactJournal>>) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-outbox-')))
  try {
    const input = { workspacePath, identity, documents: reviewFixtureDocuments() }
    await run(input, await openReviewerFactJournal(input))
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
}
async function accepted(input: Parameters<typeof openReviewerFactJournal>[0], journal: Awaited<ReturnType<typeof openReviewerFactJournal>>, dispatchId = 'd1') {
  const prepared = prepareFoundationReview(input.documents)
  if (prepared.kind !== 'facts_pending') throw new Error('invalid fixture')
  await journal.append(`claim-${dispatchId}`, { kind: 'claim', taskId: 'fact-0', dispatchId })
  await journal.append(`accept-${dispatchId}`, { kind: 'accept', taskId: 'fact-0', dispatchId, usage: fixtureUsage,
    output: { status: 'completed', results: prepared.factPackets[0]!.keys.map(key => ({ key, status: 'absent' })) } })
}

test('sealed usage flushes once, survives reopening, and reads never submit billing', async () => fixture(async (input, journal) => {
  await accepted(input, journal)
  const calls: BillingInput[] = []
  const billing = { protocolVersion: 1 as const, ownerId: identity.ownerId, async submitUsage(value: BillingInput) { calls.push(value); return receipt(value) } }
  expect((await flushReviewerUsage(input, billing)).settled).toBe(true)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.sessionId).toBe('d1')
  expect(calls[0]!.usage.total_tokens).toBe(10)
  const restored = await openReviewerFactJournal(input)
  expect((await restored.read()).billing!.entries[0]!.receipt).toBeDefined()
  expect((await flushReviewerUsage(input, billing)).settled).toBe(true)
  expect(calls).toHaveLength(1)
}))

test('an uncertain authority response leaves a stable replayable event ID without another charge', async () => fixture(async (input, journal) => {
  await accepted(input, journal)
  const authority = new Map<string, string>()
  const calls: string[] = []
  let fail = true
  const billing = { protocolVersion: 1 as const, ownerId: identity.ownerId, async submitUsage(value: BillingInput) {
    calls.push(value.eventId)
    const existing = authority.get(value.eventId)
    const payload = JSON.stringify(value)
    if (existing && existing !== payload) throw new Error('same authority key different payload')
    authority.set(value.eventId, payload)
    if (fail) throw new Error('receipt response lost after debit')
    return receipt(value, Boolean(existing))
  } }
  expect((await flushReviewerUsage(input, billing)).settled).toBe(false)
  expect((await journal.read()).billing!.entries[0]!.receipt).toBeUndefined()
  fail = false
  expect((await flushReviewerUsage(input, billing)).settled).toBe(true)
  expect(new Set(calls).size).toBe(1)
  expect(authority.size).toBe(1)
}))

test('stopped and retried work is billed per native dispatch without losing prior acknowledged facts', async () => fixture(async (input, journal) => {
  await journal.append('claim', { kind: 'claim', taskId: 'fact-0', dispatchId: 'stopped' })
  await journal.append('usage', { kind: 'usage', taskId: 'fact-0', dispatchId: 'stopped', usage: fixtureUsage })
  await journal.append('stop', { kind: 'stop' })
  const calls: BillingInput[] = []
  const billing = { protocolVersion: 1 as const, ownerId: identity.ownerId, async submitUsage(value: BillingInput) { calls.push(value); return receipt(value) } }
  expect((await flushReviewerUsage(input, billing)).settled).toBe(true)
  await journal.append('resume', { kind: 'resume' })
  await accepted(input, journal, 'retried')
  expect((await flushReviewerUsage(input, billing)).settled).toBe(true)
  expect(calls.map(value => value.sessionId)).toEqual(['stopped', 'retried'])
  expect(calls.reduce((sum, value) => sum + value.usage.total_tokens, 0)).toBe(20)
  expect((await journal.read()).billing!.entries.every(entry => entry.receipt)).toBe(true)
}))

test('unobserved or running usage cannot be called settled or guessed as zero', async () => fixture(async (input, journal) => {
  const billing = { protocolVersion: 1 as const, ownerId: identity.ownerId, async submitUsage(_value: BillingInput) { throw new Error('must not call') } }
  await journal.append('claim', { kind: 'claim', taskId: 'fact-0', dispatchId: 'unknown' })
  expect((await flushReviewerUsage(input, billing)).settled).toBe(false)
  await journal.append('stop', { kind: 'stop' })
  expect((await flushReviewerUsage(input, billing)).settled).toBe(false)
  await expect(journal.append('seal', { kind: 'seal_usage' })).rejects.toThrow('no measured usage')
}))

test('known zero-token work uses the public skipped receipt and sealed counters cannot change', async () => fixture(async (input, journal) => {
  await journal.append('claim', { kind: 'claim', taskId: 'fact-0', dispatchId: 'zero' })
  await journal.append('usage', { kind: 'usage', taskId: 'fact-0', dispatchId: 'zero', usage: zero })
  await journal.append('stop', { kind: 'stop' })
  const billing = { protocolVersion: 1 as const, ownerId: identity.ownerId, async submitUsage(value: BillingInput) { return receipt(value) } }
  expect((await flushReviewerUsage(input, billing)).settled).toBe(true)
  await journal.append('same-usage', { kind: 'usage', taskId: 'fact-0', dispatchId: 'zero', usage: zero })
  await expect(journal.append('changed-usage', { kind: 'usage', taskId: 'fact-0', dispatchId: 'zero', usage: fixtureUsage })).rejects.toThrow('sealed review usage')
}))

test('foreign or mismatched billing receipts never settle nonzero usage', async () => fixture(async (input, journal) => {
  await accepted(input, journal)
  const client = { protocolVersion: 1 as const, ownerId: identity.ownerId, async submitUsage(value: BillingInput) { return { ...receipt(value), ownerId: 'foreign' } } }
  await expect(flushReviewerUsage(input, client)).rejects.toThrow('binding mismatch')
  expect((await journal.read()).billing!.entries[0]!.receipt).toBeUndefined()
  await expect(flushReviewerUsage(input, { ...client, ownerId: 'foreign' })).rejects.toThrow('owner mismatch')
}))

test('an active execution lease prevents sealing and billing', async () => fixture(async (input, journal) => {
  await accepted(input, journal)
  const lease = await journal.tryExecutionLease()
  if (lease.kind !== 'owned') throw new Error('lease unavailable')
  try {
    expect(await flushReviewerUsage(input, { protocolVersion: 1, ownerId: identity.ownerId, async submitUsage(_value: BillingInput) { throw new Error('must not execute') } }))
      .toEqual({ execution: 'busy', settled: false })
    expect((await journal.read()).billing).toBeUndefined()
  } finally { await lease.release() }
}))
