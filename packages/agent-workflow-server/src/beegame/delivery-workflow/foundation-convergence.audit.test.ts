import { afterEach, expect, setSystemTime, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createFoundationReviewer, type ReviewerStartInput, type ReviewerResult, type ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { createFoundationRevision, type RevisionStartInput, type RevisionResult } from '../stage-modules/foundation-revision/public'
import { buildSingleReviewResult } from '../stage-modules/foundation-reviewer/private/single-agent-publication'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import { createFoundationReviewLink } from './foundation-review-link'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'
import { foundationPublicDigest } from './foundation-public-handoff'
import { FOUNDATION_ACCEPTANCE_POLICY_VERSION, createFoundationRiskDecision } from './foundation-acceptance-policy'
import { deliveryRunSchema } from './schema'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() ; setSystemTime() })

async function fixture() {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'convergence-independent-audit-')))
  const ownerId = 'audit-owner', projectId = 'audit-project'
  const documents = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => {
    const content = `# ${path}\nOriginal source.\n`, artifactPath = `exports/${path}`
    for (const destination of [join(workspacePath, path), join(workspacePath, artifactPath)]) {
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, content)
    }
    return { path, artifactPath, digest: hash(content), byteLength: Buffer.byteLength(content) }
  }))
  const initial = createInitialDeliveryRun({ ownerId, projectId, confirmedBriefContext: 'audit', confirmedBriefDigest: hash('audit') })
  const run: DeliveryRun = { ...initial, phase: 'DOCUMENT_REVIEW', documentStep: 'FOUNDATION_REVIEW', status: 'needs_action',
    authorStage: { protocolVersion: 1, requestId: 'audit-author', inputDigest: hash('input'), status: 'completed',
      handle: { protocolVersion: 1, producer: 'foundation-authoring', id: randomUUID() },
      control: { sequence: 0, requestId: 'audit-author', action: 'run' },
      result: { protocolVersion: 1, producer: 'foundation-authoring', kind: 'foundation_documents', ownerId, projectId,
        inputDigest: hash('input'), confirmedBriefDigest: hash('audit'), resultId: hash('result'),
        receiptSetDigest: hash('receipts'), documentRevision: hash('documents'), workspaceRevision: hash('workspace'), documents } } }
  const store = createRunStore(workspacePath, ownerId)
  await store.commit(run, { runId: run.runId, type: 'audit.created', phase: run.phase, status: run.status, revision: run.revision })
  const reviewRequests: ReviewerStartInput[] = [], revisionRequests: RevisionStartInput[] = []
  let reviewOutcome: ReviewerResult, revisionOutcome: RevisionResult
  const reviewer: ReturnType<typeof createFoundationReviewer> = {
    async start(request) {
      reviewRequests.push(structuredClone(request))
      const handle = { protocolVersion: 1 as const, producer: 'foundation-reviewer' as const, id: randomUUID() }
      reviewOutcome = { status: 'running', handle, billingStatus: 'settled' }
      return handle
    },
    async getResult() { return structuredClone(reviewOutcome) },
    async resume() { return structuredClone(reviewOutcome) },
    async stop() { reviewOutcome = { status: 'stopped', handle: reviewOutcome.handle, billingStatus: 'settled' }; return reviewOutcome },
  }
  const revision: ReturnType<typeof createFoundationRevision> = {
    async start(request) {
      revisionRequests.push(structuredClone(request))
      const handle = { protocolVersion: 1 as const, producer: 'foundation-revision' as const, id: randomUUID() }
      revisionOutcome = { status: 'running', handle, inputDigest: request.inputDigest, billingStatus: 'settled' }
      return handle
    },
    async getResult() { return structuredClone(revisionOutcome) },
    async resume() { return structuredClone(revisionOutcome) },
    async stop() { revisionOutcome = { ...revisionOutcome, status: 'stopped' }; return revisionOutcome },
  }
  const links: Array<ReturnType<typeof createFoundationReviewLink>> = []
  const open = () => {
    const link = createFoundationReviewLink({ workspacePath, store, reviewer, revision, pollIntervalMs: 60_000 })
    links.push(link)
    return link
  }
  const link = open()
  cleanups.push(async () => { for (const instance of links) instance.dispose(); await rm(workspacePath, { recursive: true, force: true }) })
  function finishReview(severities: Array<'LOW' | 'MEDIUM' | 'HIGH'>, billingStatus: 'pending' | 'settled' = 'settled') {
    const request = reviewRequests.at(-1)!
    const result = buildSingleReviewResult(request, { status: 'completed', summary: 'Audit finding report',
      findings: severities.map((severity, index) => ({ severity, documentPath: 'docs/GDD.md' as const,
        title: `Problem ${index}`, actual: `Observed ${index}`, expected: `Expected ${index}` })) })
    reviewOutcome = { status: 'completed', handle: reviewOutcome.handle, billingStatus, result }
    return result
  }
  function finishRevision(changed: boolean) {
    const request = revisionRequests.at(-1)!, source = request.input.sourceResult as ReviewerReviewResult
    const nextDocuments = source.documents.map((document, index) => {
      const content = document.content + (changed && index === 0 ? `\nRepair ${revisionRequests.length}.\n` : '')
      return { ...document, content, digest: hash(content), byteLength: Buffer.byteLength(content) }
    })
    const body = { protocolVersion: 2 as const, producer: 'foundation-revision' as const, kind: 'candidate_ready' as const,
      ownerId, projectId, requestId: request.requestId, candidateId: randomUUID(), round: revisionRequests.length,
      baseDocumentSetDigest: source.documentSetDigest, sourceReviewResultId: source.resultId,
      sourceReviewResultDigest: foundationPublicDigest(source), documents: nextDocuments,
      documentSetDigest: hash(JSON.stringify(nextDocuments.map(({ path, digest }) => [path, digest]))),
      revisionSummary: changed ? 'Changed candidate.' : 'No supported changes; independently reconsider findings.' }
    revisionOutcome = { status: 'completed', handle: revisionOutcome.handle, inputDigest: request.inputDigest,
      billingStatus: 'settled', result: { ...body, resultId: foundationPublicDigest(body) } }
  }
  const tick = () => link.ensureProgress(run)
  return { workspacePath, run, store, link, open, tick, finishReview, finishRevision, reviewRequests, revisionRequests }
}

