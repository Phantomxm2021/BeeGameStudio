import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRevisionAttemptStore } from '../attempt-store'
import { acceptRevisionRequest } from '../request-store'
import { publishRevisionCompletedCandidate } from '../completed-candidate'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

const documents = ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'] as const

function requestFixture() {
  const sourceDocuments = reviewFixtureDocuments()
  sourceDocuments[0]!.content = '# incomplete GDD'
  sourceDocuments[1]!.content = '# incomplete level'
  const sourceResult = buildSingleReviewFixture({
    documents: sourceDocuments,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) },
  })
  return {
    ownerId: 'owner',
    projectId: 'project',
    requestId: 'repair-completed-candidate',
    sourceResult,
    sourceBinding: {
      ownerId: sourceResult.ownerId,
      projectId: sourceResult.projectId,
      resultId: sourceResult.resultId,
      resultDigest: revisionDigest(sourceResult),
    },
  }
}

function requestKey(request: ReturnType<typeof requestFixture>) {
  return revisionDigest({ ownerId: request.ownerId, projectId: request.projectId, requestId: request.requestId })
}

function attemptPath(workspace: string, request: ReturnType<typeof requestFixture>, documentPath: string, sequence: number) {
  return join(workspace, '.beegame/workflow/foundation-revision/native-file-v1/requests', requestKey(request), 'execution-events',
    `${String(sequence).padStart(16, '0')}.json`)
}

function completed(attemptId: string) {
  return {
    status: 'completed' as const,
    attemptId,
    snapshot: { summary: 'Updated files', documents: reviewFixtureDocuments() },
    usageEvents: [],
    completion: { scope: 'direct-child' as const, pid: 12345, exitCode: 0, signalCode: null, stdoutDrained: true as const, termination: 'none' as const },
  }
}

async function workspace() {
  return realpath(await mkdtemp(join(tmpdir(), 'revision-completed-candidate-')))
}

async function settleStatus(root: string, request: ReturnType<typeof requestFixture>, status: 'running' | 'retryable' | 'stopped') {
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin()
  if (status === 'running') return
  await store.settle({
    status,
    attemptId: started.attemptId,
    ...(status === 'stopped' ? { failureCode: 'cancelled' as const } : { failureCode: 'native_failed' as const }),
    usageEvents: [],
  })
}

async function completeAll(root: string, request: ReturnType<typeof requestFixture>) {
  const store = await openRevisionAttemptStore(root, request)
  const started = await store.begin()
  await store.settle(completed(started.attemptId))
}

