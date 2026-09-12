import { expect, test } from 'bun:test'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import type { ReviewerResult, ReviewerStartInput, ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import fixtures from '../stage-modules/foundation-revision/private/tests/fixtures/public-initial-inputs.json'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'
import { deliveryRunSchema } from './schema'
import { createFoundationReviewLink } from './foundation-review-link'
import { projectWorkflowCurrentMessage } from './workflow-display-message'
import { readCurrentProjectArtifact } from '../project-artifact-store'
import { createFoundationInitialReviewRequest, foundationPublicDigest, foundationResultBinding } from './foundation-public-handoff'
import { createFoundationReviewer } from '../stage-modules/foundation-reviewer/public'
import { createFoundationRevision } from '../stage-modules/foundation-revision/public'
import { reviewFixtureDocuments } from '../stage-modules/foundation-revision/private/tests/single-review-fixture'
import { buildSingleReviewResult } from '../stage-modules/foundation-reviewer/private/single-agent-publication'
import { offlineReviewerBilling } from '../stage-modules/foundation-reviewer/private/test-fixtures/offline-billing'
import { createDeliveryWorkflowController } from './controller'
import type { FoundationCandidateResult } from './foundation-public-handoff'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
async function fixture() {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'public-foundation-link-')))
  const documents = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => {
    const content = `# offline ${path}\n`
    const artifactPath = `exports/${path}`
    await mkdir(dirname(join(workspacePath, artifactPath)), { recursive: true })
    await writeFile(join(workspacePath, artifactPath), content)
    await mkdir(dirname(join(workspacePath, path)), { recursive: true })
    await writeFile(join(workspacePath, path), content)
    return { path, artifactPath, digest: digest(content), byteLength: Buffer.byteLength(content) }
  }))
  const ownerId = fixtures.infrastructure.start.ownerId
  const projectId = fixtures.infrastructure.start.projectId
  const initial = createInitialDeliveryRun({ ownerId, projectId, confirmedBriefContext: 'offline', confirmedBriefDigest: digest('offline') })
  const run: DeliveryRun = { ...initial, phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW', status: 'needs_action',
    authorStage: { protocolVersion: 1, requestId: 'author', inputDigest: digest('input'), status: 'completed',
      handle: { protocolVersion: 1, producer: 'foundation-authoring', id: randomUUID() },
      control: { sequence: 0, requestId: 'author', action: 'run' },
      result: { protocolVersion: 1, producer: 'foundation-authoring', kind: 'foundation_documents', ownerId, projectId,
        inputDigest: digest('input'), confirmedBriefDigest: initial.confirmedBriefDigest, resultId: digest('result'),
        receiptSetDigest: digest('receipts'), documentRevision: digest('documents'), workspaceRevision: digest('workspace'), documents } } }
  const store = createRunStore(workspacePath, ownerId)
  await store.commit(run, { runId: run.runId, type: 'run.created', phase: run.phase, status: run.status, revision: run.revision })
  const handle = { protocolVersion: 1 as const, producer: 'foundation-reviewer' as const, id: randomUUID() }
  const starts: ReviewerStartInput[] = []; const controls: string[] = []
  let outcome: ReviewerResult = { status: 'running', handle, billingStatus: 'settled' }
  let startError = false; let observeError = false
  let stopHook: (() => void) | undefined
  const reviewer: ReturnType<typeof createFoundationReviewer> = {
    async start(request) { starts.push(structuredClone(request)); if (startError) throw new Error('lost start'); return handle },
    async getResult() { if (observeError) throw new Error('lost observation'); return structuredClone(outcome) },
    async resume(request) { controls.push(request.requestId); return structuredClone(outcome) },
    async stop(request) { controls.push(request.requestId); outcome = { status: 'stopped', handle, billingStatus: 'settled' }; stopHook?.(); return outcome },
  }
  const revision: ReturnType<typeof createFoundationRevision> = {
    async start() { throw new Error('unexpected revision start') }, async resume() { throw new Error('unexpected revision resume') },
    async stop() { throw new Error('unexpected revision stop') }, async getResult() { throw new Error('unexpected revision observation') },
  }
  const link = createFoundationReviewLink({ workspacePath, store, reviewer, revision, pollIntervalMs: 60_000 })
  function complete(kind: 'passed' | 'issues_found', billingStatus: 'pending' | 'settled' = 'settled', protocolVersion: 3 = 3) {
    const request = starts.at(-1)!
    const document = request.input.documents[0]!
    const result = buildSingleReviewResult(request, { status: 'completed', summary: 'Offline review',
      findings: kind === 'passed' ? [] : [{
        severity: 'HIGH', title: 'Complete document', actual: 'Incomplete fixture', expected: 'Complete document',
        documentPath: document.path,
      }] })
    expect(result.protocolVersion).toBe(protocolVersion)
    outcome = { status: 'completed', handle, billingStatus, result }
  }
  return { workspacePath, run, store, link, starts, controls, reviewer, revision, handle, complete,
    set startError(value: boolean) { startError = value }, set observeError(value: boolean) { observeError = value },
    set stopHook(value: () => void) { stopHook = value },
    set outcome(value: ReviewerResult) { outcome = value } }
}

