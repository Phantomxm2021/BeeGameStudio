import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createAuthenticationClient } from '../../auth/public'
import { createRuntimeConfigurationClient } from '../../runtime-configuration/public'
import { createFoundationAuthoring } from '../stage-modules/foundation-authoring/public'
import { reviewFixtureDocuments } from '../stage-modules/foundation-reviewer/private/test-fixtures/review-fixture'
import { offlineReviewerBilling } from '../stage-modules/foundation-reviewer/private/test-fixtures/offline-billing'
import { createFoundationReviewer } from '../stage-modules/foundation-reviewer/public'
import { createFoundationRevision } from '../stage-modules/foundation-revision/public'
import { createDeliveryWorkflowController } from './controller'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import type { DeliveryRun } from './types'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function runtimeConfiguration(input: {
  ownerId: string
  dataDir: string
  command: readonly string[]
  env: Record<string, string>
  calls: { count: number }
}) {
  const authentication = createAuthenticationClient({ ownerId: input.ownerId, credential: {
    async getValidAccessToken() { return 'offline-public-chain-token' },
  } })
  return createRuntimeConfigurationClient({ ownerId: input.ownerId, dataDir: input.dataDir,
    authentication, command: input.command, repository: { async getRuntimeEnv() {
      input.calls.count++
      return { ...input.env }
    } } })
}

function billingWithCallCount(ownerId: string, calls: { count: number }) {
  const base = offlineReviewerBilling(ownerId)
  return { ...base, client: { ...base.client, async submitUsage(input: Parameters<typeof base.client.submitUsage>[0]) {
    calls.count++
    return base.client.submitUsage(input)
  } } }
}

async function waitForAccepted(controller: ReturnType<typeof createDeliveryWorkflowController>, store: ReturnType<typeof createRunStore>, run: DeliveryRun) {
  for (let attempt = 0; attempt < 3_000; attempt++) {
    await controller.ensureProgress(run)
    const current = await store.load()
    if (current?.foundationReviewStage?.acceptedReview) return current
    if (current?.foundationReviewStage && ['needs_action', 'failed', 'stopped'].includes(current.status))
      throw new Error(JSON.stringify({ reason: current.blockedReason, outcome: current.foundationReviewStage.invocation.outcome }))
    await pause(20)
  }
  throw new Error('Author → Reviewer → Revision → Reviewer fixture did not settle')
}

