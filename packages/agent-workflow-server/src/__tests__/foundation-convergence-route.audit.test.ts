import { afterEach, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { createInitialDeliveryRun, createRunStore } from '../beegame/delivery-workflow/run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/delivery-workflow/types'
import { createFoundationInitialReviewRequest, foundationPublicDigest } from '../beegame/delivery-workflow/foundation-public-handoff'
import { evaluateFoundationAcceptance, FOUNDATION_ACCEPTANCE_POLICY_VERSION } from '../beegame/delivery-workflow/foundation-acceptance-policy'
import { buildSingleReviewResult } from '../beegame/stage-modules/foundation-reviewer/private/single-agent-publication'
import type { RevisionStartInput, RevisionHandle } from '../beegame/stage-modules/foundation-revision/public'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'foundation-route-audit-')))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ownerId = 'route-audit-owner', projectId = 'route-audit-project'
  const projectsRoot = join(root, 'projects'), workspacePath = join(projectsRoot, 'users', ownerId, projectId)
  const documents = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => {
    const content = `# ${path}\nRoute audit original.\n`, artifactPath = `exports/${path}`
    for (const destination of [join(workspacePath, path), join(workspacePath, artifactPath)]) {
      await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, content)
    }
    return { path, artifactPath, digest: hash(content), byteLength: Buffer.byteLength(content) }
  }))
  const run = createInitialDeliveryRun({ ownerId, projectId, confirmedBriefContext: 'route audit', confirmedBriefDigest: hash('route audit') })
  run.phase = 'DOCUMENT_REVIEW'; run.documentStep = 'FOUNDATION_REVIEW'; run.status = 'needs_action'
  run.authorStage = { protocolVersion: 1, requestId: 'route-author', inputDigest: hash('input'), status: 'completed',
    handle: { protocolVersion: 1, producer: 'foundation-authoring', id: randomUUID() },
    control: { sequence: 0, requestId: 'route-author', action: 'run' },
    result: { protocolVersion: 1, producer: 'foundation-authoring', kind: 'foundation_documents', ownerId, projectId,
      inputDigest: hash('input'), confirmedBriefDigest: run.confirmedBriefDigest, resultId: hash('result'),
      receiptSetDigest: hash('receipts'), documentRevision: hash('documents'), workspaceRevision: hash('workspace'), documents } }
  const request = await createFoundationInitialReviewRequest({ workspacePath, requestId: `foundation:${run.runId}:0`,
    confirmedBriefContext: run.confirmedBriefContext,
    expected: { ownerId, projectId, inputDigest: run.authorStage.inputDigest, confirmedBriefDigest: run.confirmedBriefDigest },
    result: run.authorStage.result! })
  const review = buildSingleReviewResult(request, { status: 'completed', summary: 'Exact report for route audit',
    findings: ['HIGH', 'MEDIUM'].map((severity, index) => ({ severity: severity as 'HIGH' | 'MEDIUM',
      documentPath: 'docs/GDD.md', title: `Issue ${index}`, actual: `Observed ${index}`, expected: `Expected ${index}` })) })
  const handle = { protocolVersion: 1 as const, producer: 'foundation-reviewer' as const, id: randomUUID() }
  run.foundationReviewStage = { protocolVersion: 1, authorResultId: run.authorStage.result!.resultId, sequence: 0,
    control: { sequence: 0, appliedSequence: 0, action: 'run' }, invocation: { stage: 'reviewer', request, handle,
      outcome: { status: 'completed', handle, billingStatus: 'settled', result: review } },
    sourceReview: review, latestReview: review, policyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION,
    automaticRepairLimit: 2, completedRepairCount: 2, convergenceStop: 'repair_budget_exhausted',
    acceptanceDecision: evaluateFoundationAcceptance({ ownerId, projectId, review, policyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION,
      automaticRepairLimit: 2, completedRepairCount: 2 }) }
  const store = createRunStore(workspacePath, ownerId)
  await store.save(run)
  let starts = 0, revisionRequest: RevisionStartInput, revisionHandle: RevisionHandle
  const forbidden = async (): Promise<never> => { throw new Error('No Author or Reviewer invocation is authorized by this route test') }
  const app = createAgentWorkflowApp({ currentUser: { id: ownerId, role: 'owner' }, dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: projectsRoot, modelConfigStore: false, skillsConfig: false,
    sessionRunner: { start: forbidden }, registerCleanup: cleanup => cleanups.push(cleanup),
    foundationAuthoringHostFactory: () => ({ start: forbidden, getResult: forbidden, stop: forbidden, resume: forbidden }),
    foundationReviewerHostFactory: () => ({ start: forbidden, getResult: async () => ({ status: 'completed', handle, billingStatus: 'settled', result: review }),
      stop: async () => ({ status: 'stopped', handle, billingStatus: 'settled' }), resume: forbidden }),
    foundationRevisionHostFactory: () => ({
      start: async request => { starts++; revisionRequest = request; revisionHandle = { protocolVersion: 1, producer: 'foundation-revision', id: randomUUID() }; return revisionHandle },
      getResult: async () => ({ status: 'running', handle: revisionHandle, inputDigest: revisionRequest.inputDigest, billingStatus: 'settled' }),
      stop: async () => ({ status: 'stopped', handle: revisionHandle, inputDigest: revisionRequest.inputDigest, billingStatus: 'settled' }),
      resume: forbidden,
    }),
  })
  const created = await app.request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: projectId, name: 'Convergence route audit', root_path: workspacePath, created_at: Date.now() }) })
  expect(created.status).toBe(200)
  const precondition = { runId: run.runId, controlSequence: 0, policyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION,
    automaticRepairLimit: 2, completedRepairCount: 2 }
  const riskBody = { ...precondition, action: 'accept_risk', decisionId: randomUUID(), findingIds: review.issues.map(entry => entry.issue.id),
    reason: 'Explicitly accept the listed design risks', reportResultId: review.resultId,
    reportResultDigest: foundationPublicDigest(review), documentSetDigest: review.documentSetDigest }
  const grantBody = { ...precondition, action: 'grant_repair_budget', authorizationId: randomUUID(), additionalRepairRounds: 1,
    reason: 'Authorize one additional repair' }
  const post = (body: unknown, id = projectId) => app.request(`/api/projects/${id}/workflow/foundation-decision`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { app, run, store, workspacePath, root, projectsRoot, ownerId, projectId, review, precondition, riskBody, grantBody, post, starts: () => starts }
}