test('independent lifecycle audit: LOW-only acceptance waits for settlement and keeps the report', async () => {
  const f = await fixture()
  const started = await f.tick()
  expect(started.foundationReviewStage!.policyVersion).toBe(FOUNDATION_ACCEPTANCE_POLICY_VERSION)
  const original = f.finishReview(['LOW', 'LOW'], 'pending')
  const pending = await f.tick()
  expect(pending.foundationReviewStage!.acceptedReview).toBeUndefined()
  expect(f.revisionRequests).toHaveLength(0)
  f.finishReview(['LOW', 'LOW'])
  const accepted = await f.tick()
  expect(accepted.foundationReviewStage!.acceptanceDecision?.disposition).toBe('accepted_with_advisories')
  expect(accepted.foundationReviewStage!.acceptedReview).toEqual(original)
  expect(accepted.foundationReviewStage!.acceptedReview?.kind).toBe('issues_found')
  expect(deliveryRunSchema.safeParse(accepted).success).toBe(true)
  expect(f.revisionRequests).toHaveLength(0)
  const reopened = f.open()
  await reopened.ensureProgress(accepted)
  expect(f.reviewRequests).toHaveLength(1)
  expect(f.revisionRequests).toHaveLength(0)
})

test('independent lifecycle audit: changed candidates may use exactly two repairs, never a third on resume', async () => {
  const f = await fixture()
  await f.tick()
  for (let round = 1; round <= 2; round++) {
    f.finishReview(['HIGH'])
    const queued = await f.tick()
    expect(queued.foundationReviewStage!.invocation.stage).toBe('revision')
    expect(queued.foundationReviewStage!.convergenceStop).toBeUndefined()
    expect(deliveryRunSchema.safeParse(queued).success).toBe(true)
    await f.tick()
    expect(f.revisionRequests).toHaveLength(round)
    f.finishRevision(true)
    const reviewing = await f.tick()
    expect(reviewing.foundationReviewStage!.completedRepairCount).toBe(round)
    expect(reviewing.foundationReviewStage!.invocation.stage).toBe('reviewer')
    await f.tick()
  }
  f.finishReview(['HIGH'])
  const blocked = await f.tick()
  expect(blocked.status).toBe('needs_action')
  expect(blocked.foundationReviewStage!.convergenceStop).toBe('repair_budget_exhausted')
  expect(blocked.foundationReviewStage!.acceptanceDecision?.disposition).toBe('needs_action')
  expect(deliveryRunSchema.safeParse(blocked).success).toBe(true)
  f.link.dispose()
  const reopened = f.open()
  await reopened.resume(blocked)
  await reopened.ensureProgress(blocked)
  expect(f.revisionRequests).toHaveLength(2)
  expect(f.reviewRequests).toHaveLength(3)
  expect(await readFile(join(f.workspacePath, 'docs/GDD.md'), 'utf8')).toBe('# docs/GDD.md\nOriginal source.\n')
})