test('native stage progress survives workflow observation and display projection', async () => {
  const f = await fixture()
  try {
    const running = await f.link.ensureProgress(f.run)
    f.outcome = { status: 'running', handle: f.handle, billingStatus: 'settled',
      progress: { modelResponses: 6, message: '正在接收模型响应（流事件 123）' } }
    const observed = await f.link.ensureProgress(running)
    expect(projectWorkflowCurrentMessage({ value: observed.currentMessage,
      phase: observed.phase, documentStep: observed.documentStep }))
      .toBe('模型响应 6 · 正在接收模型响应（流事件 123）')
  } finally { f.link.dispose() }
})

for (const kind of ['passed', 'issues_found'] as const)
test(`reviewer-only ${kind} waits for settlement then stops durably without any successor`, async () => {
  const f = await fixture()
  let restored: ReturnType<typeof createFoundationReviewLink> | undefined
  try {
    const before = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(path => readFile(join(f.workspacePath, path), 'utf8')))
    const running = await f.link.ensureProgress(f.run)
    running.foundationReviewStage!.stopAfterReview = true
    await f.store.commit(running, { runId: running.runId, type: 'test.review.only.policy',
      phase: running.phase, status: running.status, revision: running.revision })
    f.complete(kind, 'pending')
    const pending = await f.link.ensureProgress(running)
    expect(pending.status).toBe('running')
    expect(pending.foundationReviewStage!.reviewOnlyComplete).toBeUndefined()
    expect(pending.foundationReviewStage!.invocation.stage).toBe('reviewer')
    f.complete(kind)
    const stopped = await f.link.ensureProgress(pending)
    expect(stopped.status).toBe('stopped')
    expect(stopped.phase).toBe('DOCUMENT_REVIEW')
    expect(stopped.blockedReason).toContain('Reviewer-only run completed')
    const state = stopped.foundationReviewStage!
    expect(state).toMatchObject({ stopAfterReview: true, reviewOnlyComplete: true, sequence: 0,
      invocation: { stage: 'reviewer', outcome: { status: 'completed', billingStatus: 'settled', result: { kind } } } })
    expect(state.acceptedReview).toBeUndefined()
    expect(state.sourceReview).toBeUndefined()
    expect(state.candidate).toBeUndefined()
    expect(deliveryRunSchema.safeParse(stopped).success).toBe(true)
    for (const change of [
      { stopAfterReview: false }, { sequence: 1 },
      { invocation: { ...state.invocation, outcome: { ...state.invocation.outcome, billingStatus: 'pending' } } },
      { invocation: { ...state.invocation, outcome: { status: 'running', handle: f.handle, billingStatus: 'settled' } } },
    ]) expect(deliveryRunSchema.safeParse({ ...stopped, foundationReviewStage: { ...state, ...change } }).success).toBe(false)
    f.link.dispose()
    restored = createFoundationReviewLink({ workspacePath: f.workspacePath, store: f.store,
      reviewer: f.reviewer, revision: f.revision, pollIntervalMs: 60_000 })
    const reloaded = await f.store.load()
    expect((await restored.resume(reloaded!)).foundationReviewStage).toEqual(state)
    expect((await restored.stop(reloaded!, 'duplicate stop')).foundationReviewStage).toEqual(state)
    expect((await restored.ensureProgress(reloaded!)).foundationReviewStage).toEqual(state)
    expect(f.starts).toHaveLength(1)
    expect(f.controls).toHaveLength(0)
    expect(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(path => readFile(join(f.workspacePath, path), 'utf8')))).toEqual(before)
  } finally { f.link.dispose(); restored?.dispose() }
})