test('HTTP audit: accepts the exact original report, records server identity, and replays without another invocation', async () => {
  const f = await fixture()
  const response = await f.post({ ...f.riskBody, actorId: 'forged-client-actor', recordedAt: '1900-01-01' })
  expect(response.status, await response.clone().text()).toBe(200)
  const accepted = await f.store.load()
  expect(accepted!.foundationReviewStage!.acceptedReview).toEqual(f.review)
  expect(accepted!.foundationReviewStage!.riskDecisions!.every(decision => decision.actorId === f.ownerId && decision.recordedAt !== '1900-01-01')).toBe(true)
  const replay = await f.post(f.riskBody)
  expect(replay.status, await replay.clone().text()).toBe(200)
  expect(f.starts()).toBe(0)
  expect((await f.store.load())!.foundationReviewStage!.riskDecisions).toHaveLength(2)
})

test('HTTP audit: grant replay reuses its original increment and changed increment conflicts', async () => {
  const f = await fixture()
  const response = await f.post(f.grantBody)
  expect(response.status, await response.clone().text()).toBe(200)
  const replay = await f.post(f.grantBody)
  expect(replay.status, await replay.clone().text()).toBe(200)
  const conflict = await f.post({ ...f.grantBody, additionalRepairRounds: 2 })
  expect(conflict.status).toBe(409)
  expect((await f.store.load())!.foundationReviewStage!.automaticRepairLimit).toBe(3)
  expect((await f.store.load())!.foundationReviewStage!.policyAuthorizations).toHaveLength(1)
  expect(f.starts()).toBeLessThanOrEqual(1)
})

test('HTTP audit: stale run, control, budget, report, and absent project refuse without mutation', async () => {
  const f = await fixture()
  const path = join(f.workspacePath, '.beegame/workflow/run.json'), before = await readFile(path, 'utf8')
  for (const patch of [{ runId: randomUUID() }, { controlSequence: 5 }, { automaticRepairLimit: 9 },
    { completedRepairCount: 0 }, { reportResultDigest: 'f'.repeat(64) }, { documentSetDigest: 'e'.repeat(64) }]) {
    const response = await f.post({ ...f.riskBody, ...patch })
    expect(response.status, await response.clone().text()).toBe(409)
    expect(await readFile(path, 'utf8')).toBe(before)
  }
  expect((await f.post(f.riskBody, 'missing-project')).status).toBe(404)
  expect(f.starts()).toBe(0)
})

test('HTTP audit: one risk decision ID cannot be expanded or changed after partial acceptance', async () => {
  const f = await fixture()
  const partial = { ...f.riskBody, findingIds: [f.riskBody.findingIds[0]] }
  expect((await f.post(partial)).status).toBe(200)
  expect((await f.post(f.riskBody)).status).toBe(409)
  expect((await f.post({ ...partial, reason: 'Different reason' })).status).toBe(409)
  expect((await f.store.load())!.foundationReviewStage!.riskDecisions).toHaveLength(1)
  expect((await f.store.load())!.foundationReviewStage!.acceptedReview).toBeUndefined()
})