for (const finalSeverity of ['LOW', 'HIGH'] as const) {
  test(`independent lifecycle audit: unchanged candidate gets a re-review then ${finalSeverity === 'LOW' ? 'acceptance' : 'a durable stop'}`, async () => {
    const f = await fixture()
    await f.tick(); f.finishReview(['HIGH']); await f.tick(); await f.tick()
    f.finishRevision(false)
    const queued = await f.tick()
    expect(queued.foundationReviewStage!.invocation.stage).toBe('reviewer')
    await f.tick(); f.finishReview([finalSeverity])
    const next = await f.tick()
    expect(next.foundationReviewStage!.convergenceStop).toBe(finalSeverity === 'HIGH' ? 'no_document_change_blocked' : undefined)
    expect(next.foundationReviewStage!.acceptanceDecision?.disposition).toBe(finalSeverity === 'HIGH' ? 'needs_action' : 'accepted_with_advisories')
    expect(f.reviewRequests).toHaveLength(2)
    expect(f.revisionRequests).toHaveLength(1)
    expect(deliveryRunSchema.safeParse(next).success).toBe(true)
  })
}

test('independent lifecycle audit: old links without a policy keep their old LOW routing', async () => {
  const f = await fixture()
  const current = await f.tick(), state = current.foundationReviewStage!
  delete state.policyVersion; delete state.automaticRepairLimit; delete state.completedRepairCount
  await f.store.commit(current, { runId: current.runId, type: 'audit.legacy', phase: current.phase,
    status: current.status, revision: current.revision })
  f.finishReview(['LOW'])
  const next = await f.tick()
  expect(next.foundationReviewStage!.policyVersion).toBeUndefined()
  expect(next.foundationReviewStage!.acceptanceDecision).toBeUndefined()
  expect(next.foundationReviewStage!.invocation.stage).toBe('revision')
})

async function blockedFixture(severities: Array<'LOW' | 'MEDIUM' | 'HIGH'> = ['HIGH']) {
  const f = await fixture()
  await f.tick(); f.finishReview(['HIGH']); await f.tick(); await f.tick()
  f.finishRevision(false); await f.tick(); await f.tick(); f.finishReview(severities)
  const blocked = await f.tick()
  const review = blocked.foundationReviewStage!.latestReview!
  const risk = createFoundationRiskDecision({ ownerId: blocked.ownerId, projectId: blocked.projectId,
    review, findingId: review.issues[0]!.issue.id, actorId: blocked.ownerId, reason: 'Accept this exact design risk',
    decisionId: randomUUID(), recordedAt: new Date().toISOString() })
  return { ...f, blocked, risk }
}