for (const summary of ['No supported change was needed; review the original finding.', 'The finding needs independent re-evaluation.'])
test('unchanged candidate files and summary return to Reviewer, including after reload: ' + summary, async () => {
  const f = await fixture()
  let restored: ReturnType<typeof createFoundationReviewLink> | undefined
  let revisionStarts = 0
  try {
    await f.link.ensureProgress(f.run)
    f.complete('issues_found')
    const repairing = await f.link.ensureProgress(f.run), link = repairing.foundationReviewStage!
    if (link.invocation.stage !== 'revision' || !link.sourceReview) throw new Error('Missing repair request')
    const request = link.invocation.request, source = link.sourceReview
    const body = { protocolVersion: 2 as const, producer: 'foundation-revision' as const, kind: 'candidate_ready' as const,
      ownerId: source.ownerId, projectId: source.projectId, requestId: request.requestId,
      candidateId: randomUUID(), round: 1, baseDocumentSetDigest: source.documentSetDigest,
      sourceReviewResultId: source.resultId, sourceReviewResultDigest: foundationPublicDigest(source),
      documentSetDigest: source.documentSetDigest, documents: source.documents, revisionSummary: summary }
    const result: FoundationCandidateResult = { ...body, resultId: foundationPublicDigest(body) }
    const handle = { protocolVersion: 1 as const, producer: 'foundation-revision' as const, id: randomUUID() }
    const revision = { ...f.revision, async start() { revisionStarts++; return handle },
      async getResult() { return { status: 'completed' as const, handle, inputDigest: request.inputDigest, billingStatus: 'settled' as const, result } } }
    f.link.dispose()
    restored = createFoundationReviewLink({ workspacePath: f.workspacePath, store: f.store, reviewer: f.reviewer, revision, pollIntervalMs: 60_000 })
    const next = await restored.ensureProgress(repairing), state = next.foundationReviewStage!
    expect(state.convergenceStop).toBeUndefined()
    expect(state.candidate).toEqual(result)
    expect(state.acceptedReview).toBeUndefined()
    expect(state.invocation.stage).toBe('reviewer')
    if (state.invocation.stage !== 'reviewer') throw new Error('Missing re-review')
    expect(state.invocation.request.input.comparison?.reviewEvidence?.revisionSummary).toBe(summary)
    expect(deliveryRunSchema.safeParse(next).success).toBe(true)
    for (const doc of source.documents) expect(await readFile(join(f.workspacePath, doc.path), 'utf8')).toBe(doc.content)
    restored.dispose()
    restored = createFoundationReviewLink({ workspacePath: f.workspacePath, store: f.store, reviewer: f.reviewer, revision, pollIntervalMs: 60_000 })
    f.outcome = { status: 'running', handle: f.handle, billingStatus: 'settled' }
    await restored.ensureProgress(next)
    f.complete('passed')
    expect((await restored.ensureProgress(next)).foundationReviewStage!.acceptedReview?.kind).toBe('passed')
    expect(revisionStarts).toBe(1)
  } finally { f.link.dispose(); restored?.dispose() }
})

