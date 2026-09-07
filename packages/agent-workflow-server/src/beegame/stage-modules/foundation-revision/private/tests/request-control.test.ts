import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, realpath, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRevisionAttemptStore } from '../attempt-store'
import { revisionDigest } from '../json-digest'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

const documents = ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'] as const
const roots: string[] = []

async function workspace() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'revision-request-control-')),
  )
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})

function requestFixture(count: 1 | 2 = 1) {
  const sourceDocuments = reviewFixtureDocuments()
  for (const documentPath of documents.slice(0, count)) {
    sourceDocuments.find(document => document.path === documentPath)!.content =
      `# incomplete ${documentPath}`
  }
  const sourceResult = buildReviewerPublishedResult({
    documents: sourceDocuments,
    state: initialReviewerFactState(sourceDocuments),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: {
      kind: 'initial',
      sourceResultId: 'author',
      sourceDocumentRevision: 'a'.repeat(64),
      confirmedBriefDigest: 'b'.repeat(64),
    },
  })
  return {
    kind: 'initial' as const,
    ownerId: 'owner',
    projectId: 'project',
    requestId: `request-control-${count}`,
    sourceResult,
    sourceBinding: {
      ownerId: 'owner',
      projectId: 'project',
      resultId: sourceResult.resultId,
      resultDigest: revisionDigest(sourceResult),
    },
  }
}

function requestRoot(root: string, request: ReturnType<typeof requestFixture>) {
  return join(
    root,
    '.beegame/workflow/foundation-revision/requests',
    revisionDigest({
      ownerId: request.ownerId,
      projectId: request.projectId,
      requestId: request.requestId,
    }),
  )
}

test('legacy per-document journals require explicit migration without modifying evidence', async () => {
  const root = await workspace()
  const request = requestFixture()
  await openRevisionAttemptStore(root, request)
  const legacy = join(requestRoot(root, request), 'attempts')
  await mkdir(legacy)
  const evidence = join(legacy, 'receipt.json')
  await writeFile(evidence, 'legacy evidence', { flag: 'wx' })
  await expect(openRevisionAttemptStore(root, request)).rejects.toThrow('explicit migration')
  expect(await readFile(evidence, 'utf8')).toBe('legacy evidence')
  expect(await readdir(join(requestRoot(root, request), 'execution-events'))).toEqual([])
})

function completion() {
  return {
    scope: 'direct-child' as const,
    pid: 4242,
    exitCode: 0,
    signalCode: null,
    stdoutDrained: true as const,
    termination: 'none' as const,
  }
}

test('idle continuation records its command without manufacturing a failure, and replay cannot alter an active attempt', async () => {
  const root = await workspace()
  const store = await openRevisionAttemptStore(root, requestFixture())
  expect(await store.resume({ requestId: 'continue-idle' })).toMatchObject({ phase: 'running', failure: null, eventCount: 1 })
  const started = await store.begin(documents[0])
  expect(await store.resume({ requestId: 'continue-idle' })).toMatchObject({ activeAttemptIds: [started.attemptId], eventCount: 2 })
  await expect(store.resume({ requestId: 'new-continue-while-active' })).rejects.toThrow('active attempt')
  expect((await store.readRequest()).eventCount).toBe(2)
})

