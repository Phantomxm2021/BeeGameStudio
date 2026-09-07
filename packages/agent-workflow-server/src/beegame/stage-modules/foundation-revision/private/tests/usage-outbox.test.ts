import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, readdir, writeFile, mkdir, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BeeGameUsageBillingClient,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
  BeeGameUsageBillingUsage,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { createUsageBillingClient } from '../../../../../billing/public'
import { openRevisionAttemptStore } from '../attempt-store'
import { flushRevisionUsage } from '../usage-outbox'
import type { RevisionBillingUsage } from '../usage-billing'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
import { type RevisionUsageEvent } from '../native-usage'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

const documentPath = 'docs/GDD.md' as const
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildReviewerPublishedResult({
    documents,
    state: initialReviewerFactState(documents),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) },
  })
  return {
    kind: 'initial' as const,
    ownerId: 'owner',
    projectId: 'project',
    requestId: 'usage-outbox',
    sourceResult,
    sourceBinding: {
      ownerId: sourceResult.ownerId,
      projectId: sourceResult.projectId,
      resultId: sourceResult.resultId,
      resultDigest: revisionDigest(sourceResult),
    },
  }
}

async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-usage-outbox-')))
  roots.push(root)
  return root
}

function usage(type: RevisionUsageEvent['type'] = 'usage', prompt_tokens = 3, completion_tokens = 2): RevisionUsageEvent {
  return { type, usage: {
    prompt_tokens, completion_tokens, cache_read_tokens: 0, cache_creation_tokens: 0,
    total_tokens: prompt_tokens + completion_tokens,
  } }
}

function completion() {
  return { scope: 'direct-child' as const, pid: 12345, exitCode: 0, signalCode: null,
    stdoutDrained: true as const, termination: 'none' as const }
}

function validMarkdown() {
  return reviewFixtureDocuments()[0]!.content
}

async function terminal(root: string, request: ReturnType<typeof fixture>, status: 'retryable' | 'stopped' | 'completed', event?: RevisionUsageEvent) {
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin(documentPath)
  const usageEvents = event ? [event] : []
  if (event) await store.observeUsage(documentPath, { attemptId: started.attemptId, observationIndex: 1, event })
  const settlement = status === 'completed'
    ? { status, attemptId: started.attemptId, markdown: validMarkdown(), usageEvents, completion: completion() }
    : { status, attemptId: started.attemptId, failureCode: status === 'stopped' ? 'cancelled' as const : 'native_failed' as const, usageEvents }
  await store.settle(documentPath, settlement)
  return { attemptId: started.attemptId, usage: event?.usage ?? { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 } }
}

type Call = { method: 'record' | 'debit'; ownerId: string; input: BeeGameUsageBillingRecordInput }

function backendResult(input: BeeGameUsageBillingRecordInput, id: string, duplicate = false): BeeGameUsageBillingRecordResult {
  const usage = input.usage as BeeGameUsageBillingUsage
  return {
    duplicate,
    event: {
      id,
      idempotencyKey: input.idempotencyKey,
      userId: 'owner',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      pricingVersion: input.pricingVersion ?? 'weighted-v1',
      usageSource: input.usageSource ?? 'runtime_snapshot',
      usage,
      delta: usage,
      weightedTokens: usage.total_tokens,
      weightedTokensDelta: usage.total_tokens,
      creditsMicro: usage.total_tokens,
      createdAt: '2026-09-06T00:00:00.000Z',
      metadata: input.metadata ?? {},
    },
    cumulativeUsage: usage,
    cumulativeWeightedTokens: usage.total_tokens,
    creditsMicro: usage.total_tokens,
  }
}

function fakeBilling(calls: Call[], options: { failDebit?: () => boolean; delay?: number } = {}): BeeGameUsageBillingClient {
  let recordCount = 0
  return {
    async recordUsage(ownerId, input) {
      calls.push({ method: 'record', ownerId, input })
      recordCount += 1
      const duplicate = recordCount > 1
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay))
      return backendResult(input, 'record-event', duplicate)
    },
    async debitRealTimeUsage(ownerId, input) {
      calls.push({ method: 'debit', ownerId, input })
      const duplicate = calls.filter(call => call.method === 'debit').length > 1
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay))
      if (options.failDebit?.()) throw new Error('temporary debit failure')
      return backendResult(input, 'debit-event', duplicate)
    },
  }
}

function client(calls: Call[], options: Parameters<typeof fakeBilling>[1] = {}) {
  return createUsageBillingClient({ ownerId: 'owner', billingClient: fakeBilling(calls, options) })
}

function requestKey(request: ReturnType<typeof fixture>) {
  return revisionDigest({ ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId })
}

