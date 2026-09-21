import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createAuthenticationClient } from '../../auth/public'
import { createRuntimeConfigurationClient } from '../../runtime-configuration/public'
import { createFoundationAuthoring } from '../stage-modules/foundation-authoring/public'
import { reviewFixtureDocuments } from '../stage-modules/foundation-reviewer/private/test-fixtures/review-documents'
import { offlineReviewerBilling } from '../stage-modules/foundation-reviewer/private/test-fixtures/offline-billing'
import { createFoundationReviewer } from '../stage-modules/foundation-reviewer/public'
import { createDeliveryWorkflowController } from './controller'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import type { DeliveryRun } from './types'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const metadata = (content: string, field: string) => content.match(new RegExp(`^${field}: (.+)$`, 'm'))?.[1]

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
    try { await controller.ensureProgress(run) } catch (error) {
      // Handoff may be performed by this call or by the background observer.
      // Both must leave the same deliberately failed resource boundary.
      const failed = await store.load()
      if (error instanceof Error && error.message === 'resource execution intentionally unavailable in foundation-only fixture' &&
          failed?.phase === 'RESOURCE_PREPARATION' && failed.status === 'failed' &&
          failed.foundationReviewStage?.acceptedReview) return failed
      throw error
    }
    const current = await store.load()
    if (current?.foundationReviewStage?.acceptedReview && current.phase === 'RESOURCE_PREPARATION' && current.status === 'failed') return current
    if (current?.foundationReviewStage?.acceptedReview) { await pause(20); continue }
    if (current?.foundationReviewStage && ['needs_action', 'failed', 'stopped'].includes(current.status))
      throw new Error(JSON.stringify({ reason: current.blockedReason, outcome: current.foundationReviewStage.invocation.outcome }))
    await pause(20)
  }
  throw new Error('Author → document review-and-correction passes did not settle')
}

for (const rounds of [0, 1, 2])
test(`agentic document passes correct ${rounds} changed document(s) without a separate repair agent`, async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'public-foundation-chain-')))
  const ownerId = 'public-chain-owner'
  const projectId = 'public-chain-project'
  const brief = 'Offline public foundation chain fixture'
  const confirmedBriefDigest = digest(brief)
  const normalized = reviewFixtureDocuments()
  const malformed = normalized.map(document => rounds >= 1 && document.path === 'docs/TECHNICAL_DESIGN.md'
    ? { ...document, content: document.content + '\nREPAIR_REQUIRED\n' }
    : rounds === 2 && document.path === 'docs/GDD.md' ? { ...document, content: document.content + '\nREPAIR_REQUIRED\n' }
    : document)
  const immutableAuthorDocuments = Object.fromEntries(malformed.map(document => [document.path, document.content]))
  const malformedTechnical = malformed.find(document => document.path === 'docs/TECHNICAL_DESIGN.md')!.content
  const repairedTechnical = normalized.find(document => document.path === 'docs/TECHNICAL_DESIGN.md')!.content
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
      command: [process.execPath, fileURLToPath(new URL('../stage-modules/foundation-reviewer/private/test-fixtures/native-file-review.ts', import.meta.url)), 'repair-flow'],
      env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast',
        OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' }, calls: reviewerRuntimeCalls }),
    billing: reviewerBilling.client,
  })

  const initial = createInitialDeliveryRun({ ownerId, projectId,
    confirmedBriefContext: brief, confirmedBriefDigest })
  const run: DeliveryRun = { ...initial, phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING' }
  const store = createRunStore(workspacePath, ownerId)
  await store.commit(run, { runId: run.runId, type: 'run.created', phase: run.phase, status: run.status, revision: run.revision })
  const workerPort = {
    async start() { throw new Error('resource execution intentionally unavailable in foundation-only fixture') },
    async submit() { throw new Error('legacy worker must not execute foundation chain') },
    async stop() { throw new Error('legacy worker must not execute foundation chain') },
    async status() { throw new Error('legacy worker must not execute foundation chain') },
  }
  const ports = { workspacePath, ownerId, workerPort, author, reviewer }
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
    if (rounds >= 1) {
      expect(originalTechnical).toContain('REPAIR_REQUIRED')
      expect(originalTechnical).not.toBe(repairedTechnical)
    } else expect(originalTechnical).not.toContain('REPAIR_REQUIRED')

    current = await waitForAccepted(controller, store, run)
    const link = current.foundationReviewStage!
    expect(link.acceptedReview?.protocolVersion).toBe(6)
    expect(link.acceptedReview?.documents).toHaveLength(8)
    expect(link.acceptedReview?.audit).not.toHaveProperty('reviewedDocuments')
    expect(link.acceptedReview!.documents.find(document => document.path === 'docs/TECHNICAL_DESIGN.md')!.content)
      .not.toContain('REPAIR_REQUIRED')
    const publishedTechnical = await readFile(join(workspacePath, 'docs/TECHNICAL_DESIGN.md'), 'utf8')
    const publishedGdd = await readFile(join(workspacePath, 'docs/GDD.md'), 'utf8')
    expect(publishedTechnical).not.toContain('REPAIR_REQUIRED')
    expect(publishedGdd).toContain(immutableAuthorDocuments['docs/GDD.md']!.replace('REPAIR_REQUIRED', 'Repair completed').trim())
    expect(metadata(publishedTechnical, 'version')).toBe(rounds >= 1 ? '1.0.1' : '1.0.0')
    expect(metadata(publishedGdd, 'version')).toBe(rounds === 2 ? '1.0.1' : '1.0.0')
    if (rounds >= 1)
      expect(Date.parse(metadata(publishedTechnical, 'updated_at')!)).toBeGreaterThan(
        Date.parse(metadata(originalTechnical, 'updated_at')!),
      )
    for (const artifact of authorResult.documents) {
      expect(digest(await readFile(join(workspacePath, artifact.artifactPath), 'utf8'))).toBe(artifact.digest)
    }
    // Accepted documents now hand off directly to resources; a publication
    // snapshot can be observed before that asynchronous handoff has settled.
    expect(current.status).toBe('failed')
    expect(current.phase).toBe('RESOURCE_PREPARATION')
    expect(current.blockedReason).toBe('resource execution intentionally unavailable in foundation-only fixture')
    expect(current.documentStep).toBeUndefined()
    expect(current.activeDispatch).toMatchObject({ workerType: 'resource-planner', status: 'failed' })

    const snapshot = structuredClone(current)
    const currentPointerPath = join(workspacePath, '.beegame/artifacts/current.json')
    const publicationPointer = await readFile(currentPointerPath, 'utf8')
    const counts = () => [authorRuntimeCalls.count, authorBillingCalls.count, reviewerRuntimeCalls.count,
      reviewerBillingCalls.count]
    const settledCounts = counts()
    for (let i = 0; i < 3; i++) await controller.ensureProgress(run)
    await controller.resume(current)
    const repeated = (await store.load())!
    expect(counts()).toEqual(settledCounts)
    expect(repeated.foundationReviewStage?.acceptedReview?.resultId).toBe(snapshot.foundationReviewStage?.acceptedReview?.resultId)
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
    expect(authorRuntimeCalls.count).toBe(1)
    expect(authorBillingCalls.count).toBe(1)
    expect(reviewerRuntimeCalls.count).toBe(1)
    expect(reviewerBillingCalls.count).toBe(1)
  } finally {
    await controller.dispose()
  }
}, 120_000)
