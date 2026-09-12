import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openRevisionAttemptStore } from '../attempt-store'
import { getLatestRevisionRuntimeUsage, type RevisionUsageEvent } from '../native-usage'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

const roots: string[] = []
const documentPath = 'docs/GDD.md'

async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-attempt-usage-')))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildSingleReviewFixture({ documents,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  return { ownerId: 'owner', projectId: 'project', requestId: 'repair', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
}

function usage(type: RevisionUsageEvent['type'], prompt_tokens: number, completion_tokens: number,
  cache_read_tokens = 0, cache_creation_tokens = 0): RevisionUsageEvent {
  return { type, usage: { prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens,
    total_tokens: prompt_tokens + completion_tokens + cache_read_tokens + cache_creation_tokens } }
}

function completion(pid: number | null = 12345) {
  return { scope: 'direct-child' as const, pid, exitCode: 0, signalCode: null, stdoutDrained: true as const, termination: 'none' as const }
}

function completed(attemptId: string, usageEvents: RevisionUsageEvent[]) {
  return { status: 'completed' as const, attemptId, snapshot: { summary: 'Updated files', documents: reviewFixtureDocuments() },
    usageEvents, completion: completion() }
}

function journal(root: string, request: ReturnType<typeof fixture>) {
  return join(root, '.beegame/workflow/foundation-revision/native-file-v1/requests',
    revisionDigest({ ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId }),
    'execution-events')
}

async function eventFiles(root: string, request: ReturnType<typeof fixture>) {
  return (await readdir(journal(root, request))).filter(name => /^\d+\.json$/.test(name)).sort()
}

test('durably appends normalized usage, replays it, and keeps a reopened running attempt blocked', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin()
  const first = usage('result', 3, 2)
  await store.observeUsage({ attemptId: started.attemptId, observationIndex: 1, event: first })

  const reopened = await openRevisionAttemptStore(root, request)
  const state = await reopened.read()
  expect(state.status).toBe('running')
  expect(state.active?.attemptId).toBe(started.attemptId)
  expect(state.observedUsageEvents).toEqual([first])
  expect(state.observedUsage).toEqual(getLatestRevisionRuntimeUsage([first]))
  await expect(reopened.begin()).rejects.toThrow('explicit recovery')

  const captured = usage('usage', 7, 1)
  const expected = structuredClone(captured)
  const pending = reopened.observeUsage({ attemptId: started.attemptId, observationIndex: 2, event: captured })
  captured.usage.total_tokens = 999
  await pending
  expect((await reopened.read()).observedUsageEvents).toEqual([first, expected])
})

test('same observation index is idempotent concurrently, while different payloads conflict', async () => {
  const root = await workspace()
  const request = fixture()
  const stores = await Promise.all([openRevisionAttemptStore(root, request), openRevisionAttemptStore(root, request)])
  const started = await stores[0]!.begin()
  const event = usage('usage', 4, 1)
  const results = await Promise.allSettled(stores.map(store => store.observeUsage({ attemptId: started.attemptId, observationIndex: 1, event })))
  expect(results.every(result => result.status === 'fulfilled')).toBe(true)
  expect((await stores[0]!.read()).observedUsageEvents).toEqual([event])
  expect((await eventFiles(root, request))).toHaveLength(2)

  const conflict = usage('usage', 4, 2)
  await expect(stores[1]!.observeUsage({ attemptId: started.attemptId, observationIndex: 1, event: conflict })).rejects.toThrow()
  expect((await stores[0]!.read()).observedUsageEvents).toEqual([event])

  const conflictRoot = await workspace()
  const conflictRequest = fixture()
  const [left, right] = await Promise.all([openRevisionAttemptStore(conflictRoot, conflictRequest), openRevisionAttemptStore(conflictRoot, conflictRequest)])
  const conflictStarted = await left.begin()
  const concurrent = await Promise.allSettled([
    left.observeUsage({ attemptId: conflictStarted.attemptId, observationIndex: 1, event: usage('usage', 1, 1) }),
    right.observeUsage({ attemptId: conflictStarted.attemptId, observationIndex: 1, event: usage('usage', 1, 2) }),
  ])
  expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(concurrent.filter(result => result.status === 'rejected')).toHaveLength(1)
  expect((await left.read()).observedUsageEvents).toHaveLength(1)
})