function executionJournal(root: string, request: ReturnType<typeof fixture>) {
  return join(root, '.beegame/workflow/foundation-revision/requests', requestKey(request), 'execution-events')
}

test('outbox contains exact terminal usage for retryable, stopped, and completed attempts, excluding active work', async () => {
  for (const status of ['retryable', 'stopped', 'completed'] as const) {
    const root = await workspace()
    const request = fixture()
    const expected = usage('usage', 3, 2)
    await terminal(root, request, status, expected)
    const store = await openRevisionAttemptStore(root, request)
    const outbox = await store.readUsageOutbox()
    expect(outbox.activeAttemptIds).toEqual([])
    expect(outbox.entries).toHaveLength(1)
    expect(outbox.entries[0]).toMatchObject({ documentPath, usage: expected.usage, receipt: null })
    expect(outbox.entries[0]!.eventId).toContain(outbox.entries[0]!.attemptId)
  }

  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin(documentPath)
  expect(await store.readUsageOutbox()).toEqual({ entries: [], activeAttemptIds: [started.attemptId] })
  const calls: Call[] = []
  expect(await flushRevisionUsage(root, request, client(calls))).toEqual({ settled: false, pending: 0, acknowledged: 0, active: 1 })
  expect(calls).toHaveLength(0)
})

test('zero usage is acknowledged as skipped, while positive debit failure retries the same event ID without redispatch', async () => {
  const zeroRoot = await workspace()
  const zeroRequest = fixture()
  await terminal(zeroRoot, zeroRequest, 'stopped')
  const zeroCalls: Call[] = []
  const zeroClient = client(zeroCalls)
  expect(await flushRevisionUsage(zeroRoot, zeroRequest, zeroClient)).toEqual({ settled: true, pending: 0, acknowledged: 1, active: 0 })
  expect(zeroCalls).toHaveLength(0)
  const zeroOutbox = await (await openRevisionAttemptStore(zeroRoot, zeroRequest)).readUsageOutbox()
  expect(zeroOutbox.entries[0]!.receipt).toMatchObject({ skipped: true, duplicate: false })

  const root = await workspace()
  const request = fixture()
  await terminal(root, request, 'completed', usage('result', 3, 2))
  let fail = true
  const calls: Call[] = []
  const billing = client(calls, { failDebit: () => { const current = fail; fail = false; return current } })
  expect(await flushRevisionUsage(root, request, billing)).toEqual({ settled: false, pending: 1, acknowledged: 0, active: 0 })
  // A failed debit is swallowed by the outbox flush, so this is the same
  // terminal fact delivered again and then durably acknowledged.
  expect(await flushRevisionUsage(root, request, billing)).toEqual({ settled: true, pending: 0, acknowledged: 1, active: 0 })
  expect(calls.map(call => call.method)).toEqual(['record', 'debit', 'record', 'debit'])
  expect(new Set(calls.map(call => call.input.idempotencyKey)).size).toBe(1)
  await expect((await openRevisionAttemptStore(root, request)).begin(documentPath)).rejects.toThrow('already completed')
})

test('concurrent flushes accept duplicate billing flags but commit one durable acknowledgement', async () => {
  const root = await workspace()
  const request = fixture()
  await terminal(root, request, 'completed', usage('usage', 3, 2))
  const calls: Call[] = []
  const billing = client(calls, { delay: 5 })
  const results = await Promise.all([flushRevisionUsage(root, request, billing), flushRevisionUsage(root, request, billing)])
  expect(results).toHaveLength(2)
  expect(results.every(result => result.settled && result.pending === 0)).toBe(true)
  expect(calls.filter(call => call.method === 'record')).toHaveLength(2)
  expect(new Set(calls.map(call => call.input.idempotencyKey)).size).toBe(1)
  const outbox = await (await openRevisionAttemptStore(root, request)).readUsageOutbox()
  expect(outbox.entries).toHaveLength(1)
  expect(outbox.entries[0]!.receipt).not.toBeNull()
  expect((await readdir(executionJournal(root, request))).filter(name => /^\d+\.json$/.test(name))).toHaveLength(4)
})