test('repair budget stop survives reload and ordinary resume without dispatch', async () => {
  const f = await fixture()
  let restored: ReturnType<typeof createFoundationReviewLink> | undefined
  try {
    const running = await f.link.ensureProgress(f.run)
    running.foundationReviewStage!.sequence = 12
    // Recovery fixture for a pre-convergence persisted task.
    delete running.foundationReviewStage!.policyVersion
    delete running.foundationReviewStage!.automaticRepairLimit
    delete running.foundationReviewStage!.completedRepairCount
    await f.store.commit(running, { runId: running.runId, type: 'test.legacy.sequence',
      phase: running.phase, status: running.status, revision: running.revision })
    f.complete('issues_found')
    const stopped = await f.link.ensureProgress(f.run)
    expect(stopped.status).toBe('needs_action')
    expect(stopped.foundationReviewStage!.convergenceStop).toBe('repair_budget_exhausted')
    expect(stopped.foundationReviewStage!.acceptedReview).toBeUndefined()
    expect(deliveryRunSchema.safeParse(stopped).success).toBe(true)
    f.link.dispose()
    restored = createFoundationReviewLink({ workspacePath: f.workspacePath, store: f.store,
      reviewer: f.reviewer, revision: f.revision, pollIntervalMs: 60_000 })
    expect((await restored.resume(stopped)).foundationReviewStage).toEqual(stopped.foundationReviewStage)
    expect((await restored.ensureProgress(stopped)).foundationReviewStage).toEqual(stopped.foundationReviewStage)
    expect(f.starts).toHaveLength(1)
    expect(f.controls).toHaveLength(0)
  } finally { f.link.dispose(); restored?.dispose() }
})

for (const protocolVersion of [3] as const)
test(`Reviewer v${protocolVersion} revision handoff passes schema without admitting missing or mixed legacy execution`, async () => {
  const f = await fixture()
  try {
    await f.link.ensureProgress(f.run); f.complete('issues_found', 'settled', protocolVersion)
    const next = await f.link.ensureProgress(f.run)
    expect(next.phase).toBe('FOUNDATION_REVISION')
    expect(next.foundationReviewStage!.sourceReview!.protocolVersion).toBe(protocolVersion)
    expect(next.foundationAuditState).toBeUndefined()
    expect(deliveryRunSchema.safeParse(next).success).toBe(true)
    expect(deliveryRunSchema.safeParse({ ...next, foundationReviewStage: undefined }).success).toBe(false)
    expect(deliveryRunSchema.safeParse({ ...next, documentStep: 'FOUNDATION_REVIEW' }).success).toBe(false)
    const foreign = structuredClone(next)
    foreign.foundationReviewStage!.invocation.request.ownerId = 'foreign'
    expect(deliveryRunSchema.safeParse(foreign).success).toBe(false)
  } finally { f.link.dispose() }
})

test('result bindings preserve identity and digest checks and reject unsupported producer versions', () => {
  const source = structuredClone(fixtures.infrastructure.start.input.sourceResult)
  const identity = { ownerId: source.ownerId, projectId: source.projectId }
  const signed = (change: Record<string, unknown>) => {
    const { resultId: _, ...body } = { ...source, ...change }
    return { ...body, resultId: foundationPublicDigest(body) } as unknown as ReviewerReviewResult
  }
  for (const protocolVersion of [3]) {
    const value = signed({ protocolVersion })
    expect(foundationResultBinding(identity, value).resultId).toBe(value.resultId)
    expect(() => foundationResultBinding({ ...identity, ownerId: 'foreign' }, value)).toThrow('owner or project')
    expect(() => foundationResultBinding({ ...identity, projectId: 'foreign' }, value)).toThrow('owner or project')
    expect(() => foundationResultBinding(identity, { ...value, requestId: 'tampered' })).toThrow('digest mismatch')
  }
  for (const change of [
    { protocolVersion: 0 }, { protocolVersion: 1 }, { protocolVersion: 2 },
    { producer: 'foundation-revision', protocolVersion: 1 },
    { producer: 'foreign', protocolVersion: 1 },
  ]) expect(() => foundationResultBinding(identity, signed(change))).toThrow('producer or protocol version')
})

