import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, writeFile, readdir, unlink, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRevisionAttemptStore } from '../attempt-store'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
import { revisionUsageEventId } from '../usage-billing'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

const roots: string[] = []
async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-attempt-store-')))
  roots.push(root)
  return root
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const documentPath = 'docs/GDD.md'
function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildReviewerPublishedResult({ documents, state: initialReviewerFactState(documents),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  return { kind: 'initial', ownerId: 'owner', projectId: 'project', requestId: 'repair', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
}
function journal(root: string, request: ReturnType<typeof fixture>) {
  return join(root, '.beegame/workflow/foundation-revision/requests',
    revisionDigest({ ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId }),
    'execution-events')
}
function completed(attemptId: string) {
  return { status: 'completed', attemptId, markdown: reviewFixtureDocuments()[0]!.content,
    usageEvents: [{ type: 'usage', usage: { prompt_tokens: 3, completion_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 5 } }],
    completion: { scope: 'direct-child', pid: 12345, exitCode: 0, signalCode: null, stdoutDrained: true, termination: 'none' } }
}
async function observe(store: Awaited<ReturnType<typeof openRevisionAttemptStore>>, attemptId: string) {
  await store.observeUsage(documentPath, { attemptId, observationIndex: 1, event: completed(attemptId).usageEvents[0] })
}

test('one durable dispatch wins concurrent instances and an active attempt cannot be taken over', async () => {
  const root = await workspace()
  const request = fixture()
  const stores = await Promise.all(Array.from({ length: 6 }, () => openRevisionAttemptStore(root, request)))
  const results = await Promise.allSettled(stores.map(store => store.begin(documentPath)))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const winner = results.find(result => result.status === 'fulfilled')!
  if (winner.status !== 'fulfilled') throw new Error('missing winner')
  const reopened = await openRevisionAttemptStore(root, request)
  expect((await reopened.read(documentPath)).active?.attemptId).toBe(winner.value.attemptId)
  await expect(reopened.begin(documentPath)).rejects.toThrow('explicit recovery')
  await expect(reopened.begin('docs/UI_UX_SPEC.md')).rejects.toThrow('no dispatch')
})

test('failed attempts remain retryable beyond two; stopping refunds count but never reuses identity', async () => {
  const store = await openRevisionAttemptStore(await workspace(), fixture())
  const ids = new Set<string>()
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const started = await store.begin(documentPath)
    ids.add(started.attemptId)
    expect(started.attempt).toBe(attempt)
    await store.settle(documentPath, { status: 'retryable', attemptId: started.attemptId, failureCode: 'native_failed', usageEvents: [] })
  }
  const stopped = await store.begin(documentPath)
  await store.settle(documentPath, { status: 'stopped', attemptId: stopped.attemptId, failureCode: 'cancelled', usageEvents: [] })
  expect((await store.read(documentPath)).attempt).toBe(4)
  const restarted = await store.begin(documentPath)
  expect(restarted.attempt).toBe(5)
  expect(restarted.attemptId).not.toBe(stopped.attemptId)
  expect(ids.has(restarted.attemptId)).toBe(false)
  await expect(store.settle(documentPath, { status: 'retryable', attemptId: restarted.attemptId, failureCode: 'cancelled', usageEvents: [] })).rejects.toThrow('cancellation')
})

test('completion survives callback failure and disk reopen; exact replay cannot rewrite it', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin(documentPath)
  const terminal = completed(started.attemptId)
  await observe(store, started.attemptId)
  const receipt = await store.settle(documentPath, terminal)
  // A downstream callback runs only after settlement resolved and may fail.
  expect(() => { throw new Error('downstream failure') }).toThrow('downstream')
  terminal.markdown = 'caller mutation'
  const reopened = await openRevisionAttemptStore(root, request)
  expect(await reopened.settle(documentPath, completed(started.attemptId))).toEqual(receipt)
  const state = await reopened.read(documentPath)
  expect(state.status).toBe('completed')
  expect(state.eventCount).toBe(3)
  expect(state.output?.markdown).toBe(reviewFixtureDocuments()[0]!.content)
  expect(receipt.usage).toMatchObject({ total_tokens: 5 })
  expect(receipt.durationMs).toBe(Math.max(0, receipt.finishedAt - started.startedAt))
  expect(state.lastReceipt?.durationMs).toBe(receipt.durationMs)
  await expect(reopened.begin(documentPath)).rejects.toThrow('replay receipt')
  await expect(reopened.settle(documentPath, { status: 'retryable', attemptId: started.attemptId, failureCode: 'owner_failed', usageEvents: [] })).rejects.toThrow('conflicting')
  await expect(reopened.settle(documentPath, { ...completed(started.attemptId), markdown: reviewFixtureDocuments()[0]!.content + '\n' })).rejects.toThrow('conflicting')
})

