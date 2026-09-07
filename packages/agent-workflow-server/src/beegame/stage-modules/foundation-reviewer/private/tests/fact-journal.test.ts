import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, writeFile, readdir, unlink, symlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openReviewerFactJournal, ReviewJournalConflictError } from '../fact-journal'
import { prepareFoundationReview } from '../prepare-review'
import { createFactWorkerTask } from '../worker-task'
import { executeReviewWorker } from '../native-worker'
import { foundationFactModelPayloadSchema } from '../worker-schemas'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

const zero = { input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }
const ten = { ...zero, input_tokens: 7, completion_tokens: 3, total_tokens: 10 }
const identity = { ownerId: 'owner', projectId: 'project', requestId: 'review-request' }
const documents = () => CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) }))

async function fixture<T>(run: (context: { workspacePath: string; docs: ReturnType<typeof documents>; journal: Awaited<ReturnType<typeof openReviewerFactJournal>>; path: string }) => Promise<T>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-fact-journal-')))
  try {
    const docs = documents()
    const journal = await openReviewerFactJournal({ workspacePath, identity, documents: docs })
    return await run({ workspacePath, docs, journal, path: join(workspacePath, '.beegame/workflow/foundation-reviewer/state', journal.runId) })
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
}
function output(docs: ReturnType<typeof documents>, index = 0) {
  const prepared = prepareFoundationReview(docs)
  if (prepared.kind !== 'facts_pending') throw new Error('invalid fixture')
  return { status: 'completed', results: prepared.factPackets[index]!.keys.map(key => ({ key, status: 'absent' })) }
}
const claim = (index = 0, dispatchId = 'd1') => ({ kind: 'claim' as const, taskId: `fact-${index}`, dispatchId })
const accept = (docs: ReturnType<typeof documents>, index = 0, dispatchId = 'd1') => ({ kind: 'accept' as const, taskId: `fact-${index}`, dispatchId, output: output(docs, index), usage: ten })

test('input is bound once and read/reopen never create claims or rewrite records', async () => fixture(async ({ workspacePath, docs, journal, path }) => {
  const first = await journal.read()
  const header = await readFile(join(path, 'input.json'), 'utf8')
  const reopened = await openReviewerFactJournal({ workspacePath, identity, documents: docs })
  expect(await reopened.read()).toEqual(first)
  expect(await readdir(join(path, 'events'))).toEqual([])
  docs[0]!.content += '\nchanged'
  expect(await journal.read()).toEqual(first)
  await expect(openReviewerFactJournal({ workspacePath, identity, documents: docs })).rejects.toBeInstanceOf(ReviewJournalConflictError)
  expect(await readFile(join(path, 'input.json'), 'utf8')).toBe(header)
}))

test('accepted packet has an owned immutable receipt and replay preserves evidence', async () => fixture(async ({ workspacePath, docs, journal }) => {
  await journal.append('claim', claim())
  const state = await journal.append('accept', accept(docs))
  const completed = state.collection.tasks[0]!
  expect(completed.status).toBe('completed')
  expect(completed.receiptPath).toStartWith('.beegame/workflow/foundation-reviewer/state/')
  const receipt = JSON.parse(await readFile(join(workspacePath, completed.receiptPath!), 'utf8'))
  expect(receipt.digest).toBe(completed.receiptDigest)
  expect(await journal.append('accept', accept(docs))).toEqual(state)
  const reopened = await openReviewerFactJournal({ workspacePath, identity, documents: docs })
  expect(await reopened.read()).toEqual(state)
  expect(state.collection.aggregateUsage.total_tokens).toBe(10)
}))

test('every fact receipt reaches facts_staged, never a completed overall review', async () => fixture(async ({ docs, journal }) => {
  const initial = await journal.read()
  for (let i = 0; i < initial.collection.tasks.length; i++) {
    await journal.append(`claim-${i}`, claim(i, `d${i}`))
    await journal.append(`accept-${i}`, accept(docs, i, `d${i}`))
  }
  const result = await journal.read()
  expect(result.phase).toBe('facts_staged')
  expect(result.collection.aggregateUsage.total_tokens).toBe(initial.collection.tasks.length * 10)
  expect(await journal.append('stop-after-staged', { kind: 'stop' })).toEqual(result)
}))

test('service enforces four running facts and two failure attempts', async () => fixture(async ({ journal }) => {
  expect((await journal.read()).collection.tasks.length).toBeGreaterThan(4)
  for (let i = 0; i < 4; i++) await journal.append(`claim-${i}`, claim(i, `d${i}`))
  await expect(journal.append('fifth', claim(4, 'd4'))).rejects.toThrow('concurrency')
  await journal.append('failure-one', { kind: 'fail', taskId: 'fact-0', dispatchId: 'd0', usage: ten, reason: 'native_model_error' })
  await journal.append('retry-one', claim(0, 'retry-d0'))
  const state = await journal.append('failure-two', { kind: 'fail', taskId: 'fact-0', dispatchId: 'retry-d0', usage: ten, reason: 'native_model_error' })
  expect(state.phase).toBe('needs_action')
  expect(state.collection.tasks[0]!.attempt).toBe(2)
  await expect(journal.append('retry-exhausted', { kind: 'resume' })).rejects.toThrow('require action')
  expect(state.collection.aggregateUsage.total_tokens).toBe(20)
}))

test('stop preserves used tokens without consuming the attempt; replayed stop cannot stop continuation', async () => fixture(async ({ docs, journal }) => {
  await journal.append('claim', claim())
  await journal.append('usage', { kind: 'usage', taskId: 'fact-0', dispatchId: 'd1', usage: ten })
  const stopped = await journal.append('stop', { kind: 'stop' })
  expect(stopped.phase).toBe('stopped')
  expect(stopped.collection.tasks[0]!.attempt).toBe(0)
  await expect(journal.append('late-accept', accept(docs))).rejects.toThrow('running dispatch')
  await journal.append('continue', { kind: 'resume' })
  const continued = await journal.append('claim-again', claim(0, 'd2'))
  expect(await journal.append('stop', { kind: 'stop' })).toEqual(continued)
  const accepted = await journal.append('accept-again', accept(docs, 0, 'd2'))
  expect(accepted.collection.tasks[0]!.attempt).toBe(1)
  expect(accepted.collection.tasks[0]!.attemptHistory?.[0]?.status).toBe('interrupted')
  expect(accepted.collection.aggregateUsage.total_tokens).toBe(20)
}))

test('usage after stop is retained but cannot regress or attach to an unknown dispatch', async () => fixture(async ({ journal }) => {
  await journal.append('claim', claim())
  await journal.append('stop', { kind: 'stop' })
  const state = await journal.append('late-meter', { kind: 'usage', taskId: 'fact-0', dispatchId: 'd1', usage: ten })
  expect(state.collection.aggregateUsage.total_tokens).toBe(10)
  await expect(journal.append('regress', { kind: 'usage', taskId: 'fact-0', dispatchId: 'd1', usage: zero })).rejects.toThrow('regressed')
  await expect(journal.append('foreign', { kind: 'usage', taskId: 'fact-0', dispatchId: 'foreign', usage: ten })).rejects.toThrow('known dispatch')
}))

test('read preserves outstanding dispatch; explicit lost-process recovery blocks implicit retry', async () => fixture(async ({ workspacePath, docs, journal }) => {
  await journal.append('claim', claim())
  await journal.append('meter', { kind: 'usage', taskId: 'fact-0', dispatchId: 'd1', usage: ten })
  const reopened = await openReviewerFactJournal({ workspacePath, identity, documents: docs })
  expect((await reopened.read()).collection.tasks[0]!.status).toBe('running')
  const state = await reopened.append('lost', { kind: 'recover_lost', dispatchIds: ['d1'] })
  expect(state.phase).toBe('needs_action')
  expect(state.collection.tasks[0]!.attempt).toBe(1)
  expect(state.collection.aggregateUsage.total_tokens).toBe(10)
  await expect(reopened.append('retry-lost', { kind: 'resume' })).rejects.toThrow('require action')
}))

test('missing configuration before first dispatch can be explicitly retried', async () => fixture(async ({ journal }) => {
  expect((await journal.append('missing', { kind: 'configuration_unavailable' })).phase).toBe('needs_action')
  expect((await journal.append('configuration-fixed', { kind: 'resume' })).phase).toBe('extracting_facts')
  expect((await journal.append('claim', claim())).collection.tasks[0]!.attempt).toBe(1)
}))

test('configuration failure after dispatch requires action immediately', async () => fixture(async ({ journal }) => {
  await journal.append('claim', claim())
  const state = await journal.append('bad-config', { kind: 'fail', taskId: 'fact-0', dispatchId: 'd1', usage: zero, reason: 'foundation fact fast model is not configured' })
  expect(state.phase).toBe('needs_action')
  expect(state.collection.tasks[0]!.attempt).toBe(1)
  await expect(journal.append('retry', { kind: 'resume' })).rejects.toThrow('require action')
}))

test('identical request strings from different owners have disjoint journals', async () => fixture(async ({ workspacePath, docs, journal }) => {
  const other = await openReviewerFactJournal({ workspacePath, documents: docs, identity: { ...identity, ownerId: 'other-owner' } })
  expect(other.runId).not.toBe(journal.runId)
  await journal.append('claim', claim())
  expect((await other.read()).collection.tasks.every(task => task.status === 'pending')).toBe(true)
}))

test('incomplete unpublished temporary records are ignored, not mistaken for accepted output', async () => fixture(async ({ journal, path }) => {
  await journal.append('claim', claim())
  await writeFile(join(path, 'events/.pending-crash'), '{incomplete receipt')
  expect((await journal.read()).collection.tasks[0]!.status).toBe('running')
  const header = JSON.parse(await readFile(join(path, 'input.json'), 'utf8'))
  header.policyDigest = '0'.repeat(64)
  await writeFile(join(path, 'input.json'), JSON.stringify(header))
  await expect(journal.read()).rejects.toThrow('input binding changed')
}))

test('concurrent same command is idempotent and conflicting payload cannot overwrite it', async () => fixture(async ({ workspacePath, docs, journal, path }) => {
  const other = await openReviewerFactJournal({ workspacePath, identity, documents: docs })
  await Promise.all([journal.append('same-command', claim()), other.append('same-command', claim())])
  expect((await journal.read()).collection.tasks[0]!.attempt).toBe(1)
  expect((await readdir(join(path, 'events'))).filter(name => name.endsWith('.json'))).toHaveLength(1)
  await expect(other.append('same-command', claim(1, 'another'))).rejects.toBeInstanceOf(ReviewJournalConflictError)
}))

test('invalid output and forged dispatch identity never leave a receipt', async () => fixture(async ({ docs, journal, path }) => {
  await journal.append('claim', claim())
  await expect(journal.append('forged', { ...accept(docs), dispatchId: 'foreign' })).rejects.toThrow()
  await expect(journal.append('invalid', { ...accept(docs), output: { ...output(docs), runId: 'model-identity' } })).rejects.toThrow()
  expect((await readdir(join(path, 'events'))).filter(name => name.endsWith('.json'))).toHaveLength(1)
}))

test('tampered or missing event evidence fails closed during replay', async () => fixture(async ({ journal, path }) => {
  await journal.append('claim', claim())
  await journal.append('stop', { kind: 'stop' })
  const eventPath = join(path, 'events/00000000.json')
  const original = await readFile(eventPath, 'utf8')
  const tampered = JSON.parse(original); tampered.event.dispatchId = 'changed'
  await writeFile(eventPath, JSON.stringify(tampered))
  await expect(journal.read()).rejects.toThrow('binding mismatch')
  await writeFile(eventPath, original)
  await unlink(eventPath)
  await expect(journal.read()).rejects.toThrow('not contiguous')
}))

test('journal paths cannot follow symlinks into another stage directory', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-symlink-')))
  try {
    const other = join(workspacePath, 'other-stage')
    await mkdir(other)
    await symlink(other, join(workspacePath, '.beegame'))
    await expect(openReviewerFactJournal({ workspacePath, identity, documents: documents() })).rejects.toThrow('real directory')
    expect(await readdir(other)).toEqual([])
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('real offline native output is metered, accepted, and replayed without native execution', async () => fixture(async ({ workspacePath, docs, journal }) => {
  await journal.append('claim', claim())
  const task = createFactWorkerTask(docs, 0)
  let meteringIndex = 0
  const result = await executeReviewWorker({
    configuration: { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts')], env: {} },
    workspacePath,
    task: { ...task, admit(value) { task.admit(value); return foundationFactModelPayloadSchema.parse(value) } },
    onUsage: usage => journal.append(`usage-${meteringIndex++}`, { kind: 'usage', taskId: 'fact-0', dispatchId: 'd1', usage: {
      input_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, cache_read_tokens: usage.cache_read_tokens,
      cache_creation_tokens: usage.cache_creation_tokens, total_tokens: usage.total_tokens,
    } }).then(() => {}),
  })
  const accepted = await journal.append('accept', { ...accept(docs), output: result.value })
  expect(accepted.collection.aggregateUsage.total_tokens).toBe(10)
  const restored = await openReviewerFactJournal({ workspacePath, identity, documents: docs })
  expect(await restored.read()).toEqual(accepted)
  await expect(readFile(join(workspacePath, 'docs/GDD.md'))).rejects.toThrow()
}))