test('the shared journal itself limits concurrent document claims to four', async () => {
  const root = await workspace()
  const sourceDocuments = reviewFixtureDocuments()
  const paths = sourceDocuments.slice(0, 5).map(document => document.path)
  for (const document of sourceDocuments.slice(0, 5)) document.content = '# incomplete'
  const sourceResult = buildReviewerPublishedResult({ documents: sourceDocuments, state: initialReviewerFactState(sourceDocuments),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  const request = { ...requestFixture(), sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
  const stores = await Promise.all(paths.map(() => openRevisionAttemptStore(root, request)))
  const outcomes = await Promise.allSettled(paths.map((path, index) => stores[index]!.begin(path)))
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(4)
  expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1)
  expect((await stores[0]!.readRequest()).activeAttemptIds).toHaveLength(4)
})

function repairedMarkdown(documentPath: string) {
  return reviewFixtureDocuments().find(
    document => document.path === documentPath,
  )!.content
}

function completed(attemptId: string, documentPath: string) {
  return {
    status: 'completed' as const,
    attemptId,
    markdown: repairedMarkdown(documentPath),
    usageEvents: [],
    completion: completion(),
  }
}

function retryable(attemptId: string) {
  return {
    status: 'retryable' as const,
    attemptId,
    failureCode: 'native_failed' as const,
    usageEvents: [],
    completion: completion(),
  }
}

test('stop-before-begin is durable, rejects dispatch, and resume admits a fresh attempt', async () => {
  const root = await workspace()
  const request = requestFixture()
  const store = await openRevisionAttemptStore(root, request)

  const stopped = await store.requestStop({
    requestId: 'stop-before-begin',
    reason: 'user_requested',
  })
  expect(stopped).toMatchObject({
    stopped: true,
    phase: 'stopped',
    activeAttemptIds: [],
    eventCount: 1,
  })
  await expect(store.begin(documents[0])).rejects.toThrow()
  expect(await store.readRequest()).toMatchObject({
    stopped: true,
    phase: 'stopped',
    activeAttemptIds: [],
    eventCount: 1,
  })

  const resumed = await store.resume({ requestId: 'resume-after-stop' })
  expect(resumed).toMatchObject({
    stopped: false,
    phase: 'running',
    activeAttemptIds: [],
    eventCount: 2,
  })
  const started = await store.begin(documents[0])
  expect(started.attemptId).toBeString()
})

test('begin-before-stop leaves the attempt active; resume rejects until settlement closes it', async () => {
  const root = await workspace()
  const request = requestFixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin(documents[0])

  const stopped = await store.requestStop({
    requestId: 'stop-running',
    reason: 'shutdown',
  })
  expect(stopped).toMatchObject({
    stopped: true,
    phase: 'stopped',
    activeAttemptIds: [started.attemptId],
    eventCount: 2,
  })
  await expect(store.begin(documents[0])).rejects.toThrow()
  await expect(
    store.resume({ requestId: 'resume-while-active' }),
  ).rejects.toThrow()

  const submitted = retryable(started.attemptId)
  const receipt = await store.settle(documents[0], submitted)
  expect(receipt.settlement.status).toBe('stopped')
  if (receipt.settlement.status !== 'stopped')
    throw new Error('expected stopped settlement')
  expect(receipt.settlement.failureCode).toBe('cancelled')
  expect(receipt.settlement.attemptId).toBe(started.attemptId)
  expect(receipt.settlement.completion).toEqual(submitted.completion)
  expect(await store.settle(documents[0], submitted)).toEqual(receipt)
})

test('two active documents share stop linearization and resume rejects any active attempt', async () => {
  const root = await workspace()
  const request = requestFixture(2)
  const store = await openRevisionAttemptStore(root, request)
  const first = await store.begin(documents[0])
  const second = await store.begin(documents[1])
  const stopped = await store.requestStop({
    requestId: 'stop-two-documents',
    reason: 'user_requested',
  })

  expect(stopped).toMatchObject({
    stopped: true,
    phase: 'stopped',
    activeAttemptIds: [first.attemptId, second.attemptId],
    eventCount: 3,
  })
  await expect(
    store.resume({ requestId: 'resume-too-early' }),
  ).rejects.toThrow()
  await store.settle(documents[0], retryable(first.attemptId))
  await store.settle(documents[1], retryable(second.attemptId))
  const resumed = await store.resume({ requestId: 'resume-two-documents' })
  expect(resumed).toMatchObject({
    stopped: false,
    phase: 'running',
    activeAttemptIds: [],
    eventCount: 6,
  })
})

test('stop and resume command IDs are global, idempotent for the same payload, and conflict on reuse', async () => {
  const root = await workspace()
  const request = requestFixture()
  const store = await openRevisionAttemptStore(root, request)

  const first = await store.requestStop({
    requestId: 'command-id',
    reason: 'user_requested',
  })
  expect(
    await store.requestStop({
      requestId: 'command-id',
      reason: 'user_requested',
    }),
  ).toEqual(first)
  await expect(
    store.requestStop({ requestId: 'command-id', reason: 'shutdown' }),
  ).rejects.toThrow(/conflict/i)
  await expect(store.resume({ requestId: 'command-id' })).rejects.toThrow(
    /conflict/i,
  )

  const resumed = await store.resume({ requestId: 'different-resume-id' })
  expect(resumed.phase).toBe('running')
  expect(await store.resume({ requestId: 'different-resume-id' })).toEqual(
    resumed,
  )
})

test('concurrent begins on different documents and stop produce one valid request-wide CAS journal', async () => {
  const root = await workspace()
  const request = requestFixture(2)
  const [left, right] = await Promise.all([
    openRevisionAttemptStore(root, request),
    openRevisionAttemptStore(root, request),
  ])
  const results = await Promise.allSettled([
    left.begin(documents[0]),
    right.begin(documents[1]),
    left.requestStop({ requestId: 'concurrent-stop', reason: 'shutdown' }),
  ])
  const starts = results
    .slice(0, 2)
    .filter(result => result.status === 'fulfilled')
  expect(results[2]!.status).toBe('fulfilled')

  const snapshot = await left.readRequest()
  expect(snapshot.phase).toBe('stopped')
  expect(snapshot.stopped).toBe(true)
  expect(snapshot.eventCount).toBe(starts.length + 1)
  expect(new Set(snapshot.activeAttemptIds)).toEqual(
    new Set(
      starts
        .filter(
          (
            result,
          ): result is PromiseFulfilledResult<
            Awaited<ReturnType<typeof left.begin>>
          > => result.status === 'fulfilled',
        )
        .map(result => result.value.attemptId),
    ),
  )

  const eventDirectory = join(requestRoot(root, request), 'execution-events')
  const names = (await readdir(eventDirectory)).sort()
  expect(names).toHaveLength(snapshot.eventCount)
  expect(names.every(name => /^\d{16}\.json$/.test(name))).toBe(true)
  expect(names.map(name => Number(name.slice(0, 16)))).toEqual(
    [...Array(snapshot.eventCount)].map((_, i) => i + 1),
  )
})

test('a completed receipt wins a later stop and exact late terminal replay remains completed', async () => {
  const root = await workspace()
  const request = requestFixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin(documents[0])
  const terminal = completed(started.attemptId, documents[0])
  const receipt = await store.settle(documents[0], terminal)
  const stopped = await store.requestStop({
    requestId: 'stop-after-completion',
    reason: 'user_requested',
  })

  expect(stopped).toMatchObject({
    stopped: true,
    phase: 'stopped',
    activeAttemptIds: [],
    eventCount: 3,
  })
  expect(await store.settle(documents[0], terminal)).toEqual(receipt)
  expect((await store.read(documents[0])).status).toBe('completed')
})

test('stop-vs-settle races linearize globally without leaving an invalid closed history', async () => {
  const root = await workspace()
  const request = requestFixture()
  const [settler, stopper] = await Promise.all([
    openRevisionAttemptStore(root, request),
    openRevisionAttemptStore(root, request),
  ])
  const started = await settler.begin(documents[0])
  const terminal = completed(started.attemptId, documents[0])
  const results = await Promise.allSettled([
    settler.settle(documents[0], terminal),
    stopper.requestStop({ requestId: 'race-stop', reason: 'user_requested' }),
  ])
  expect(results[0]!.status).toBe('fulfilled')
  expect(results[1]!.status).toBe('fulfilled')
  if (results[0]!.status !== 'fulfilled' || results[1]!.status !== 'fulfilled')
    throw new Error('stop and settle must both produce durable outcomes')

  const receipt = results[0]!.value
  const finalReceipt = await settler.read(documents[0])
  expect(finalReceipt.active).toBeNull()
  if (finalReceipt.status === 'completed') {
    expect(receipt.settlement.status).toBe('completed')
    expect(finalReceipt.completed?.settlement).toEqual(terminal)
  } else {
    expect(finalReceipt.status).toBe('stopped')
    if (receipt.settlement.status !== 'stopped')
      throw new Error('stop-winning settlement must be converted to stopped')
    expect(receipt.settlement.failureCode).toBe('cancelled')
    expect(receipt.settlement.completion).toEqual(terminal.completion)
  }
  expect((await settler.readRequest()).activeAttemptIds).toEqual([])
})

test('publication authorization seals the request; a stop after authorization is ignored', async () => {
  const root = await workspace()
  const request = requestFixture(2)
  const store = await openRevisionAttemptStore(root, request)
  for (const documentPath of documents) {
    const started = await store.begin(documentPath)
    await store.settle(documentPath, completed(started.attemptId, documentPath))
  }

  const prepared = await store.preparePublication()
  expect(prepared.candidate).toBeDefined()
  expect(prepared.receipts).toHaveLength(2)
  expect(prepared.authorizationDigest).toMatch(/^[a-f0-9]{64}$/)
  const publishing = await store.readRequest()
  expect(publishing).toMatchObject({
    stopped: false,
    phase: 'publishing',
    activeAttemptIds: [],
  })
  expect(publishing.eventCount).toBeGreaterThan(4)
  const stopAfterAuthorization = await store.requestStop({
    requestId: 'stop-after-authorization',
    reason: 'shutdown',
  })
  expect(stopAfterAuthorization).toMatchObject({
    stopped: false,
    phase: 'publishing',
    eventCount: publishing.eventCount + 1,
  })
  expect(
    await store.requestStop({
      requestId: 'stop-after-authorization',
      reason: 'shutdown',
    }),
  ).toEqual(stopAfterAuthorization)

  await store.markPublished(prepared.authorizationDigest)
  expect(await store.readRequest()).toMatchObject({
    stopped: false,
    phase: 'published',
    activeAttemptIds: [],
  })
  await expect(store.markPublished('0'.repeat(64))).rejects.toThrow()
})

test('publication requires every document completed and a request that has not stopped', async () => {
  const incompleteRoot = await workspace()
  const incompleteRequest = requestFixture(2)
  const incompleteStore = await openRevisionAttemptStore(
    incompleteRoot,
    incompleteRequest,
  )
  const started = await incompleteStore.begin(documents[0])
  await incompleteStore.settle(
    documents[0],
    completed(started.attemptId, documents[0]),
  )
  await expect(incompleteStore.preparePublication()).rejects.toThrow()

  const stoppedRoot = await workspace()
  const stoppedRequest = requestFixture(1)
  const stoppedStore = await openRevisionAttemptStore(
    stoppedRoot,
    stoppedRequest,
  )
  await stoppedStore.requestStop({
    requestId: 'stop-before-publication',
    reason: 'user_requested',
  })
  await expect(stoppedStore.preparePublication()).rejects.toThrow()
})

test('resume after a closed stopped attempt refunds attempt count and uses a fresh identity', async () => {
  const root = await workspace()
  const request = requestFixture()
  const store = await openRevisionAttemptStore(root, request)
  const first = await store.begin(documents[0])
  await store.requestStop({ requestId: 'stop-refund', reason: 'shutdown' })
  await store.settle(documents[0], retryable(first.attemptId))
  await store.resume({ requestId: 'resume-refund' })

  const second = await store.begin(documents[0])
  expect(second.attemptId).not.toBe(first.attemptId)
  expect(second.attempt).toBe(first.attempt)
})