test('rejects stale identity, invalid body, fabricated usage and unclosed observation without recording completion', async () => {
  const store = await openRevisionAttemptStore(await workspace(), fixture())
  const started = await store.begin(documentPath)
  await expect(store.settle(documentPath, completed(crypto.randomUUID()))).rejects.toThrow('stale')
  await expect(store.settle(documentPath, { ...completed(started.attemptId), markdown: '# incomplete' })).rejects.toThrow()
  const wrongUsage = completed(started.attemptId)
  wrongUsage.usageEvents[0]!.usage.total_tokens = 999
  await expect(store.settle(documentPath, wrongUsage)).rejects.toThrow('inconsistent')
  await expect(store.settle(documentPath, { ...completed(started.attemptId), completion: { ...completed(started.attemptId).completion, stdoutDrained: false } })).rejects.toThrow()
  await expect(store.settle(documentPath, { ...completed(started.attemptId), completion: { ...completed(started.attemptId).completion, pid: null } })).rejects.toThrow('observed child')
  expect((await store.read(documentPath)).status).toBe('running')
  expect((await store.read(documentPath)).eventCount).toBe(1)
})

test('synchronously captures terminal data and rejects accessors before executing them', async () => {
  const store = await openRevisionAttemptStore(await workspace(), fixture())
  const started = await store.begin(documentPath)
  let reads = 0
  await expect(store.settle(documentPath, { get status() { reads += 1; return 'completed' } })).rejects.toThrow()
  expect(reads).toBe(0)
  const value = completed(started.attemptId)
  await observe(store, started.attemptId)
  const pending = store.settle(documentPath, value)
  value.markdown = 'mutation after call'
  expect((await pending).output).toMatchObject({ markdown: reviewFixtureDocuments()[0]!.content })
})

test('tampered derived receipt, chain, gap and symlink are refused without self healing', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin(documentPath)
  await observe(store, started.attemptId)
  await store.settle(documentPath, completed(started.attemptId))
  const directory = journal(root, request)
  const names = (await readdir(directory)).sort()
  const path = join(directory, names.at(-1)!)
  const original = await readFile(path, 'utf8')
  for (const modify of [
    (value: any) => { value.output.markdown = '# forged' },
    (value: any) => { value.previousDigest = '0'.repeat(64) },
    (value: any) => { value.packetDigest = '0'.repeat(64) },
    (value: any) => { value.usage.total_tokens = 99 },
    (value: any) => { value.durationMs += 1 },
  ]) {
    const value = JSON.parse(original)
    modify(value)
    const tampered = revisionCanonicalJson(value) + '\n'
    await writeFile(path, tampered)
    await expect(store.read(documentPath)).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(tampered)
  }
  await writeFile(path, original)
  const firstPath = join(directory, names[0]!)
  const firstBytes = await readFile(firstPath, 'utf8')
  await unlink(firstPath)
  await expect(store.read(documentPath)).rejects.toThrow('gap')
  const target = join(root, 'target.json')
  await writeFile(target, firstBytes)
  await symlink(target, firstPath)
  await expect(store.read(documentPath)).rejects.toThrow()
  expect(await readFile(target, 'utf8')).toBe(firstBytes)
})