test('rejects usage gaps, stale attempt identities, and observations after settlement', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin()
  const first = usage('usage', 1, 1)
  const second = usage('usage', 2, 1)
  await expect(store.observeUsage({ attemptId: started.attemptId, observationIndex: 2, event: second })).rejects.toThrow()
  await expect(store.observeUsage({ attemptId: randomUUID(), observationIndex: 1, event: first })).rejects.toThrow()
  await store.observeUsage({ attemptId: started.attemptId, observationIndex: 1, event: first })
  await store.settle(completed(started.attemptId, [first]))
  await expect(store.observeUsage({ attemptId: started.attemptId, observationIndex: 2, event: second })).rejects.toThrow()
})

test('settlement must equal persisted observations; terminal-only usage is never trusted', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin()
  const persisted = usage('result', 3, 2)
  const fabricated = usage('result', 9, 9)
  await expect(store.settle(completed(started.attemptId, [fabricated]))).rejects.toThrow()
  await store.observeUsage({ attemptId: started.attemptId, observationIndex: 1, event: persisted })
  await expect(store.settle(completed(started.attemptId, [fabricated]))).rejects.toThrow()
  expect((await store.read()).status).toBe('running')
  const receipt = await store.settle(completed(started.attemptId, [persisted]))
  expect(receipt.usage).toEqual(getLatestRevisionRuntimeUsage([persisted]))
})

test('empty pre-spawn cancellation has no fabricated usage observation', async () => {
  const store = await openRevisionAttemptStore(await workspace(), fixture())
  const started = await store.begin()
  const receipt = await store.settle({ status: 'stopped', attemptId: started.attemptId, failureCode: 'cancelled', usageEvents: [] })
  expect(receipt.usage).toEqual(getLatestRevisionRuntimeUsage([]))
})

test('persists cumulative-result and wire-reset semantics without retaining raw messages or credentials', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin()
  const events = [
    usage('result', 5, 3),
    usage('usage', 2, 1),
    usage('result', 1, 1),
    usage('usage', 4, 2),
  ]
  await expect(store.observeUsage({ attemptId: started.attemptId, observationIndex: 1,
    event: { ...events[0], rawMessage: 'raw native message', OPENAI_API_KEY: 'credential-sentinel' } })).rejects.toThrow()
  for (const [index, event] of events.entries())
    await store.observeUsage({ attemptId: started.attemptId, observationIndex: index + 1, event })
  const state = await store.read()
  expect(state.observedUsage).toEqual(getLatestRevisionRuntimeUsage(events))
  for (const name of await eventFiles(root, request)) {
    const bytes = await readFile(join(journal(root, request), name), 'utf8')
    expect(bytes).not.toContain('OPENAI_API_KEY')
    expect(bytes).not.toContain('credential-sentinel')
    expect(bytes).not.toContain('raw native message')
  }
})

test('aggregate overflow rejects the new observation before poisoning the durable journal', async () => {
  const store = await openRevisionAttemptStore(await workspace(), fixture())
  const started = await store.begin()
  const first = usage('result', Number.MAX_VALUE, 0)
  await store.observeUsage({ attemptId: started.attemptId, observationIndex: 1, event: first })
  await expect(store.observeUsage({ attemptId: started.attemptId, observationIndex: 2,
    event: usage('result', Number.MAX_VALUE / 2, 0) })).rejects.toThrow('overflow')
  expect((await store.read()).observedUsageEvents).toEqual([first])
})

test('rejects tampered usage records and missing journal links without self-healing', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin()
  await store.observeUsage({ attemptId: started.attemptId, observationIndex: 1, event: usage('usage', 3, 2) })
  await store.observeUsage({ attemptId: started.attemptId, observationIndex: 2, event: usage('usage', 4, 2) })
  const directory = journal(root, request)
  const names = await eventFiles(root, request)
  const usagePath = join(directory, names[1]!)
  const original = await readFile(usagePath, 'utf8')
  const tampered = JSON.parse(original) as Record<string, any>
  tampered.observation.event.usage.total_tokens += 1
  const tamperedBytes = `${revisionCanonicalJson(tampered)}\n`
  await writeFile(usagePath, tamperedBytes)
  await expect(store.read()).rejects.toThrow()
  expect(await readFile(usagePath, 'utf8')).toBe(tamperedBytes)

  await writeFile(usagePath, original)
  await unlink(join(directory, names[0]!))
  await expect(store.read()).rejects.toThrow(/gap|unexpected|contiguous/i)
})