for (const protocolVersion of [3] as const)
test(`settled Reviewer v${protocolVersion} pass reaches a durable Checklist stop; repeated observation is idempotent`, async () => {
  const f = await fixture()
  try {
    await f.link.ensureProgress(f.run); f.complete('passed', 'pending', protocolVersion)
    expect((await f.link.ensureProgress(f.run)).foundationReviewStage!.acceptedReview).toBeUndefined()
    f.complete('passed', 'settled', protocolVersion)
    const accepted = await f.link.ensureProgress(f.run)
    expect(accepted.status).toBe('needs_action')
    expect(accepted.documentStep).toBe('FOUNDATION_REVIEW')
    expect(accepted.foundationReviewStage!.acceptedReview!.kind).toBe('passed')
    expect(accepted.revision.document).toBe(accepted.foundationReviewStage!.acceptedReview!.documentSetDigest)
    expect(await readCurrentProjectArtifact(f.workspacePath, CANONICAL_FOUNDATION_DOCUMENTS[0])).toBe(`# offline ${CANONICAL_FOUNDATION_DOCUMENTS[0]}\n`)
    expect(await readFile(join(f.workspacePath, CANONICAL_FOUNDATION_DOCUMENTS[0]), 'utf8')).toBe(`# offline ${CANONICAL_FOUNDATION_DOCUMENTS[0]}\n`)
    await f.link.ensureProgress(f.run)
    expect(f.starts).toHaveLength(1)
  } finally { f.link.dispose() }
})

test('canonical baseline conflict does not acknowledge an accepted Reviewer pass', async () => {
  const f = await fixture()
  try {
    await f.link.ensureProgress(f.run)
    await writeFile(join(f.workspacePath, CANONICAL_FOUNDATION_DOCUMENTS[0]), '# changed before publish\n')
    f.complete('passed')
    await expect(f.link.ensureProgress(f.run)).rejects.toThrow()
    const current = (await f.store.load())!
    expect(current.foundationReviewStage!.acceptedReview).toBeUndefined()
    expect(current.foundationReviewStage!.observationError).toBe(true)
    expect(await readFile(join(f.workspacePath, CANONICAL_FOUNDATION_DOCUMENTS[0]), 'utf8')).toBe('# changed before publish\n')
  } finally { f.link.dispose() }
})

test('needs_action and failed observation never launch a successor or implicitly resume', async () => {
  const f = await fixture()
  try {
    await f.link.ensureProgress(f.run)
    f.outcome = { status: 'needs_action', handle: f.handle, billingStatus: 'settled', reason: 'owner close unknown', resumable: true }
    expect((await f.link.ensureProgress(f.run)).status).toBe('needs_action')
    expect(f.controls).toHaveLength(0)
    f.observeError = true
    await expect(f.link.ensureProgress(f.run)).rejects.toThrow('lost observation')
    f.observeError = false; f.complete('passed')
    expect((await f.link.ensureProgress(f.run)).foundationReviewStage!.acceptedReview).toBeUndefined()
    expect((await f.link.resume(f.run)).foundationReviewStage!.acceptedReview).toBeDefined()
    expect(f.controls).toHaveLength(1)
  } finally { f.link.dispose() }
})

