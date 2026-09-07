import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReviewerInitialLifecycle } from '../initial-lifecycle'
import { parseReviewerInitialStart } from '../initial-contract'
import { reviewerInputDigest, buildReviewerPublishedResult } from '../review-publication'
import { reviewFixtureDocuments, fixtureUsage } from '../test-fixtures/review-fixture'
import { offlineReviewerBilling } from '../test-fixtures/offline-billing'
import { openReviewerFactJournal } from '../fact-journal'
import { prepareFoundationReview } from '../prepare-review'

const ownerId = 'initial-failure-billing-owner'
const subject = {
  kind: 'initial' as const,
  sourceResultId: 'source-result',
  sourceDocumentRevision: 'a'.repeat(64),
  confirmedBriefDigest: 'b'.repeat(64),
}

function start(documents: ReturnType<typeof reviewFixtureDocuments>, requestId: string) {
  return parseReviewerInitialStart({
    protocolVersion: 1,
    requestId,
    ownerId,
    projectId: 'project',
    inputDigest: reviewerInputDigest({ ownerId, projectId: 'project', subject, documents }),
    input: { subject, documents },
  })
}

function journalInput(workspacePath: string, input: ReturnType<typeof start>) {
  return {
    workspacePath,
    identity: { ownerId: input.ownerId, projectId: input.projectId, requestId: input.requestId },
    documents: input.input.documents,
    binding: { inputDigest: input.inputDigest, subject: input.input.subject },
  }
}

const configuration = { protocolVersion: 1 as const, ownerId, async resolve() {
  throw new Error('pre-filled failure fixture must not execute a worker')
} }

async function fixture(run: (workspacePath: string) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-initial-failure-billing-')))
  try { await run(workspacePath) } finally { await rm(workspacePath, { recursive: true, force: true }) }
}

async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('initial failure billing fixture did not reach expected state')
}

/** Seed the durable terminal state directly; this keeps the regression offline and deterministic. */
async function seedCompletedJournal(journal: Awaited<ReturnType<typeof openReviewerFactJournal>>, documents: ReturnType<typeof reviewFixtureDocuments>) {
  const prepared = prepareFoundationReview(documents)
  if (prepared.kind !== 'facts_pending') throw new Error('failure fixture documents must be valid')
  for (const [index, packet] of prepared.factPackets.entries()) {
    const taskId = `fact-${index}`
    await journal.append(`seed:claim:${taskId}`, { kind: 'claim', taskId, dispatchId: taskId })
    await journal.append(`seed:accept:${taskId}`, { kind: 'accept', taskId, dispatchId: taskId, usage: fixtureUsage,
      output: { status: 'completed', results: packet.keys.map(key => ({ key, status: 'absent' })) } })
  }
  await journal.append('seed:begin-semantic', { kind: 'begin_semantic' })
  for (;;) {
    const state = await journal.read()
    const task = state.semantic?.collection.tasks.find(item => item.status === 'pending')
    if (!task) return state
    await journal.append(`seed:claim:${task.taskId}`, { kind: 'semantic', command: { kind: 'claim', taskId: task.taskId, dispatchId: task.taskId } })
    await journal.append(`seed:accept:${task.taskId}`, { kind: 'semantic', command: { kind: 'accept', taskId: task.taskId,
      dispatchId: task.taskId, usage: fixtureUsage, output: { status: 'completed', outcome: 'PASS' } } })
  }
}

async function corruptPublication(workspacePath: string, resultId: string) {
  const root = join(workspacePath, '.beegame/workflow/foundation-reviewer/results', resultId)
  await mkdir(root, { recursive: true })
  const bodyPath = join(root, 'result.json')
  await writeFile(bodyPath, '{"forged":true}\n')
  return bodyPath
}

test('publication failure still flushes persisted usage while preserving the publication failure', async () => fixture(async workspacePath => {
  const documents = reviewFixtureDocuments(true)
  const input = start(documents, 'publication-failure-billing')
  const journal = await openReviewerFactJournal(journalInput(workspacePath, input))
  const state = await seedCompletedJournal(journal, documents)
  const expected = buildReviewerPublishedResult({ ...journalInput(workspacePath, input), subject, state })
  const bodyPath = await corruptPublication(workspacePath, expected.resultId)
  const billing = offlineReviewerBilling(ownerId)
  let configurationCalls = 0
  const api = createReviewerInitialLifecycle(workspacePath, {
    billing: billing.client,
    runtimeConfiguration: { ...configuration, async resolve() { configurationCalls++; return configuration.resolve() } },
  })
  const handle = await api.start(input)
  await api.resume({ handle, requestId: 'resume-publication-failure' })
  const result = await until(() => api.getResult(handle), value => value.status === 'needs_action' && value.billingStatus === 'settled')
  if (result.status !== 'needs_action') throw new Error('publication failure must require action')
  expect(result.reason).toContain('publication')
  expect(configurationCalls).toBe(0)
  expect(billing.recorded.size).toBe(state.collection.tasks.length + (state.semantic?.collection.tasks.length ?? 0))
  expect((await journal.read()).control?.failure).toBe('publication_failed')
  expect((await journal.read()).billing?.entries.every(entry => entry.receipt)).toBe(true)
  await expect(unlink(bodyPath)).resolves.toBeUndefined()
}), 30_000)