test('independent user-action audit: explicit risk acceptance produces an accepted result without a model call', async () => {
  const f = await blockedFixture()
  const updated = await f.link.applyPolicyDecision(f.blocked, { riskDecisions: [f.risk] })
  expect(updated).toBeDefined()
  expect(updated!.foundationReviewStage!.acceptanceDecision?.disposition).toBe('accepted_with_advisories')
  expect(updated!.foundationReviewStage!.acceptedReview?.kind).toBe('issues_found')
  expect(updated!.foundationReviewStage!.acceptedReview!.issues).toHaveLength(1)
  expect(f.reviewRequests).toHaveLength(2)
  expect(f.revisionRequests).toHaveLength(1)
  expect(deliveryRunSchema.safeParse(updated).success).toBe(true)
  await f.link.applyPolicyDecision(f.blocked, { riskDecisions: [f.risk] })
  expect(f.revisionRequests).toHaveLength(1)
})

test('independent user-action audit: a stale report waiver is refused before it enters durable state', async () => {
  const f = await blockedFixture()
  const stale = { ...f.risk, reviewResultDigest: 'f'.repeat(64) }
  await expect(f.link.applyPolicyDecision(f.blocked, { riskDecisions: [stale] })).rejects.toThrow()
  expect((await f.store.load())!.foundationReviewStage!.riskDecisions ?? []).toEqual([])
  expect(f.revisionRequests).toHaveLength(1)
})

test('independent user-action audit: stopping a convergence pause prevents later acceptance from resuming it', async () => {
  const f = await blockedFixture()
  await f.link.stop(f.blocked, 'User stopped before risk acceptance')
  const stopped = (await f.store.load())!
  expect(stopped.foundationReviewStage!.control.action).toBe('stop')
  try { await f.link.applyPolicyDecision(stopped, { riskDecisions: [f.risk] }) } catch { /* Refusal is also safe. */ }
  const after = (await f.store.load())!
  expect(after.foundationReviewStage!.acceptedReview).toBeUndefined()
  expect(f.revisionRequests).toHaveLength(1)
  expect(after.foundationReviewStage!.control.action).toBe('stop')
})

test('independent user-action audit: additional repair authorization is usable once and rejects conflicting replay', async () => {
  const f = await blockedFixture()
  const authorization = { authorizationId: randomUUID(), action: 'grant_repair_budget' as const,
    actorId: f.blocked.ownerId, reason: 'Authorize one further independent revision', recordedAt: new Date().toISOString(),
    fromPolicyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION, toPolicyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION,
    previousAutomaticRepairLimit: 2, newAutomaticRepairLimit: 3 }
  const updated = await f.link.applyPolicyDecision(f.blocked, { authorization })
  expect(updated).toBeDefined()
  expect(updated!.foundationReviewStage!.invocation.stage).toBe('revision')
  await f.tick()
  expect(f.revisionRequests).toHaveLength(2)
  await f.link.applyPolicyDecision(f.blocked, { authorization })
  expect((await f.store.load())!.foundationReviewStage!.automaticRepairLimit).toBe(3)
  expect(f.revisionRequests).toHaveLength(2)
  await expect(f.link.applyPolicyDecision(f.blocked, { authorization: { ...authorization, newAutomaticRepairLimit: 4 } })).rejects.toThrow()
  expect((await f.store.load())!.foundationReviewStage!.automaticRepairLimit).toBe(3)
})

test('independent admission audit: a blocked decision cannot masquerade as acceptedReview', async () => {
  const f = await blockedFixture()
  const forged = structuredClone(f.blocked)
  forged.foundationReviewStage!.acceptedReview = forged.foundationReviewStage!.latestReview
  expect(deliveryRunSchema.safeParse(forged).success).toBe(false)
})