test('publication before a lost orchestration commit replays without another stage start', async () => {
  const f = await fixture()
  try {
    await f.link.ensureProgress(f.run); f.complete('passed')
    const commit = f.store.commit.bind(f.store)
    let fail = true
    f.store.commit = async (...args: Parameters<typeof commit>) => {
      if (fail && args[1].type === 'foundation.public_review.handoff') {
        fail = false
        throw new Error('lost acknowledgment after artifact publication')
      }
      return commit(...args)
    }
    await expect(f.link.ensureProgress(f.run)).rejects.toThrow('lost acknowledgment')
    const pending = (await f.store.load())!
    expect(pending.foundationReviewStage!.acceptedReview).toBeUndefined()
    const content = await readCurrentProjectArtifact(f.workspacePath, CANONICAL_FOUNDATION_DOCUMENTS[0])
    expect(content).toBe(`# offline ${CANONICAL_FOUNDATION_DOCUMENTS[0]}\n`)
    const accepted = await f.link.resume(pending)
    expect(accepted.foundationReviewStage!.acceptedReview!.kind).toBe('passed')
    expect(await readCurrentProjectArtifact(f.workspacePath, CANONICAL_FOUNDATION_DOCUMENTS[0])).toBe(content)
    expect(f.starts).toHaveLength(1)
  } finally { f.link.dispose() }
})

