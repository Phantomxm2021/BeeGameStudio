import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BeeGameUsageBillingClient,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { createUsageBillingClient, type UsageBillingClient } from '../../../../../billing/public'
import { createFoundationRevision, foundationRevisionInputDigest,
  type RevisionHandle, type RevisionResult, type RevisionStartInput } from '../../public'
import { prepareRevisionRequest } from '../request-preparation'
import type { RuntimeConfigurationClient } from '../../../../../runtime-configuration/public'
import { readRevisionRequestByHandle } from '../request-store'
import { openRevisionExecutionLease } from '../execution-lease'
import { openRevisionAttemptStore } from '../attempt-store'
import { revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

const roots: string[] = []
const live: Array<{ root: string; stage: ReturnType<typeof createFoundationRevision>; handle: RevisionHandle }> = []
afterEach(async () => {
  for (const { root, stage, handle } of live.splice(0)) {
    await stage.stop({ handle, requestId: `followup-cleanup-${crypto.randomUUID()}`, reason: 'shutdown' })
    const deadline = Date.now() + 5000
    let closed = false
    while (Date.now() < deadline) {
      const registration = await readRevisionRequestByHandle(root, handle.id, 'owner')
      const leases = await openRevisionExecutionLease(root, registration.prepared.request, { readOnlyHandle: handle.id })
      const attempts = await openRevisionAttemptStore(root, registration.prepared.request, { readOnlyHandle: handle.id })
      const state = await attempts.readRequest()
      if (state.activeAttemptId === null && await leases.status() === 'free') { closed = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(closed).toBe(true)
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function nextRoundFixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildSingleReviewFixture({ documents,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'candidate-full-review' },
    subject: { kind: 'candidate', candidateId: 'previous-candidate', candidateResultId: 'a'.repeat(64),
      sourceReviewResultId: 'b'.repeat(64), sourceReviewResultDigest: 'c'.repeat(64), baseDocumentSetDigest: 'd'.repeat(64), round: 1 } })
  const input = { sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
  const request = { ...input, ownerId: 'owner', projectId: 'project', requestId: 'public-followup-next-round' }
  return { input, request, plan: prepareRevisionRequest(request), markdown: reviewFixtureDocuments()[0]!.content }
}

function backendResult(input: BeeGameUsageBillingRecordInput, id: string, duplicate = false): BeeGameUsageBillingRecordResult {
  const usage = input.usage
  return { duplicate, event: { id, idempotencyKey: input.idempotencyKey, userId: 'owner', sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}), ...(input.projectId ? { projectId: input.projectId } : {}),
    pricingVersion: input.pricingVersion ?? 'weighted-v1', usageSource: input.usageSource ?? 'runtime_snapshot', usage, delta: usage,
    weightedTokens: usage.total_tokens, weightedTokensDelta: usage.total_tokens, creditsMicro: usage.total_tokens,
    createdAt: '2026-09-06T00:00:00.000Z', metadata: input.metadata ?? {} },
    cumulativeUsage: usage, cumulativeWeightedTokens: usage.total_tokens, creditsMicro: usage.total_tokens }
}

function infrastructure(body: string) {
  let runtimeCalls = 0
  const runtimeConfiguration: RuntimeConfigurationClient = { protocolVersion: 1, ownerId: 'owner', async resolve() {
    runtimeCalls += 1
    return { command: [process.execPath, join(import.meta.dir, 'native-file-revision.ts'), 'valid', Buffer.from(body).toString('base64')],
      env: { OPENAI_API_KEY: 'offline-unused-secret-sentinel' } }
  } }
  const billingCalls: string[] = []
  const authority: BeeGameUsageBillingClient = { async recordUsage(_ownerId, input) {
    billingCalls.push(`record:${input.idempotencyKey}`); return backendResult(input, 'record-event', billingCalls.length > 1)
  }, async debitRealTimeUsage(_ownerId, input) {
    billingCalls.push(`debit:${input.idempotencyKey}`); return backendResult(input, 'debit-event', billingCalls.length > 2)
  } }
  const billing = createUsageBillingClient({ ownerId: 'owner', billingClient: authority })
  return { runtimeConfiguration, billing, runtimeCalls: () => runtimeCalls, billingCalls }
}

async function waitFor(stage: ReturnType<typeof createFoundationRevision>, handle: RevisionHandle,
  predicate: (result: RevisionResult) => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout
  let latest: RevisionResult | undefined
  while (Date.now() < deadline) {
    latest = await stage.getResult(handle)
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`follow-up lifecycle did not reach expected state: ${latest?.status ?? 'unknown'}`)
}

test('public next round repairs the latest full-review source and preserves unassigned bytes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-followup-next-round-')))
  roots.push(root)
  const fixture = nextRoundFixture()
  const digest = foundationRevisionInputDigest({ ownerId: 'owner', projectId: 'project', input: fixture.input })
  const start: RevisionStartInput = { protocolVersion: 1, requestId: fixture.request.requestId, ownerId: 'owner',
    projectId: 'project', inputDigest: digest, input: fixture.input }
  const plan = fixture.plan
  expect(plan).not.toHaveProperty('batches')
  const infra = infrastructure(fixture.markdown)
  const stage = createFoundationRevision({ workspacePath: root }, { runtimeConfiguration: infra.runtimeConfiguration, billing: infra.billing })
  const handle = await stage.start(start)
  live.push({ root, stage, handle })
  const result = await waitFor(stage, handle, value => value.status === 'completed' && value.billingStatus === 'settled')
  expect(result.status).toBe('completed')
  if (result.status !== 'completed') return
  expect(result.result.round).toBe(2)
  expect(result.result.sourceReviewResultId).toBe(fixture.input.sourceResult.resultId)
  expect(result.result.documents.find(document => document.path === 'docs/GDD.md')!.content).toBe(fixture.markdown)
  for (const original of fixture.input.sourceResult.documents.filter(document => document.path !== 'docs/GDD.md'))
    expect(result.result.documents.find(document => document.path === original.path)!.content).toBe(original.content)
  expect(result.result).not.toHaveProperty('repairClaims')
  expect(result.result.revisionSummary).toBeTruthy()
  expect(result.result).not.toHaveProperty('unresolvedIssues')
  expect(infra.runtimeCalls()).toBe(1)
})