for (const allUnresolved of [false, true])
test(`completed unresolved assessments survive publication and replay (all=${allUnresolved})`, async () => {
  const root = await workspace(), request = requestFixture()
  try {
    const store = await openRevisionAttemptStore(root, request)
    const started = await store.begin()
    const settlement = completed(started.attemptId)
    settlement.snapshot.summary = 'Conflicting source requirements: retained for Reviewer.'
    settlement.snapshot.documents = request.sourceResult.documents.map(({ path, content }, index) =>
      ({ path, content: allUnresolved || index === 0 ? content : content + '\\nSupported change' }))
    await store.settle(settlement)
    const first = await publishRevisionCompletedCandidate(root, request)
    expect(first.result.revisionSummary).toBe(settlement.snapshot.summary)
    expect(first.result.documents[0]!.content).toBe(request.sourceResult.documents[0]!.content)
    if (allUnresolved) expect(first.result.documentSetDigest).toBe(request.sourceResult.documentSetDigest)
    expect(await publishRevisionCompletedCandidate(root, request)).toEqual(first)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('publishes only when the single document-set execution has completed', async () => {
  for (const status of ['pending', 'running', 'retryable', 'stopped'] as const) {
    const root = await workspace()
    try {
      const request = requestFixture()
      if (status !== 'pending') await settleStatus(root, request, status)
      await expect(publishRevisionCompletedCandidate(root, request)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }

})

test('replays the completed snapshot, preserves canonical files, and concurrent publication is idempotent', async () => {
  const root = await workspace()
  try {
    const request = requestFixture()
    await mkdir(join(root, 'docs'), { recursive: true })
    const canonical = new Map<string, string>()
    for (const { path: documentPath } of request.sourceResult.documents) {
      const path = join(root, documentPath)
      const bytes = `canonical-${documentPath}`
      canonical.set(path, bytes)
      await writeFile(path, bytes)
    }
    await completeAll(root, request)

    const [first, concurrent] = await Promise.all([
      publishRevisionCompletedCandidate(root, request),
      publishRevisionCompletedCandidate(root, request),
    ])
    expect(first).toEqual(concurrent)
    expect(first.result.candidateId).toBe((await acceptRevisionRequest(root, request)).record.candidateId)
    expect(first.result.documents.find(document => document.path === documents[0])!.content)
      .toBe(reviewFixtureDocuments().find(document => document.path === documents[0])!.content)
    expect(first.result.documents.find(document => document.path === documents[1])!.content)
      .toBe(reviewFixtureDocuments().find(document => document.path === documents[1])!.content)
    expect(await publishRevisionCompletedCandidate(root, request)).toEqual(first)
    for (const [path, bytes] of canonical) expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(await readFile(join(root, first.artifactPath), 'utf8')).toBe(`${revisionCanonicalJson(first.result)}\n`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('publication IO failure replays the same receipt-bound snapshot, without re-dispatch or replacement inputs', async () => {
  const root = await workspace()
  try {
    const request = requestFixture()
    await completeAll(root, request)
    const relativeRoot = `.beegame/workflow/foundation-revision/native-file-v1/requests/${requestKey(request)}`
    const blocker = join(root, '.beegame/workflow/foundation-revision/native-file-v1/results')
    await writeFile(blocker, 'owned publication blocker', { flag: 'wx' })
    await expect(publishRevisionCompletedCandidate(root, request)).rejects.toThrow()
    const sealedStore = await openRevisionAttemptStore(root, request)
    const snapshot = (await sealedStore.preparePublication()).candidate
    expect((await sealedStore.readRequest()).phase).toBe('publishing')
    await sealedStore.requestStop({ requestId: 'stop-after-seal', reason: 'user_requested' })
    expect(await sealedStore.readRequest()).toMatchObject({ phase: 'publishing', stopped: false })
    await unlink(blocker)
    const original = structuredClone(request)
    const pending = publishRevisionCompletedCandidate(root, request)
    request.sourceBinding.resultDigest = '0'.repeat(64)
    const published = await pending
    expect((await sealedStore.readRequest()).phase).toBe('published')
    expect(published.result).toEqual(snapshot)
    const store = await openRevisionAttemptStore(root, original)
    expect((await store.read()).eventCount).toBe(2)
    await expect(publishRevisionCompletedCandidate(root, { ...original, candidateDocuments: [] })).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects corrupted receipts and manifests without healing either immutable file', async () => {
  const receiptRoot = await workspace()
  try {
    const request = requestFixture()
    await completeAll(receiptRoot, request)
    const receiptPath = attemptPath(receiptRoot, request, documents[0], 2)
    const corruptedReceipt = '{"corrupt":true}\n'
    await writeFile(receiptPath, corruptedReceipt)
    await expect(publishRevisionCompletedCandidate(receiptRoot, request)).rejects.toThrow()
    expect(await readFile(receiptPath, 'utf8')).toBe(corruptedReceipt)
  } finally {
    await rm(receiptRoot, { recursive: true, force: true })
  }

  const manifestRoot = await workspace()
  try {
    const request = requestFixture()
    await completeAll(manifestRoot, request)
    const published = await publishRevisionCompletedCandidate(manifestRoot, request)
    const corruptedManifest = '{"corrupt":true}\n'
    await writeFile(join(manifestRoot, published.commitPath), corruptedManifest)
    await expect(publishRevisionCompletedCandidate(manifestRoot, request)).rejects.toThrow()
    expect(await readFile(join(manifestRoot, published.commitPath), 'utf8')).toBe(corruptedManifest)
  } finally {
    await rm(manifestRoot, { recursive: true, force: true })
  }
})
