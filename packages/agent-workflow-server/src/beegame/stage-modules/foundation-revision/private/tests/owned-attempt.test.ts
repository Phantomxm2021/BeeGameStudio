import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, readdir, mkdir, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRevisionOwnedAttempt } from '../owned-attempt'
import { openRevisionAttemptStore } from '../attempt-store'
import { publishRevisionCompletedCandidate } from '../completed-candidate'
import { readRevisionPublishedCandidate } from '../candidate-publication'
import { revisionDigest } from '../json-digest'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { prepareReviewerFirstCandidate } from '../../../foundation-reviewer/private/candidate-handoff'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

const roots: string[] = []
async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-owned-attempt-')))
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
function configuration(mode = 'valid', body = reviewFixtureDocuments()[0]!.content) {
  return { command: [process.execPath, join(import.meta.dir, 'owned-attempt-fixture.ts'), mode, Buffer.from(body).toString('base64')],
    env: { OPENAI_API_KEY: 'offline-unused-secret-sentinel' } }
}

function metadataFixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = `---\ndocument_id: GDD\nversion: 1.0.0\nupdated_at: 2026-08-13T01:00:00.000Z\n---\n# incomplete`
  const sourceResult = buildReviewerPublishedResult({ documents, state: initialReviewerFactState(documents),
    identity: { ownerId: 'metadata-owner', projectId: 'metadata-project', requestId: 'metadata-review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  const body = `---\ndocument_id: GDD\nversion: 1.0.0\nupdated_at: 2026-08-13T01:00:00.000Z\n---\n${reviewFixtureDocuments()[0]!.content}`
  return {
    request: { kind: 'initial' as const, ownerId: sourceResult.ownerId, projectId: sourceResult.projectId,
      requestId: 'metadata-repair', sourceResult,
      sourceBinding: { ownerId: sourceResult.ownerId, projectId: sourceResult.projectId, resultId: sourceResult.resultId,
        resultDigest: revisionDigest(sourceResult) } },
    sourceResult, body,
  }
}

test('owns start, native closure, complete-body gate and durable receipt before callback; callback failure replays without spawn', async () => {
  const root = await workspace()
  const request = fixture()
  let callbacks = 0
  await expect(runRevisionOwnedAttempt(root, { request, documentPath, configuration: configuration() }, {
    async onCompleted(receipt) {
      callbacks += 1
      expect(receipt.settlement.status).toBe('completed')
      expect((await (await openRevisionAttemptStore(root, request)).read(documentPath)).status).toBe('completed')
      throw new Error('offline downstream failure')
    },
  })).rejects.toThrow('offline downstream')
  const replayed = await runRevisionOwnedAttempt(root, { request, documentPath,
    configuration: { command: ['/definitely/no-revision-child'], env: {} } }, {
    onCompleted(receipt) { callbacks += 1; (receipt.output as { markdown: string }).markdown = 'callback mutation' },
  })
  expect(callbacks).toBe(2)
  expect(replayed.output).toMatchObject({ markdown: reviewFixtureDocuments()[0]!.content.trim() })
  expect(replayed.usage).toMatchObject({ total_tokens: 8 })
  const state = await (await openRevisionAttemptStore(root, request)).read(documentPath)
  expect(state.attempt).toBe(1)
  expect(state.eventCount).toBe(5)
  const key = revisionDigest({ ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId })
  const directory = join(root, '.beegame/workflow/foundation-revision/requests', key, 'execution-events')
  for (const file of await readdir(directory)) {
    const bytes = await readFile(join(directory, file), 'utf8')
    expect(bytes).not.toContain('offline-unused-secret-sentinel')
    expect(bytes).not.toContain('owned-attempt-fixture.ts')
  }
})

test('invalid complete document and native error stay retryable with late usage; third attempt can complete', async () => {
  const root = await workspace()
  const request = fixture()
  const invalid = await runRevisionOwnedAttempt(root, { request, documentPath, configuration: configuration('valid', '# still invalid') })
  expect(invalid.settlement).toMatchObject({ status: 'retryable', failureCode: 'output_invalid',
    diagnostic: { stage: 'output_validation', reasonCode: 'validation_marker' } })
  expect(invalid.usage).toMatchObject({ total_tokens: 8 })
  expect((await (await openRevisionAttemptStore(root, request)).read(documentPath)).lastSettlement).toMatchObject({
    status: 'retryable', diagnostic: { stage: 'output_validation', reasonCode: 'validation_marker' },
  })
  const failed = await runRevisionOwnedAttempt(root, { request, documentPath, configuration: configuration('error') })
  expect(failed.settlement).toMatchObject({ status: 'retryable', failureCode: 'native_failed',
    diagnostic: { stage: 'native', reasonCode: 'revision_native_result_failed' } })
  expect(failed.usage).toMatchObject({ total_tokens: 8 })
  const success = await runRevisionOwnedAttempt(root, { request, documentPath, configuration: configuration() })
  expect(success.settlement.status).toBe('completed')
  expect((await (await openRevisionAttemptStore(root, request)).read(documentPath)).attempt).toBe(3)
})

test('pre-cancelled invocation refunds its attempt and can resume with a fresh identity', async () => {
  const root = await workspace()
  const request = fixture()
  const controller = new AbortController()
  controller.abort()
  const stopped = await runRevisionOwnedAttempt(root, { request, documentPath, configuration: configuration() }, { signal: controller.signal })
  expect(stopped.settlement.status).toBe('stopped')
  expect(stopped.usage).toMatchObject({ total_tokens: 0 })
  const store = await openRevisionAttemptStore(root, request)
  expect((await store.read(documentPath)).attempt).toBe(0)
  await store.resume({ requestId: 'resume-after-pre-cancel' })
  const resumed = await runRevisionOwnedAttempt(root, { request, documentPath, configuration: configuration() })
  expect(resumed.settlement.attemptId).not.toBe(stopped.settlement.attemptId)
  expect((await store.read(documentPath)).attempt).toBe(1)
})

test('reopened running journal refuses a second native dispatch', async () => {
  const root = await workspace()
  const request = fixture()
  const store = await openRevisionAttemptStore(root, request)
  await store.begin(documentPath)
  await expect(runRevisionOwnedAttempt(root, { request, documentPath, configuration: configuration() })).rejects.toThrow('explicit recovery')
  expect((await store.read(documentPath)).eventCount).toBe(1)
})

test('running cancellation waits for owned-child closure, saves observed usage and refunds attempt', async () => {
  const root = await workspace()
  const request = fixture()
  const ready = join(root, 'fixture-ready')
  const config = configuration('wait')
  config.command.push(ready)
  const controller = new AbortController()
  const running = runRevisionOwnedAttempt(root, { request, documentPath, configuration: config }, { signal: controller.signal })
  // Catch immediately even if setup fails while the bounded readiness wait runs.
  const observed = running.then(receipt => ({ receipt }), error => ({ error }))
  let readySeen = false
  try {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      try { readySeen = await readFile(ready, 'utf8') === 'ready'; if (readySeen) break }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  } finally { controller.abort() }
  const result = await observed
  if ('error' in result) throw result.error
  expect(readySeen).toBe(true)
  expect(result.receipt.settlement).toMatchObject({ status: 'stopped', failureCode: 'cancelled',
    completion: { scope: 'direct-child', stdoutDrained: true, termination: 'kill_requested' } })
  expect(result.receipt.usage).toMatchObject({ total_tokens: 3 })
  expect((await (await openRevisionAttemptStore(root, request)).read(documentPath)).attempt).toBe(0)
}, 10_000)

test('independent store stop reaches the owned child without an external abort signal', async () => {
  const root = await workspace()
  const request = fixture()
  const ready = join(root, 'remote-stop-ready')
  const config = configuration('wait')
  config.command.push(ready)
  const fallback = new AbortController()
  const pending = runRevisionOwnedAttempt(root, { request, documentPath, configuration: config }, {
    signal: fallback.signal,
  }).then(receipt => ({ receipt }), error => ({ error }))
  const timeout = setTimeout(() => fallback.abort(), 5000)
  try {
    let readySeen = false
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      try { readySeen = await readFile(ready, 'utf8') === 'ready'; if (readySeen) break }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(readySeen).toBe(true)
    const remote = await openRevisionAttemptStore(root, request)
    await remote.requestStop({ requestId: 'independent-stop', reason: 'user_requested' })
    expect((await remote.readRequest()).stopped).toBe(true)
    const outcome = await pending
    if ('error' in outcome) throw outcome.error
    expect(fallback.signal.aborted).toBe(false)
    expect(outcome.receipt.settlement).toMatchObject({ status: 'stopped', failureCode: 'cancelled',
      completion: { scope: 'direct-child', stdoutDrained: true, termination: 'kill_requested' } })
    expect(outcome.receipt.usage).toMatchObject({ total_tokens: 3 })
    expect((await remote.readRequest()).activeAttemptIds).toEqual([])
    expect((await remote.read(documentPath)).attempt).toBe(0)
    await remote.resume({ requestId: 'independent-resume' })
    const resumed = await runRevisionOwnedAttempt(root, { request, documentPath, configuration: configuration() })
    expect(resumed.settlement.status).toBe('completed')
    expect(resumed.settlement.attemptId).not.toBe(outcome.receipt.settlement.attemptId)
  } finally {
    clearTimeout(timeout)
    fallback.abort()
    await pending
  }
}, 10_000)

test('offline native completion drives a self-contained candidate solely through its durable receipt', async () => {
  const root = await workspace()
  const request = fixture()
  const receipt = await runRevisionOwnedAttempt(root, { request, documentPath, configuration: configuration() })
  const published = await publishRevisionCompletedCandidate(root, request)
  expect(published.result.kind).toBe('candidate_ready')
  expect(published.result).not.toHaveProperty('verdict')
  expect(published.result.documents[0]!.content).toBe((receipt.output as { markdown: string }).markdown)
  expect(await readRevisionPublishedCandidate(root, published.result)).toEqual(published.result)
  expect(await publishRevisionCompletedCandidate(root, request)).toEqual(published)
})

test('owned native execution seals attempt timestamp metadata and remains Reviewer-bindable', async () => {
  const root = await workspace()
  const value = metadataFixture()
  const receipt = await runRevisionOwnedAttempt(root, {
    request: value.request, documentPath, configuration: configuration('valid', value.body),
  })
  const requestKey = revisionDigest({ ownerId: value.request.ownerId, projectId: value.request.projectId, requestId: value.request.requestId })
  const started = JSON.parse(await readFile(join(root, '.beegame/workflow/foundation-revision/requests', requestKey,
    'execution-events', '0000000000000001.json'), 'utf8')) as { startedAt: number }
  const output = receipt.output as { markdown: string }
  expect(output.markdown).toContain(`updated_at: ${new Date(started.startedAt).toISOString()}`)
  expect(output.markdown).toContain('version: 1.0.1')
  const published = await publishRevisionCompletedCandidate(root, value.request)
  const candidateBinding = { ownerId: published.result.ownerId, projectId: published.result.projectId,
    resultId: published.result.resultId, resultDigest: revisionDigest(published.result) }
  expect(prepareReviewerFirstCandidate({ sourceResult: value.sourceResult,
    sourceBinding: value.request.sourceBinding, candidateResult: published.result, candidateBinding }).candidate).toEqual(published.result)
})

test('usage persistence failure drains the child but cannot settle or publish a guessed zero total', async () => {
  const root = await workspace()
  const request = fixture()
  const controller = new AbortController()
  const ready = join(root, 'fixture-ready')
  const release = join(root, 'fixture-release')
  const config = configuration('barrier')
  config.command.push(ready, release)
  let callbacks = 0
  const pending = runRevisionOwnedAttempt(root, { request, documentPath, configuration: config }, {
    signal: controller.signal, onCompleted() { callbacks += 1 },
  }).then(receipt => ({ receipt }), error => ({ error }))
  const key = revisionDigest({ ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId })
  const blocker = join(root, '.beegame/workflow/foundation-revision/requests', key, 'execution-events', '0000000000000002.json')
  try {
    let readySeen = false
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      try { readySeen = await readFile(ready, 'utf8') === 'ready'; if (readySeen) break }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(readySeen).toBe(true)
    await mkdir(blocker)
    await writeFile(release, 'go', { flag: 'wx' })
    const outcome = await pending
    expect('error' in outcome ? String(outcome.error) : '').toContain('usage persistence failed')
    expect(callbacks).toBe(0)
  } finally {
    controller.abort()
    await pending
    try { await rmdir(blocker) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const store = await openRevisionAttemptStore(root, request)
  expect((await store.read(documentPath)).status).toBe('running')
  expect((await store.read(documentPath)).lastReceipt).toBeNull()
  await expect(store.begin(documentPath)).rejects.toThrow('explicit recovery')
  await expect(publishRevisionCompletedCandidate(root, request)).rejects.toThrow('completed receipts')
}, 10_000)
