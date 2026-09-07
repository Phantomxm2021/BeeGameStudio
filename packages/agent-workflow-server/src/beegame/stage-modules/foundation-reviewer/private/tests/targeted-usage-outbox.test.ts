import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { openReviewerTargetedJournal } from '../targeted-journal'
import { flushReviewerTargetedUsage } from '../targeted-usage-outbox'

type UsageBillingClient = Parameters<typeof flushReviewerTargetedUsage>[1]
type BillingInput = Parameters<UsageBillingClient['submitUsage']>[0]
const identity = { ownerId: 'owner', projectId: 'project', requestId: 'repair' }
const zero = { input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }
const ten = { input_tokens: 7, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 10 }

function receipt(value: BillingInput, duplicate = false) {
  const common = { protocolVersion: 1 as const, ownerId: value.ownerId, eventId: value.eventId, idempotencyKey: value.eventId,
    pricingVersion: 'weighted-v1' as const, usageSource: 'runtime_snapshot' as const, usage: { ...value.usage } }
  if (value.usage.total_tokens === 0) return { ...common, skipped: true as const, duplicate: false as const }
  const record = { eventId: 'authority-event', duplicate, weightedTokensDelta: 1, creditsMicro: 1 }
  return { ...common, duplicate, recorded: record, debited: { ...record } }
}

async function fixture(run: (input: Parameters<typeof openReviewerTargetedJournal>[0], journal: Awaited<ReturnType<typeof openReviewerTargetedJournal>>) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-targeted-outbox-')))
  try {
    const input = { workspacePath, identity, candidate: { kind: 'first' as const, ...firstCandidateFixture(false).input } }
    await run(input, await openReviewerTargetedJournal(input))
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
}

async function failed(journal: Awaited<ReturnType<typeof openReviewerTargetedJournal>>, dispatchId = 'd1', usage = ten) {
  await journal.append(`claim-${dispatchId}`, { kind: 'claim', taskId: 'targeted-fact-0', dispatchId })
  await journal.append(`usage-${dispatchId}`, { kind: 'usage', taskId: 'targeted-fact-0', dispatchId, usage })
  await journal.append(`fail-${dispatchId}`, { kind: 'fail', taskId: 'targeted-fact-0', dispatchId, usage, reason: 'retryable fixture failure' })
}

function billing(ownerId = identity.ownerId, submitUsage: UsageBillingClient['submitUsage'] = async value => receipt(value)) {
  return { protocolVersion: 1 as const, ownerId, submitUsage }
}

test('targeted outbox seals measured work, bills once, and replays the acknowledgement', async () => fixture(async (input, journal) => {
  await failed(journal)
  const calls: BillingInput[] = []
  const client = billing(identity.ownerId, async value => { calls.push(value); return receipt(value) })
  expect((await flushReviewerTargetedUsage(input, client)).settled).toBe(true)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.sessionId).toBe('d1')
  expect(calls[0]!.usage.total_tokens).toBe(10)
  expect((await flushReviewerTargetedUsage(input, client)).settled).toBe(true)
  expect(calls).toHaveLength(1)
  expect((await openReviewerTargetedJournal(input).then(next => next.read())).billing?.entries[0]?.receipt).toBeDefined()
}))

test('running or unmeasured work remains pending and never guesses zero usage', async () => fixture(async (input, journal) => {
  await journal.append('claim', { kind: 'claim', taskId: 'targeted-fact-0', dispatchId: 'd1' })
  const calls: BillingInput[] = []
  const client = billing(identity.ownerId, async value => { calls.push(value); return receipt(value) })
  expect(await flushReviewerTargetedUsage(input, client)).toEqual({ execution: 'owned', settled: false })
  expect(calls).toHaveLength(0)
  await journal.append('stop', { kind: 'stop' })
  expect(await flushReviewerTargetedUsage(input, client)).toEqual({ execution: 'owned', settled: false })
  expect(calls).toHaveLength(0)
  await journal.append('late-zero', { kind: 'usage', taskId: 'targeted-fact-0', dispatchId: 'd1', usage: zero })
  expect((await flushReviewerTargetedUsage(input, client)).settled).toBe(true)
  expect(calls[0]!.usage.total_tokens).toBe(0)
}))

test('retries bill each measured dispatch exactly once with stable event identities', async () => fixture(async (input, journal) => {
  await failed(journal, 'd1')
  const calls: BillingInput[] = []
  const client = billing(identity.ownerId, async value => { calls.push(value); return receipt(value) })
  expect((await flushReviewerTargetedUsage(input, client)).settled).toBe(true)
  await failed(journal, 'd2', zero)
  expect((await flushReviewerTargetedUsage(input, client)).settled).toBe(true)
  expect(calls.map(call => call.sessionId)).toEqual(['d1', 'd2'])
  expect(new Set(calls.map(call => call.eventId)).size).toBe(2)
  expect((await journal.read()).billing?.entries).toHaveLength(2)
}))

test('an existing execution lease blocks targeted sealing and billing', async () => fixture(async (input, journal) => {
  await failed(journal)
  const lease = await journal.tryExecutionLease()
  if (lease.kind !== 'owned') throw new Error('fixture lease unavailable')
  try {
    const client = billing(identity.ownerId, async () => { throw new Error('must not call billing') })
    expect(await flushReviewerTargetedUsage(input, client)).toEqual({ execution: 'busy', settled: false })
    expect((await journal.read()).billing).toBeUndefined()
  } finally { await lease.release() }
}))

test('uncertain billing leaves a replayable event ID without settling until acknowledgement', async () => fixture(async (input, journal) => {
  await failed(journal)
  const calls: string[] = []
  let unavailable = true
  const client = billing(identity.ownerId, async value => {
    calls.push(value.eventId)
    if (unavailable) throw new Error('offline billing response lost')
    return receipt(value, true)
  })
  expect((await flushReviewerTargetedUsage(input, client)).settled).toBe(false)
  expect((await journal.read()).billing?.entries[0]?.receipt).toBeUndefined()
  unavailable = false
  expect((await flushReviewerTargetedUsage(input, client)).settled).toBe(true)
  expect(calls).toHaveLength(2)
  expect(new Set(calls).size).toBe(1)
}))

test('billing owner must match the targeted journal owner', async () => fixture(async (input, journal) => {
  await failed(journal)
  await expect(flushReviewerTargetedUsage(input, billing('foreign'))).rejects.toThrow('owner mismatch')
}))