test('independent lifecycle audit: partial waivers are retained but never inherited by a new candidate', async () => {
  const f = await blockedFixture(['HIGH', 'MEDIUM'])
  const partial = await f.link.applyPolicyDecision(f.blocked, { riskDecisions: [f.risk] })
  expect(partial.foundationReviewStage!.acceptanceDecision?.blockingFindingIds).toHaveLength(1)
  expect(partial.foundationReviewStage!.acceptedReview).toBeUndefined()
  const authorization = { authorizationId: randomUUID(), action: 'grant_repair_budget' as const,
    actorId: f.blocked.ownerId, reason: 'One additional revision after partial adjudication', recordedAt: new Date().toISOString(),
    fromPolicyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION, toPolicyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION,
    previousAutomaticRepairLimit: 2, newAutomaticRepairLimit: 3 }
  await f.link.applyPolicyDecision(partial, { authorization })
  await f.tick(); f.finishRevision(true); await f.tick(); await f.tick()
  f.finishReview(['LOW'])
  const accepted = await f.tick()
  expect(accepted.foundationReviewStage!.acceptanceDecision?.disposition).toBe('accepted_with_advisories')
  expect(accepted.foundationReviewStage!.acceptanceDecision?.waivedFindingIds).toEqual([])
  expect(accepted.foundationReviewStage!.riskDecisions).toEqual([f.risk])
  expect(deliveryRunSchema.safeParse(accepted).success).toBe(true)
})

test('independent migration audit: switching a stopped unfinished legacy revision preserves completed count and pause', async () => {
  const f = await fixture()
  const current = await f.tick(), state = current.foundationReviewStage!
  delete state.policyVersion; delete state.automaticRepairLimit; delete state.completedRepairCount
  await f.store.commit(current, { runId: current.runId, type: 'audit.legacy', phase: current.phase,
    status: current.status, revision: current.revision })
  f.finishReview(['HIGH']); await f.tick(); await f.tick()
  const stopped = await f.link.stop(f.run, 'Pause unfinished first revision')
  expect(stopped.foundationReviewStage!.sequence).toBe(1)
  const switched = await f.link.applyPolicyDecision(stopped, { authorization: {
    authorizationId: randomUUID(), action: 'switch_policy', actorId: stopped.ownerId,
    reason: 'Use convergence on explicit future resume', recordedAt: new Date().toISOString(),
    toPolicyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION, newAutomaticRepairLimit: 2,
  } })
  expect(switched.status).toBe('stopped')
  expect(switched.foundationReviewStage!.control.action).toBe('stop')
  expect(switched.foundationReviewStage!.completedRepairCount).toBe(0)
  expect(switched.foundationReviewStage!.automaticRepairLimit).toBe(2)
  expect(switched.foundationReviewStage!.policyAuthorizations).toHaveLength(1)
  expect(f.revisionRequests).toHaveLength(1)
  expect(f.reviewRequests).toHaveLength(1)
})

test('independent timing audit: both invocation types are counted and terminal rereads exclude human pause', async () => {
  const base = Date.parse('2026-09-12T00:00:00.000Z')
  setSystemTime(new Date(base))
  const f = await fixture()
  await f.tick()
  setSystemTime(new Date(base + 10_000))
  f.finishReview(['HIGH'])
  const queued = await f.tick()
  expect(queued.foundationReviewStage!.historicalElapsedMs).toBe(10_000)
  await f.tick()
  setSystemTime(new Date(base + 15_000))
  const stopped = await f.link.stop(f.run, 'Pause this invocation')
  expect(stopped.foundationReviewStage!.currentCallElapsedMs).toBe(5_000)
  setSystemTime(new Date(base + 100_000))
  const reread = await f.tick()
  expect(reread.foundationReviewStage!.historicalElapsedMs).toBe(10_000)
  expect(reread.foundationReviewStage!.currentCallElapsedMs).toBe(5_000)
})
