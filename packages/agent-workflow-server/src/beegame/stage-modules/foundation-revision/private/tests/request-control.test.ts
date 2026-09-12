import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, realpath, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRevisionAttemptStore } from '../attempt-store'
import { revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

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
  const sourceResult = buildSingleReviewFixture({
    documents: sourceDocuments,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: {
      kind: 'initial',
      sourceResultId: 'author',
      sourceDocumentRevision: 'a'.repeat(64),
      confirmedBriefDigest: 'b'.repeat(64),
    },
  })
  return {
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
    '.beegame/workflow/foundation-revision/native-file-v1/requests',
    revisionDigest({
      ownerId: request.ownerId,
      projectId: request.projectId,
      requestId: request.requestId,
    }),
  )
}

test('new execution leaves historical storage untouched and does not replay it', async () => {
  const root = await workspace(), request = requestFixture()
  const legacy = join(root, '.beegame/workflow/foundation-revision/requests', revisionDigest({ ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId }), 'attempts')
  await mkdir(legacy, { recursive: true })
  const evidence = join(legacy, 'receipt.json')
  await writeFile(evidence, 'historic evidence')
  const store = await openRevisionAttemptStore(root, request)
  expect((await store.readRequest()).eventCount).toBe(0)
  expect(await readFile(evidence, 'utf8')).toBe('historic evidence')
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
  const started = await store.begin()
  expect(await store.resume({ requestId: 'continue-idle' })).toMatchObject({ activeAttemptId: started.attemptId, eventCount: 2 })
  await expect(store.resume({ requestId: 'new-continue-while-active' })).rejects.toThrow('active attempt')
  expect((await store.readRequest()).eventCount).toBe(2)
})

test('the shared journal allows exactly one execution for the entire document set', async () => {
  const root = await workspace()
  const sourceDocuments = reviewFixtureDocuments()
  const paths = sourceDocuments.slice(0, 5).map(document => document.path)
  for (const document of sourceDocuments.slice(0, 5)) document.content = '# incomplete'
  const sourceResult = buildSingleReviewFixture({ documents: sourceDocuments,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  const request = { ...requestFixture(), sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
  const stores = await Promise.all(paths.map(() => openRevisionAttemptStore(root, request)))
  const outcomes = await Promise.allSettled(paths.map((path, index) => stores[index]!.begin()))
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(4)
  expect((await stores[0]!.readRequest()).activeAttemptId).toBeString()
})

function repairedMarkdown(documentPath: string) {
  return reviewFixtureDocuments().find(
    document => document.path === documentPath,
  )!.content
}

function completed(attemptId: string) {
  return {
    status: 'completed' as const,
    attemptId,
    snapshot: { summary: 'Updated files', documents: reviewFixtureDocuments() },
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
    activeAttemptId: null,
    eventCount: 1,
  })
  await expect(store.begin()).rejects.toThrow()
  expect(await store.readRequest()).toMatchObject({
    stopped: true,
    phase: 'stopped',
    activeAttemptId: null,
    eventCount: 1,
  })

  const resumed = await store.resume({ requestId: 'resume-after-stop' })
  expect(resumed).toMatchObject({
    stopped: false,
    phase: 'running',
    activeAttemptId: null,
    eventCount: 2,
  })
  const started = await store.begin()
  expect(started.attemptId).toBeString()
})

test('begin-before-stop leaves the attempt active; resume rejects until settlement closes it', async () => {
  const root = await workspace()
  const request = requestFixture()
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin()

  const stopped = await store.requestStop({
    requestId: 'stop-running',
    reason: 'shutdown',
  })
  expect(stopped).toMatchObject({
    stopped: true,
    phase: 'stopped',
    activeAttemptId: started.attemptId,
    eventCount: 2,
  })
  await expect(store.begin()).rejects.toThrow()
  await expect(
    store.resume({ requestId: 'resume-while-active' }),
  ).rejects.toThrow()

  const submitted = retryable(started.attemptId)
  const receipt = await store.settle(submitted)
  expect(receipt.settlement.status).toBe('stopped')
  if (receipt.settlement.status !== 'stopped')
    throw new Error('expected stopped settlement')
  expect(receipt.settlement.failureCode).toBe('cancelled')
  expect(receipt.settlement.attemptId).toBe(started.attemptId)
  expect(receipt.settlement.completion).toEqual(submitted.completion)
  expect(await store.settle(submitted)).toEqual(receipt)
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

test('concurrent whole-set begins and stop produce one valid request-wide CAS journal', async () => {
  const root = await workspace()
  const request = requestFixture(2)
  const [left, right] = await Promise.all([
    openRevisionAttemptStore(root, request),
    openRevisionAttemptStore(root, request),
  ])
  const results = await Promise.allSettled([
    left.begin(),
    right.begin(),
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
  expect(new Set(snapshot.activeAttemptId ? [snapshot.activeAttemptId] : [])).toEqual(
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
  const started = await store.begin()
  const terminal = completed(started.attemptId)
  const receipt = await store.settle(terminal)
  const stopped = await store.requestStop({
    requestId: 'stop-after-completion',
    reason: 'user_requested',
  })

  expect(stopped).toMatchObject({
    stopped: true,
    phase: 'stopped',
    activeAttemptId: null,
    eventCount: 3,
  })
  expect(await store.settle(terminal)).toEqual(receipt)
  expect((await store.read()).status).toBe('completed')
})

test('stop-vs-settle races linearize globally without leaving an invalid closed history', async () => {
  const root = await workspace()
  const request = requestFixture()
  const [settler, stopper] = await Promise.all([
    openRevisionAttemptStore(root, request),
    openRevisionAttemptStore(root, request),
  ])
  const started = await settler.begin()
  const terminal = completed(started.attemptId)
  const results = await Promise.allSettled([
    settler.settle(terminal),
    stopper.requestStop({ requestId: 'race-stop', reason: 'user_requested' }),
  ])
  expect(results[0]!.status).toBe('fulfilled')
  expect(results[1]!.status).toBe('fulfilled')
  if (results[0]!.status !== 'fulfilled' || results[1]!.status !== 'fulfilled')
    throw new Error('stop and settle must both produce durable outcomes')

  const receipt = results[0]!.value
  const finalReceipt = await settler.read()
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
  expect((await settler.readRequest()).activeAttemptId).toBeNull()
})

test('publication authorization seals the request; a stop after authorization is ignored', async () => {
  const root = await workspace()
  const request = requestFixture(2)
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin()
  await store.settle(completed(started.attemptId))

  const prepared = await store.preparePublication()
  expect(prepared.candidate).toBeDefined()
  expect(prepared.receipt.settlement.status).toBe('completed')
  expect(prepared.authorizationDigest).toMatch(/^[a-f0-9]{64}$/)
  const publishing = await store.readRequest()
  expect(publishing).toMatchObject({
    stopped: false,
    phase: 'publishing',
    activeAttemptId: null,
  })
  expect(publishing.eventCount).toBe(3)
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
    activeAttemptId: null,
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
  const started = await incompleteStore.begin()
  await incompleteStore.settle(
    retryable(started.attemptId),
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
  const first = await store.begin()
  await store.requestStop({ requestId: 'stop-refund', reason: 'shutdown' })
  await store.settle(retryable(first.attemptId))
  await store.resume({ requestId: 'resume-refund' })

  const second = await store.begin()
  expect(second.attemptId).not.toBe(first.attemptId)
  expect(second.attempt).toBe(first.attempt)
})