test('stop continues observing owned cleanup and pending settlement without resume or successor', async () => {
  const f = await fixture()
  f.link.dispose()
  let stopping = false, observations = 0, resumes = 0
  const link = createFoundationReviewLink({ workspacePath: f.workspacePath, store: f.store,
    revision: f.revision, pollIntervalMs: 5, reviewer: { ...f.reviewer,
      async resume(request) { resumes++; return f.reviewer.resume(request) },
      async stop() { stopping = true; return { status: 'running', handle: f.handle, billingStatus: 'pending' } },
      async getResult() {
        if (!stopping) return f.reviewer.getResult(f.handle)
        observations++
        return { status: observations < 3 ? 'running' : 'stopped', handle: f.handle,
          billingStatus: observations < 5 ? 'pending' : 'settled' }
      },
    } })
  try {
    const running = await link.ensureProgress(f.run)
    await link.stop(running, 'user requested')
    const deadline = Date.now() + 2000
    while (observations < 5 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    const final = (await f.store.load())!
    expect(final.status).toBe('stopped')
    expect(final.foundationReviewStage!.invocation.outcome!.billingStatus).toBe('settled')
    expect(f.starts).toHaveLength(1)
    expect(resumes).toBe(0)
    expect(final.foundationReviewStage!.sequence).toBe(0)
  } finally { link.dispose() }
})

test('stop before handoff prevents start until explicit resume', async () => {
  const f = await fixture()
  try {
    expect((await f.link.stop(f.run, 'stop')).status).toBe('stopped')
    await f.link.ensureProgress(f.run); expect(f.starts).toHaveLength(0)
    await f.link.resume(f.run); expect(f.starts).toHaveLength(1)
  } finally { f.link.dispose() }
})

test('ambiguous start does not acknowledge stop without a known handle', async () => {
  const f = await fixture()
  try {
    f.startError = true
    await expect(f.link.ensureProgress(f.run)).rejects.toThrow('lost start')
    const stopped = await f.link.stop(f.run, 'stop')
    expect(stopped.status).toBe('needs_action')
    expect(f.starts).toHaveLength(1)
    f.startError = false
    await f.link.resume(f.run)
    expect(f.starts).toHaveLength(2)
    expect(f.starts[1]).toEqual(f.starts[0])
  } finally { f.link.dispose() }
})

test('completion racing stop is retained without handoff, repeated stop reuses control identity', async () => {
  const f = await fixture()
  try {
    await f.link.ensureProgress(f.run)
    f.stopHook = () => f.complete('issues_found')
    const first = await f.link.stop(f.run, 'stop')
    expect(first.foundationReviewStage!.invocation.stage).toBe('reviewer')
    expect(first.foundationReviewStage!.invocation.outcome!.status).toBe('completed')
    expect(first.status).toBe('needs_action')
    const repeated = await f.link.stop(f.run, 'stop')
    expect(repeated.foundationReviewStage!.control).toEqual(first.foundationReviewStage!.control)
    expect(f.controls).toHaveLength(1)
    expect((await f.link.resume(f.run)).phase).toBe('FOUNDATION_REVISION')
  } finally { f.link.dispose() }
})

test('concurrent progress starts one invocation and restart observes its original handle', async () => {
  const f = await fixture()
  try {
    await Promise.all([f.link.ensureProgress(f.run), f.link.ensureProgress(f.run)])
    f.link.dispose()
    const recovered = createFoundationReviewLink({ workspacePath: f.workspacePath, store: f.store,
      reviewer: f.reviewer, revision: f.revision, pollIntervalMs: 60_000 })
    try {
      await recovered.ensureProgress(f.run)
      expect(f.starts).toHaveLength(1)
      expect(f.controls).toHaveLength(0)
    } finally { recovered.dispose() }
  } finally { f.link.dispose() }
})

test('unacknowledged public stop preserves intent and cannot start a successor', async () => {
  const f = await fixture()
  try {
    await f.link.ensureProgress(f.run)
    f.link.dispose()
    const link = createFoundationReviewLink({ workspacePath: f.workspacePath, store: f.store,
      reviewer: { ...f.reviewer, async stop() { throw new Error('close not confirmed') } }, revision: f.revision, pollIntervalMs: 60_000 })
    try {
      await expect(link.stop(f.run, 'stop')).rejects.toThrow('close not confirmed')
      f.complete('issues_found')
      const current = await link.ensureProgress(f.run)
      expect(current.status).toBe('needs_action')
      expect(current.foundationReviewStage!.control.action).toBe('stop')
      expect(current.foundationReviewStage!.sequence).toBe(0)
      expect(current.foundationReviewStage!.observationError).toBe(true)
    } finally { link.dispose() }
  } finally { f.link.dispose() }
})

test('foreign and late result identities fail closed without replacing current invocation', async () => {
  const f = await fixture()
  try {
    await f.link.ensureProgress(f.run)
    const source = structuredClone(fixtures.infrastructure.start.input.sourceResult)
    const { resultId: _, ...body } = { ...source, requestId: 'superseded-request' }
    f.outcome = { status: 'completed', billingStatus: 'settled', handle: f.handle,
      result: { ...body, resultId: foundationPublicDigest(body) } as never }
    await expect(f.link.ensureProgress(f.run)).rejects.toThrow()
    const current = (await f.store.load())!
    expect(current.status).toBe('needs_action')
    expect(current.foundationReviewStage!.sequence).toBe(0)
    expect(current.foundationReviewStage!.invocation.request.requestId).toBe(f.starts[0]!.requestId)
    expect(current.foundationReviewStage!.acceptedReview).toBeUndefined()
  } finally { f.link.dispose() }
})

test('author export rejects altered bytes, traversal, symlinks and wrong identity', async () => {
  const f = await fixture()
  try {
    const args = { workspacePath: f.workspacePath, requestId: 'review', confirmedBriefContext: f.run.confirmedBriefContext, expected: { ownerId: f.run.ownerId,
      projectId: f.run.projectId, inputDigest: f.run.authorStage!.inputDigest, confirmedBriefDigest: f.run.confirmedBriefDigest },
      result: f.run.authorStage!.result! }
    const request = await createFoundationInitialReviewRequest(args)
    expect('documents' in request.input && request.input.documents.length).toBe(8)
    await expect(createFoundationInitialReviewRequest({ ...args, expected: { ...args.expected, ownerId: 'other' } })).rejects.toThrow('accepted invocation')
    const traversal = structuredClone(args); traversal.result.documents[0]!.artifactPath = '../outside'
    await expect(createFoundationInitialReviewRequest(traversal)).rejects.toThrow('descriptor')
    await symlink(join(f.workspacePath, 'exports'), join(f.workspacePath, 'alias'))
    const alias = structuredClone(args); alias.result.documents[0]!.artifactPath = alias.result.documents[0]!.artifactPath.replace('exports/', 'alias/')
    await expect(createFoundationInitialReviewRequest(alias)).rejects.toThrow('real directory')
    await writeFile(join(f.workspacePath, args.result.documents[0]!.artifactPath), 'changed')
    await expect(createFoundationInitialReviewRequest(args)).rejects.toThrow('mismatch')
  } finally { f.link.dispose() }
})

test('controller runs public Reviewer → Revision → Reviewer with local processes and fake billing to Checklist stop', async () => {
  const f = await fixture()
  f.link.dispose()
  const repaired = reviewFixtureDocuments()
  const originals = structuredClone(repaired)
  originals[0]!.content = '# incomplete'
  for (const document of f.run.authorStage!.result!.documents) {
    const content = originals.find(value => value.path === document.path)!.content
    await writeFile(join(f.workspacePath, document.artifactPath), content)
    await writeFile(join(f.workspacePath, document.path), content)
    document.digest = digest(content); document.byteLength = Buffer.byteLength(content)
  }
  await f.store.commit(f.run, { runId: f.run.runId, type: 'fixture.documents', phase: f.run.phase, status: f.run.status, revision: f.run.revision })
  const reviewerBilling = offlineReviewerBilling(f.run.ownerId)
  const revisionBilling = offlineReviewerBilling(f.run.ownerId)
  const reviewer = createFoundationReviewer({ workspacePath: f.workspacePath }, {
    billing: reviewerBilling.client,
    runtimeConfiguration: { protocolVersion: 1, ownerId: f.run.ownerId, async resolve() { return {
      command: [process.execPath, join(import.meta.dir, '../stage-modules/foundation-reviewer/private/test-fixtures/native-file-review.ts'), 'repair-flow'],
      env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast', OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' },
    } } },
  })
  const revision = createFoundationRevision({ workspacePath: f.workspacePath }, {
    billing: revisionBilling.client,
    runtimeConfiguration: { protocolVersion: 1, ownerId: f.run.ownerId, async resolve() { return {
      command: [process.execPath, join(import.meta.dir, '../stage-modules/foundation-revision/private/tests/native-file-revision.ts'), 'valid', Buffer.from(repaired[0]!.content).toString('base64')],
      env: { OPENAI_API_KEY: 'offline-unused' },
    } } },
  })
  const controller = createDeliveryWorkflowController({ workspacePath: f.workspacePath, ownerId: f.run.ownerId,
    reviewer, revision, workerPort: {} as never })
  try {
    await controller.ensureProgress(f.run)
    const deadline = Date.now() + 45_000
    let current = (await f.store.load())!
    while (!current.foundationReviewStage?.acceptedReview && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 30))
      await controller.ensureProgress(current)
      current = (await f.store.load())!
      if (current.status === 'failed' || current.foundationReviewStage?.observationError)
        throw new Error(JSON.stringify(current.foundationReviewStage?.invocation.outcome ?? current.blockedReason))
    }
    expect(current.foundationReviewStage?.acceptedReview?.kind).toBe('passed')
    expect(current.foundationReviewStage?.sequence).toBe(2)
    expect(current.status).toBe('needs_action')
    expect(current.documentStep).toBe('FOUNDATION_REVIEW')
    expect(current.foundationAuditState).toBeUndefined()
    expect(current.activeDispatch).toBeUndefined()
    expect(reviewerBilling.recorded.size).toBeGreaterThan(0)
    expect(revisionBilling.recorded.size).toBeGreaterThan(0)
    await controller.resume(current)
    expect((await f.store.load())!.foundationReviewStage!.sequence).toBe(2)
  } finally { await controller.dispose() }
}, 60_000)