test('billing failure keeps the original publication failure pending and resume replays each usage key once', async () => fixture(async workspacePath => {
  const documents = reviewFixtureDocuments(true)
  const input = start(documents, 'billing-failure-replay')
  const journal = await openReviewerFactJournal(journalInput(workspacePath, input))
  const state = await seedCompletedJournal(journal, documents)
  const expected = buildReviewerPublishedResult({ ...journalInput(workspacePath, input), subject, state })
  const bodyPath = await corruptPublication(workspacePath, expected.resultId)
  const billing = offlineReviewerBilling(ownerId)
  billing.setAvailable(false)
  type BillingInput = Parameters<typeof billing.client.submitUsage>[0]
  const calls: BillingInput[] = []
  const client = { ...billing.client, async submitUsage(value: BillingInput) {
    calls.push(structuredClone(value))
    return billing.client.submitUsage(value)
  } }
  const api = createReviewerInitialLifecycle(workspacePath, { billing: client, runtimeConfiguration: configuration })
  const handle = await api.start(input)
  await api.resume({ handle, requestId: 'resume-billing-failure' })
  const pending = await until(() => api.getResult(handle), value => value.status === 'needs_action' && value.billingStatus === 'pending')
  if (pending.status !== 'needs_action') throw new Error('billing failure must require action')
  expect(pending.reason).toContain('publication')
  expect((await journal.read()).control?.failure).toBe('publication_failed')
  expect((await journal.read()).billing?.entries.some(entry => !entry.receipt)).toBe(true)
  expect(billing.recorded.size).toBe(0)

  await unlink(bodyPath)
  billing.setAvailable(true)
  await api.resume({ handle, requestId: 'explicit-billing-replay' })
  const completed = await until(() => api.getResult(handle), value => value.status === 'completed' && value.billingStatus === 'settled')
  expect(completed.status).toBe('completed')
  const expectedDispatches = state.collection.tasks.length + (state.semantic?.collection.tasks.length ?? 0)
  expect(calls).toHaveLength(expectedDispatches * 2)
  expect(new Set(calls.map(call => call.eventId)).size).toBe(expectedDispatches)
  expect(billing.recorded.size).toBe(expectedDispatches)
  expect(new Set([...billing.recorded.values()].map(call => call.eventId)).size).toBe(expectedDispatches)
}), 30_000)

test('lost billing response replays the same authority key as a duplicate after publication recovery', async () => fixture(async workspacePath => {
  const documents = reviewFixtureDocuments(true)
  const input = start(documents, 'billing-authority-response-lost')
  const journal = await openReviewerFactJournal(journalInput(workspacePath, input))
  const state = await seedCompletedJournal(journal, documents)
  const expected = buildReviewerPublishedResult({ ...journalInput(workspacePath, input), subject, state })
  const bodyPath = await corruptPublication(workspacePath, expected.resultId)
  const billing = offlineReviewerBilling(ownerId)
  type BillingInput = Parameters<typeof billing.client.submitUsage>[0]
  type BillingReceipt = Awaited<ReturnType<typeof billing.client.submitUsage>>
  const calls: BillingInput[] = []
  const receipts: BillingReceipt[] = []
  let loseResponse = true
  const client = { ...billing.client, async submitUsage(value: BillingInput) {
    calls.push(structuredClone(value))
    const received = await billing.client.submitUsage(value)
    receipts.push(received)
    if (loseResponse) throw new Error('authority committed usage but response was lost')
    return received
  } }
  const api = createReviewerInitialLifecycle(workspacePath, { billing: client, runtimeConfiguration: configuration })
  const handle = await api.start(input)
  await api.resume({ handle, requestId: 'resume-authority-response-lost' })
  const pending = await until(() => api.getResult(handle), value => value.status === 'needs_action' && value.billingStatus === 'pending')
  if (pending.status !== 'needs_action') throw new Error('lost billing response must require action')
  expect(pending.reason).toContain('publication')
  expect((await journal.read()).control?.failure).toBe('publication_failed')
  const expectedDispatches = state.collection.tasks.length + (state.semantic?.collection.tasks.length ?? 0)
  expect(calls).toHaveLength(expectedDispatches)
  expect(receipts).toHaveLength(expectedDispatches)
  expect(billing.recorded.size).toBe(expectedDispatches)
  const recordedBeforeReplay = billing.recorded.size

  await unlink(bodyPath)
  loseResponse = false
  await api.resume({ handle, requestId: 'explicit-authority-replay' })
  const completed = await until(() => api.getResult(handle), value => value.status === 'completed' && value.billingStatus === 'settled')
  expect(completed.status).toBe('completed')
  expect(calls).toHaveLength(expectedDispatches * 2)
  expect(new Set(calls.map(call => call.eventId)).size).toBe(expectedDispatches)
  expect(billing.recorded.size).toBe(recordedBeforeReplay)
  expect(receipts.slice(expectedDispatches).every(receipt => receipt.duplicate === true)).toBe(true)
}), 30_000)