test('wrong-owner, changed-usage, positive-skipped, and malformed acknowledgements remain pending', async () => {
  const root = await workspace()
  const request = fixture()
  await terminal(root, request, 'completed', usage('usage', 3, 2))
  const store = await openRevisionAttemptStore(root, request)
  const entry = (await store.readUsageOutbox()).entries[0]!
  const calls: Call[] = []
  const valid = await client(calls).submitUsage({ ownerId: 'owner', projectId: 'project', sessionId: entry.attemptId,
    turnId: entry.attemptId, eventId: entry.eventId, usage: entry.usage })
  await expect(store.acknowledgeUsage({ attemptId: entry.attemptId, receipt: { ...valid, ownerId: 'other-owner' } })).rejects.toThrow()
  await expect(store.acknowledgeUsage({ attemptId: entry.attemptId, receipt: { ...valid,
    usage: { ...valid.usage, total_tokens: valid.usage.total_tokens + 1 } } })).rejects.toThrow()
  const positiveSkipped = { ...valid, skipped: true as const, duplicate: false,
    usage: { ...valid.usage } }
  delete (positiveSkipped as Record<string, unknown>).recorded
  delete (positiveSkipped as Record<string, unknown>).debited
  await expect(store.acknowledgeUsage({ attemptId: entry.attemptId, receipt: positiveSkipped })).rejects.toThrow()
  await expect(store.acknowledgeUsage({ attemptId: entry.attemptId, receipt: {} })).rejects.toThrow()
  expect((await store.readUsageOutbox()).entries[0]!.receipt).toBeNull()
})

test('reopened outbox is caller-independent and tampered acknowledgement journals fail closed', async () => {
  const root = await workspace()
  const request = fixture()
  await terminal(root, request, 'completed', usage('usage', 3, 2))
  const reopened = await openRevisionAttemptStore(root, request)
  const entry = (await reopened.readUsageOutbox()).entries[0]!
  const calls: Call[] = []
  const receipt = await client(calls).submitUsage({ ownerId: 'owner', projectId: 'project', sessionId: entry.attemptId,
    turnId: entry.attemptId, eventId: entry.eventId, usage: { ...entry.usage } })
  const pending = reopened.acknowledgeUsage({ attemptId: entry.attemptId, receipt })
  ;(receipt.usage as RevisionBillingUsage).total_tokens = 999
  await pending
  expect((await reopened.readUsageOutbox()).entries[0]!.receipt!.usage.total_tokens).toBe(5)

  const names = (await readdir(executionJournal(root, request))).filter(name => /^\d+\.json$/.test(name)).sort()
  const ackPath = join(executionJournal(root, request), names.at(-1)!)
  const original = await readFile(ackPath, 'utf8')
  const tampered = JSON.parse(original) as Record<string, any>
  tampered.receipt.usage.total_tokens = 999
  const tamperedBytes = `${revisionCanonicalJson(tampered)}\n`
  await writeFile(ackPath, tamperedBytes)
  await expect((await openRevisionAttemptStore(root, request)).readUsageOutbox()).rejects.toThrow()
  expect(await readFile(ackPath, 'utf8')).toBe(tamperedBytes)
})

test('flush captures the request before caller mutation and passes an independent usage snapshot', async () => {
  const root = await workspace()
  const request = fixture()
  await terminal(root, request, 'completed', usage('usage', 3, 2))
  const calls: Call[] = []
  const pending = flushRevisionUsage(root, request, client(calls))
  request.sourceResult.documents[0]!.content = '# caller mutation'
  const result = await pending
  expect(result).toMatchObject({ settled: true, pending: 0, acknowledged: 1 })
  expect(calls[0]!.input.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 5 })
})

test('successful authority submission followed by failed local acknowledgement replays the same fact', async () => {
  const root = await workspace()
  const request = fixture()
  await terminal(root, request, 'completed', usage())
  const calls: Call[] = []
  const authority = client(calls)
  const blocker = join(executionJournal(root, request), '0000000000000004.json')
  const interrupted = { ...authority, async submitUsage(input: Parameters<typeof authority.submitUsage>[0]) {
    const receipt = await authority.submitUsage(input)
    await mkdir(blocker)
    return receipt
  } }
  try { await expect(flushRevisionUsage(root, request, interrupted)).rejects.toThrow() }
  finally { await rmdir(blocker) }
  const store = await openRevisionAttemptStore(root, request)
  expect((await store.readUsageOutbox()).entries[0]!.receipt).toBeNull()
  expect((await store.read(documentPath)).status).toBe('completed')
  expect(await flushRevisionUsage(root, request, authority)).toMatchObject({ settled: true, acknowledged: 1 })
  expect(new Set(calls.map(call => call.input.idempotencyKey)).size).toBe(1)
  const acknowledged = (await store.readUsageOutbox()).entries[0]!
  const receipt = acknowledged.receipt!
  if ('skipped' in receipt) throw new Error('expected positive usage acknowledgement')
  await expect(store.acknowledgeUsage({ attemptId: acknowledged.attemptId,
    receipt: { ...receipt, recorded: { ...receipt.recorded, creditsMicro: receipt.recorded.creditsMicro + 1 } } })).rejects.toThrow('immutable conflict')
  expect((await store.readUsageOutbox()).entries[0]!.receipt).toEqual(receipt)
})
