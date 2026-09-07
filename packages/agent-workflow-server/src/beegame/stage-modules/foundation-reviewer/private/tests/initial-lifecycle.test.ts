import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readdir, lstat, readFile, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReviewerInitialLifecycle } from '../initial-lifecycle'
import { parseReviewerInitialStart } from '../initial-contract'
import { reviewerInputDigest } from '../review-publication'
import { reviewFixtureDocuments } from '../test-fixtures/review-fixture'
import { offlineReviewerBilling } from '../test-fixtures/offline-billing'
import { createReviewerRegistrations } from '../initial-registration'
import { openReviewerFactJournal } from '../fact-journal'
import { reviewerDigest } from '../review-summary'

const ownerId = 'initial-owner'
const subject = { kind: 'initial' as const, sourceResultId: 'source-result', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }
function start(documents = reviewFixtureDocuments(true)) {
  return parseReviewerInitialStart({ protocolVersion: 1, requestId: 'request', ownerId, projectId: 'project',
    inputDigest: reviewerInputDigest({ ownerId, projectId: 'project', subject, documents }), input: { subject, documents } })
}
const configuration = (mode = 'success') => ({ protocolVersion: 1 as const, ownerId, async resolve() {
  return { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts'), `--fixture-mode=${mode}`],
    env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast', OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' } }
} })
async function fixture(run: (workspacePath: string) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-initial-lifecycle-')))
  try { await run(workspacePath) } finally { await rm(workspacePath, { recursive: true, force: true }) }
}
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 100_000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 500)) }
  throw new Error('initial lifecycle did not reach expected state')
}
async function snapshot(path: string): Promise<unknown> {
  const stat = await lstat(path)
  return stat.isDirectory() ? [stat.mtimeMs, await Promise.all((await readdir(path)).sort().map(async name => [name, await snapshot(join(path, name))]))]
    : [stat.mtimeMs, await readFile(path, 'utf8')]
}
const journalInput = (workspacePath: string, input: ReturnType<typeof start>) => ({ workspacePath, identity: { ownerId: input.ownerId, projectId: input.projectId, requestId: input.requestId },
  documents: input.input.documents, binding: { inputDigest: input.inputDigest, subject: input.input.subject } })

test('stop cannot turn an unowned initial worker claim into resumable work', async () => fixture(async workspacePath => {
  const input = start(reviewFixtureDocuments(false))
  const registration = await createReviewerRegistrations(workspacePath, ownerId).register(input)
  const journal = await openReviewerFactJournal(journalInput(workspacePath, input))
  await journal.append('orphan', { kind: 'claim', taskId: 'fact-0', dispatchId: 'orphan' })
  const before = await journal.read()
  const api = createReviewerInitialLifecycle(workspacePath, { billing: offlineReviewerBilling(ownerId).client, runtimeConfiguration: configuration() })
  const result = await api.stop({ handle: registration.handle, requestId: 'stop-orphan', reason: 'operator stop' })
  expect(result.status).toBe('needs_action')
  if (result.status !== 'needs_action') throw new Error('orphan must remain blocked')
  expect(result.resumable).toBe(false)
  expect(await journal.read()).toEqual(before)
  expect(await api.resume({ handle: registration.handle, requestId: 'resume-orphan' })).toEqual(result)
}))

test('only explicit resume recovers a dead execution owner that never claimed a worker', async () => fixture(async workspacePath => {
  const documents = reviewFixtureDocuments(); documents[0]!.content = '# incomplete\n'
  const input = start(documents)
  const registration = await createReviewerRegistrations(workspacePath, ownerId).register(input)
  const journal = await openReviewerFactJournal(journalInput(workspacePath, input))
  const child = Bun.spawn([process.execPath, '--eval', ''], { stdout: 'ignore', stderr: 'ignore' })
  await child.exited
  const root = join(workspacePath, '.beegame/workflow/foundation-reviewer/state', reviewerDigest(journalInput(workspacePath, input).identity))
  const oldLease = JSON.stringify({ version: 1, runId: journal.runId, pid: child.pid, token: randomUUID() })
  await writeFile(join(root, 'execution.lock'), oldLease)
  const api = createReviewerInitialLifecycle(workspacePath, { billing: offlineReviewerBilling(ownerId).client, runtimeConfiguration: configuration() })
  const before = await snapshot(workspacePath)
  const pending = await api.getResult(registration.handle)
  expect(pending.status).toBe('needs_action')
  if (pending.status !== 'needs_action') throw new Error('stale execution must need explicit recovery')
  expect(pending.resumable).toBe(true)
  expect(await snapshot(workspacePath)).toEqual(before)
  expect(await api.start(input)).toEqual(registration.handle)
  expect(await journal.leaseStatus()).toBe('stale')
  await api.resume({ handle: registration.handle, requestId: 'explicit-recovery' })
  const result = await until(() => api.getResult(registration.handle), value => value.status === 'completed')
  expect(result.status).toBe('completed')
  expect(await readFile(join(root, 'execution.lock'), 'utf8')).toBe(oldLease)
}), 20_000)