test('concurrent identical settlements are idempotent and conflicting terminals have one winner', async () => {
  for (const conflict of [false, true]) {
    const root = await workspace()
    const request = fixture()
    const stores = await Promise.all([openRevisionAttemptStore(root, request), openRevisionAttemptStore(root, request)])
    const started = await stores[0]!.begin(documentPath)
    await observe(stores[0]!, started.attemptId)
    const other = completed(started.attemptId)
    if (conflict) other.markdown += '\n'
    const results = await Promise.allSettled([stores[0]!.settle(documentPath, completed(started.attemptId)), stores[1]!.settle(documentPath, other)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(conflict ? 1 : 2)
    expect((await stores[0]!.read(documentPath)).eventCount).toBe(3)
    expect((await stores[0]!.read(documentPath)).status).toBe('completed')
  }
})

test('failed and stopped receipts expose persisted usage and owner timing after reopening', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  for (const status of ['retryable', 'stopped'] as const) {
    const started = await store.begin(documentPath)
    await observe(store, started.attemptId)
    const receipt = await store.settle(documentPath, { status, attemptId: started.attemptId,
      failureCode: status === 'stopped' ? 'cancelled' : 'native_failed', usageEvents: completed(started.attemptId).usageEvents })
    const reopened = await (await openRevisionAttemptStore(root, request)).read(documentPath)
    expect(reopened.lastReceipt).toEqual(receipt)
    expect(reopened.lastReceipt?.usage).toMatchObject({ total_tokens: 5 })
    expect(reopened.lastReceipt?.durationMs).toBe(Math.max(0, receipt.finishedAt - started.startedAt))
  }
})

test('diagnostics survive journal replay without changing billing identity or overriding a winning stop', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  const diagnostic = { stage: 'output_validation', reasonCode: 'validation_worker_changed_metadata' } as const
  const first = await store.begin(documentPath)
  await observe(store, first.attemptId)
  const submitted = { status: 'retryable', attemptId: first.attemptId, failureCode: 'output_invalid',
    diagnostic, usageEvents: completed(first.attemptId).usageEvents, completion: completed(first.attemptId).completion }
  const failed = await store.settle(documentPath, submitted)
  expect(await store.settle(documentPath, submitted)).toEqual(failed)
  const reopened = await openRevisionAttemptStore(root, request)
  expect((await reopened.read(documentPath)).lastSettlement).toMatchObject({ diagnostic })
  const firstOutbox = await reopened.readUsageOutbox()
  expect(firstOutbox.entries).toHaveLength(1)
  expect(firstOutbox.entries[0]!.eventId).toBe(revisionUsageEventId(failed.handle, first.attemptId, firstOutbox.entries[0]!.usage))
  expect(firstOutbox.entries[0]!.receiptDigest).toBe(revisionDigest(failed))
  expect(firstOutbox.entries[0]!.usage).toMatchObject({ total_tokens: 5 })

  const second = await reopened.begin(documentPath)
  await observe(reopened, second.attemptId)
  await reopened.requestStop({ requestId: 'stop-before-diagnostic-settlement', reason: 'user_requested' })
  const stopped = await reopened.settle(documentPath, { ...submitted, attemptId: second.attemptId })
  expect(stopped.settlement).toMatchObject({ status: 'stopped', failureCode: 'cancelled' })
  expect(stopped.settlement).not.toHaveProperty('diagnostic')
  expect(stopped.submittedSettlement).toMatchObject({ diagnostic })
  expect(stopped.output).toBeNull()
  const finalStore = await openRevisionAttemptStore(root, request)
  expect((await finalStore.read(documentPath)).lastReceipt).toEqual(stopped)
  const finalOutbox = await finalStore.readUsageOutbox()
  expect(finalOutbox.entries).toHaveLength(2)
  expect(finalOutbox.entries[0]).toEqual(firstOutbox.entries[0])
  expect(finalOutbox.entries[1]!.usage).toEqual(firstOutbox.entries[0]!.usage)

  const events = await Promise.all((await readdir(journal(root, request))).map(async file =>
    JSON.parse(await readFile(join(journal(root, request), file), 'utf8'))))
  const settlements = events.filter(event => event.kind === 'attempt_settled')
  expect(settlements).toHaveLength(2)
  expect(settlements.map(event => event.submittedSettlement.diagnostic)).toEqual([diagnostic, diagnostic])
  expect(settlements.every(event => event.output === null && !Object.hasOwn(event.submittedSettlement, 'markdown'))).toBe(true)
})