test('HTTP audit: conflicting scopes under one decision ID have exactly one winner when submitted concurrently', async () => {
  const f = await fixture()
  const replies = await Promise.all(f.riskBody.findingIds.map(findingId => f.post({ ...f.riskBody, findingIds: [findingId] })))
  expect(replies.map(response => response.status).sort()).toEqual([200, 409])
  expect((await f.store.load())!.foundationReviewStage!.riskDecisions).toHaveLength(1)
  expect((await f.store.load())!.foundationReviewStage!.acceptedReview).toBeUndefined()
})

test('HTTP audit: current-policy switch cannot secretly renew a consumed budget', async () => {
  const f = await fixture()
  const response = await f.post({ ...f.precondition, action: 'switch_policy', authorizationId: randomUUID(), reason: 'Switch policy' })
  expect(response.status).toBe(409)
  expect((await f.store.load())!.foundationReviewStage!.automaticRepairLimit).toBe(2)
  expect(f.starts()).toBe(0)
})

test('HTTP audit: display context is actionable for a real convergence pause', async () => {
  const f = await fixture()
  const response = await f.app.request(`/api/projects/${f.projectId}/workflow`)
  expect(response.status).toBe(200)
  const { workflow } = await response.json() as { workflow: Record<string, unknown> }
  expect(workflow.foundationDecisionContext).toEqual({ ...f.precondition, availableActions: ['accept_risk', 'grant_repair_budget'] })
  expect(workflow.reviewReport).toMatchObject({ resultId: f.review.resultId, resultDigest: foundationPublicDigest(f.review),
    findings: f.review.issues.map(entry => ({ id: entry.issue.id, severity: entry.issue.severity, title: entry.issue.title,
      actual: entry.issue.actual, expected: entry.issue.expected })) })
})

test('HTTP audit: viewers and foreign owners cannot adjudicate the project', async () => {
  const f = await fixture()
  const path = join(f.workspacePath, '.beegame/workflow/run.json'), before = await readFile(path, 'utf8')
  for (const [user, status] of [[{ id: f.ownerId, role: 'viewer' as const }, 403], [{ id: 'foreign-owner', role: 'owner' as const }, 404]] as const) {
    const app = createAgentWorkflowApp({ currentUser: user, dashboardDataRoot: join(f.root, 'dashboard'),
      defaultWorkspacePath: f.projectsRoot, modelConfigStore: false, skillsConfig: false, registerCleanup: cleanup => cleanups.push(cleanup) })
    const response = await app.request(`/api/projects/${f.projectId}/workflow/foundation-decision`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f.riskBody) })
    expect(response.status, await response.clone().text()).toBe(status)
    expect(await readFile(path, 'utf8')).toBe(before)
  }
})

test('HTTP audit: a real version-52 stopped file remains unchanged on read and can explicitly switch without starting', async () => {
  const f = await fixture()
  const legacy = structuredClone(f.run) as unknown as Record<string, any>
  legacy.schemaVersion = 52; legacy.status = 'stopped'
  const link = legacy.foundationReviewStage
  for (const key of ['policyVersion', 'automaticRepairLimit', 'completedRepairCount', 'acceptanceDecision', 'latestReview', 'convergenceStop']) delete link[key]
  link.control.action = 'stop'; link.invocation.outcome = { status: 'stopped', handle: link.invocation.handle, billingStatus: 'settled' }
  const path = join(f.workspacePath, '.beegame/workflow/run.json'), original = JSON.stringify(legacy)
  await writeFile(path, original)
  const response = await f.app.request(`/api/projects/${f.projectId}/workflow`)
  expect(response.status, await response.clone().text()).toBe(200)
  const { workflow } = await response.json() as { workflow: Record<string, unknown> }
  expect(workflow.foundationDecisionContext).toEqual({ runId: f.run.runId, controlSequence: 0, policyVersion: null,
    automaticRepairLimit: null, completedRepairCount: null, availableActions: ['switch_policy'] })
  expect(await readFile(path, 'utf8')).toBe(original)
  const body = { runId: f.run.runId, controlSequence: 0, policyVersion: null, automaticRepairLimit: null, completedRepairCount: null,
    action: 'switch_policy', authorizationId: randomUUID(), reason: 'Explicitly switch the paused legacy task' }
  const switched = await f.post(body)
  expect(switched.status, await switched.clone().text()).toBe(200)
  expect((await f.store.load())!.status).toBe('stopped')
  expect((await f.store.load())!.foundationReviewStage!.completedRepairCount).toBe(0)
  expect((await f.post(body)).status).toBe(200)
  expect(f.starts()).toBe(0)
})