test('initial lifecycle owns fact->semantic->publication->billing with opaque handles and readonly completed lookup', async () => fixture(async workspacePath => {
  const documents = reviewFixtureDocuments(true)
  documents[0]!.content = documents[0]!.content.replace(/\n\ngame\.mechanics: [^\n]+\n/, '')
  const input = start(documents)
  const billing = offlineReviewerBilling(ownerId)
  let calls = 0
  const infrastructure = { runtimeConfiguration: { ...configuration(), async resolve() { calls++; return configuration().resolve() } }, billing: billing.client }
  const api = createReviewerInitialLifecycle(workspacePath, infrastructure)
  const handle = await api.start(input)
  expect(Object.keys(handle).sort()).toEqual(['id', 'producer', 'protocolVersion'])
  expect(await api.start(input)).toEqual(handle)
  const result = await until(() => api.getResult(handle), value => value.status === 'completed' && value.billingStatus === 'settled')
  expect(result.status).toBe('completed')
  if (result.status !== 'completed') throw new Error('no review result')
  expect(result.result.kind).toBe('issues_found')
  expect(result.result.issues.some(item => item.issue.actual.includes('game.mechanics'))).toBe(true)
  expect(result.result.documents.map(item => item.content)).toEqual(documents.map(item => item.content))
  expect(calls).toBe(11)
  expect(billing.recorded.size).toBe(11)
  const journal = await openReviewerFactJournal({ ...journalInput(workspacePath, input), readOnly: true })
  await until(() => journal.leaseStatus(), value => value === 'free')
  const before = await snapshot(workspacePath)
  const reopened = createReviewerInitialLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: { ...configuration(), async resolve() { throw new Error('lookup must not execute') } } })
  expect(await reopened.getResult(handle)).toEqual(result)
  expect(await snapshot(workspacePath)).toEqual(before)
  expect(await readdir(workspacePath)).toEqual(['.beegame'])
}), 120_000)

test('format issues publish without any model/configuration calls', async () => fixture(async workspacePath => {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete\n'
  const billing = offlineReviewerBilling(ownerId)
  const api = createReviewerInitialLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: { ...configuration(), async resolve() { throw new Error('format pass must not execute') } } })
  const handle = await api.start(start(documents))
  const result = await until(() => api.getResult(handle), value => value.status === 'completed' && value.billingStatus === 'settled')
  if (result.status !== 'completed') throw new Error('not completed')
  expect(result.result.kind).toBe('issues_found')
  expect(result.result.issues[0]!.issue.reasonCode).toBe('DOCUMENT_FORMAT_INVALID')
  expect(billing.recorded.size).toBe(0)
}), 20_000)

test('request identity conflicts, foreign owner handles and private input fields are rejected', async () => fixture(async workspacePath => {
  const documents = reviewFixtureDocuments(); documents[0]!.content = '# incomplete\n'
  const billing = offlineReviewerBilling(ownerId)
  const api = createReviewerInitialLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: configuration() })
  const input = start(documents)
  const handle = await api.start(input)
  await until(() => api.getResult(handle), value => value.status === 'completed')
  const changed = structuredClone(input)
  changed.input.documents[0]!.content += 'changed'
  changed.inputDigest = reviewerInputDigest({ ownerId, projectId: changed.projectId, ...changed.input })
  await expect(api.start(changed)).rejects.toThrow('identity conflicts')
  await expect(api.start({ ...input, checkpoint: {} } as never)).rejects.toThrow()
  const foreign = createReviewerInitialLifecycle(workspacePath, { billing: offlineReviewerBilling('foreign').client, runtimeConfiguration: { ...configuration(), ownerId: 'foreign' } })
  await expect(foreign.getResult(handle)).rejects.toThrow('owner binding')
}), 20_000)

test('coarse stop at the fact->semantic boundary survives restart without seeding or executing semantic tasks', async () => fixture(async workspacePath => {
  const input = start()
  const registration = await createReviewerRegistrations(workspacePath, ownerId).register(input)
  const journal = await openReviewerFactJournal(journalInput(workspacePath, input))
  expect((await journal.read()).phase).toBe('facts_staged')
  const billing = offlineReviewerBilling(ownerId)
  let calls = 0
  const api = createReviewerInitialLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: { ...configuration(), async resolve() { calls++; return configuration().resolve() } } })
  expect((await api.stop({ handle: registration.handle, requestId: 'stop-boundary', reason: 'operator stopped' })).status).toBe('stopped')
  expect(await api.start(input)).toEqual(registration.handle)
  expect((await until(() => api.getResult(registration.handle), value => value.status === 'stopped')).status).toBe('stopped')
  expect((await journal.read()).semantic).toBeUndefined()
  expect(calls).toBe(0)
}))

test('an incomplete publication is not reconstructed by getResult and explicit resume completes it', async () => fixture(async workspacePath => {
  const documents = reviewFixtureDocuments(); documents[0]!.content = '# incomplete\n'
  const input = start(documents)
  const api = createReviewerInitialLifecycle(workspacePath, { billing: offlineReviewerBilling(ownerId).client, runtimeConfiguration: configuration() })
  const handle = await api.start(input)
  const complete = await until(() => api.getResult(handle), value => value.status === 'completed')
  if (complete.status !== 'completed') throw new Error('not completed')
  const journal = await openReviewerFactJournal({ ...journalInput(workspacePath, input), readOnly: true })
  await until(() => journal.leaseStatus(), value => value === 'free')
  const marker = join(workspacePath, '.beegame/workflow/foundation-reviewer/results', complete.result.resultId, 'COMMITTED.json')
  await unlink(marker)
  const before = await snapshot(workspacePath)
  const pending = await api.getResult(handle)
  expect(pending.status).toBe('needs_action')
  expect(await snapshot(workspacePath)).toEqual(before)
  expect(await api.start(input)).toEqual(handle)
  expect((await api.getResult(handle)).status).toBe('needs_action')
  await api.resume({ handle, requestId: 'finish-publication' })
  expect(await until(() => api.getResult(handle), value => value.status === 'completed')).toEqual(complete)
}), 20_000)