test('independent public Author → Reviewer → Revision → Reviewer chain repairs only the authorized Technical section', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'public-foundation-chain-')))
  const ownerId = 'public-chain-owner'
  const projectId = 'public-chain-project'
  const brief = 'Offline public foundation chain fixture'
  const confirmedBriefDigest = digest(brief)
  const normalized = reviewFixtureDocuments(true)
  const malformed = normalized.map(document => document.path === 'docs/TECHNICAL_DESIGN.md'
    ? { ...document, content: document.content.replace('technical.supported_actions: ["move","attack","dash"]', 'technical.supported_actions: ["move","attack"]') }
    : document)
  const immutableAuthorDocuments = Object.fromEntries(malformed.map(document => [document.path, document.content]))
  const malformedTechnical = malformed.find(document => document.path === 'docs/TECHNICAL_DESIGN.md')!.content
  const repairedTechnical = normalized.find(document => document.path === 'docs/TECHNICAL_DESIGN.md')!.content
  const sectionStart = malformedTechnical.indexOf('## Input and Interaction Boundary')
  const malformedSectionEnd = malformedTechnical.indexOf('<!-- beegame-section:performance -->', sectionStart)
  const repairedSectionEnd = repairedTechnical.indexOf('<!-- beegame-section:performance -->', sectionStart)
  const repairedSection = repairedTechnical.slice(sectionStart, repairedSectionEnd)
  expect(sectionStart).toBeGreaterThan(0)
  expect(malformedSectionEnd).toBeGreaterThan(sectionStart)
  expect(repairedSection).toContain('technical.supported_actions: ["move","attack","dash"]')
  const authorRuntimeCalls = { count: 0 }
  const authorBillingCalls = { count: 0 }
  const author = createFoundationAuthoring({ workspacePath,
    privateRootPath: join(workspacePath, '.beegame/workflow/foundation-authoring/state') }, {
    runtimeConfiguration: runtimeConfiguration({ ownerId, dataDir: workspacePath,
      command: [process.execPath, fileURLToPath(new URL('../stage-modules/foundation-authoring/private/test-fixtures/native-author-documents.ts', import.meta.url)),
        Buffer.from(JSON.stringify(immutableAuthorDocuments)).toString('base64')], env: {}, calls: authorRuntimeCalls }),
    billing: billingWithCallCount(ownerId, authorBillingCalls).client,
  })

  const reviewerRuntimeCalls = { count: 0 }
  const reviewerBillingCalls = { count: 0 }
  const reviewerBilling = billingWithCallCount(ownerId, reviewerBillingCalls)
  const reviewer = createFoundationReviewer({ workspacePath }, {
    runtimeConfiguration: runtimeConfiguration({ ownerId, dataDir: workspacePath,
      command: [process.execPath, fileURLToPath(new URL('../stage-modules/foundation-reviewer/private/test-fixtures/native-reviewer.ts', import.meta.url)), '--fixture-mode=success'],
      env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast',
        OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' }, calls: reviewerRuntimeCalls }),
    billing: reviewerBilling.client,
  })

  const revisionRuntimeCalls = { count: 0 }
  const revisionBillingCalls = { count: 0 }
  const revisionBilling = billingWithCallCount(ownerId, revisionBillingCalls)
  const revision = createFoundationRevision({ workspacePath }, {
    runtimeConfiguration: runtimeConfiguration({ ownerId, dataDir: workspacePath,
      command: [process.execPath, fileURLToPath(new URL('../stage-modules/foundation-revision/private/tests/native-section-fixture.ts', import.meta.url)),
        Buffer.from(repairedSection).toString('base64')], env: { OPENAI_API_KEY: 'offline-unused' }, calls: revisionRuntimeCalls }),
    billing: revisionBilling.client,
  })

  const initial = createInitialDeliveryRun({ ownerId, projectId,
    confirmedBriefContext: brief, confirmedBriefDigest })
  const run: DeliveryRun = { ...initial, phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING' }
  const store = createRunStore(workspacePath, ownerId)
  await store.commit(run, { runId: run.runId, type: 'run.created', phase: run.phase, status: run.status, revision: run.revision })
  const workerPort = {
    async start() { throw new Error('legacy worker must not execute foundation chain') },
    async submit() { throw new Error('legacy worker must not execute foundation chain') },
    async stop() { throw new Error('legacy worker must not execute foundation chain') },
    async status() { throw new Error('legacy worker must not execute foundation chain') },
  }
  const ports = { workspacePath, ownerId, workerPort, author, reviewer, revision }
  const controller = createDeliveryWorkflowController(ports)
  try {
    await controller.start(run)
    // Drive Author to its public immutable result before Reviewer handoff.
    let current = (await store.load())!
    for (let attempt = 0; attempt < 1_000 && current.authorStage?.status !== 'completed'; attempt++) {
      await controller.ensureProgress(run)
      current = (await store.load())!
      if (current.authorStage?.status === 'needs_action') throw new Error(JSON.stringify(current.authorStage))
      await pause(10)
    }
    expect(current.authorStage?.status).toBe('completed')
    const authorResult = current.authorStage!.result!
    const originalTechnical = await readFile(join(workspacePath, authorResult.documents.find(document => document.path === 'docs/TECHNICAL_DESIGN.md')!.artifactPath), 'utf8')
    expect(originalTechnical).toContain('technical.supported_actions: ["move","attack"]')
    expect(originalTechnical).not.toContain('technical.supported_actions: ["move","attack","dash"]')

    current = await waitForAccepted(controller, store, run)
    const link = current.foundationReviewStage!
    expect(link.sequence).toBe(2)
    expect(link.acceptedReview?.kind).toBe('passed')
    expect(link.sourceReview?.kind).toBe('issues_found')
    expect(link.sourceReview?.issues).toHaveLength(1)
    const issue = link.sourceReview!.issues[0]!.issue
    expect(issue.type).toBe('contract')
    expect(issue.source.documentPath).toBe('docs/TECHNICAL_DESIGN.md')
    if (!('sectionId' in issue.source) || !('target' in issue)) throw new Error('Expected one section contract issue')
    expect(issue.source.sectionId).toBe('input_interaction')
    expect(issue.target?.documentPath).toBe('docs/GDD.md')
    expect(issue.target?.sectionId).toBe('player_actions')
    expect(link.candidate?.documents.find(document => document.path === 'docs/TECHNICAL_DESIGN.md')!.content)
      .toContain('technical.supported_actions: ["move","attack","dash"]')
    expect(link.candidate?.documents.filter(document => document.path !== 'docs/TECHNICAL_DESIGN.md')
      .map(document => document.digest)).toEqual(link.sourceReview?.documents.filter(document => document.path !== 'docs/TECHNICAL_DESIGN.md')
      .map(document => document.digest))
    expect(await readFile(join(workspacePath, 'docs/TECHNICAL_DESIGN.md'), 'utf8'))
      .toContain('technical.supported_actions: ["move","attack","dash"]')
    expect(await readFile(join(workspacePath, 'docs/GDD.md'), 'utf8'))
      .toContain('game.mechanics: ["move","attack","dash"]')
    for (const artifact of authorResult.documents) {
      expect(digest(await readFile(join(workspacePath, artifact.artifactPath), 'utf8'))).toBe(artifact.digest)
    }
    expect(current.status).toBe('needs_action')
    expect(current.documentStep).toBe('FOUNDATION_REVIEW')
    expect(current.activeDispatch).toBeUndefined()

    const snapshot = structuredClone(current)
    const currentPointerPath = join(workspacePath, '.beegame/artifacts/current.json')
    const publicationPointer = await readFile(currentPointerPath, 'utf8')
    const counts = () => [authorRuntimeCalls.count, authorBillingCalls.count, reviewerRuntimeCalls.count,
      reviewerBillingCalls.count, revisionRuntimeCalls.count, revisionBillingCalls.count]
    const settledCounts = counts()
    for (let i = 0; i < 3; i++) await controller.ensureProgress(run)
    await controller.resume(current)
    const repeated = (await store.load())!
    expect(counts()).toEqual(settledCounts)
    expect(repeated.foundationReviewStage?.acceptedReview?.resultId).toBe(snapshot.foundationReviewStage?.acceptedReview?.resultId)
    expect(repeated.foundationReviewStage?.candidate?.documentSetDigest).toBe(snapshot.foundationReviewStage?.candidate?.documentSetDigest)
    expect(repeated.revision).toEqual(snapshot.revision)
    await controller.dispose()
    const recovered = createDeliveryWorkflowController(ports)
    try {
      await recovered.ensureProgress(run)
      await recovered.resume(current)
      expect((await store.load())!.foundationReviewStage!.acceptedReview).toEqual(link.acceptedReview)
      expect((await store.load())!.revision).toEqual(snapshot.revision)
      expect(counts()).toEqual(settledCounts)
      expect(await readFile(currentPointerPath, 'utf8')).toBe(publicationPointer)
    } finally { await recovered.dispose() }
    expect(authorRuntimeCalls.count).toBe(8)
    expect(authorBillingCalls.count).toBe(8)
    expect(reviewerRuntimeCalls.count).toBeGreaterThanOrEqual(2)
    expect(reviewerBillingCalls.count).toBeGreaterThanOrEqual(2)
    expect(revisionRuntimeCalls.count).toBe(1)
    expect(revisionBillingCalls.count).toBe(1)
  } finally {
    await controller.dispose()
  }
}, 120_000)
