import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BeeGameUsageBillingClient,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { createUsageBillingClient } from '../../../../../billing/public'
import {
  createFoundationRevision,
  foundationRevisionInputDigest,
  type RevisionHandle,
  type RevisionResult,
  type RevisionStartInput,
} from '../../public'
import type { RuntimeConfigurationClient } from '../../../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../../../billing/public'
import { readRevisionRequestByHandle } from '../request-store'
import { openRevisionExecutionLease } from '../execution-lease'
import { openRevisionAttemptStore } from '../attempt-store'
import { revisionDigest } from '../json-digest'
import publicInitialInputs from './fixtures/public-initial-inputs.json'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

type PublicInitialInputsFixture = {
  lifecycle: { start: RevisionStartInput; validMarkdown: string }
}
const initialInputs = publicInitialInputs as unknown as PublicInitialInputsFixture
const roots: string[] = []
const live: Array<{ root: string; stage: ReturnType<typeof createFoundationRevision>; handle: RevisionHandle }> = []

afterEach(async () => {
  for (const { root, stage, handle } of live.splice(0)) {
    await stage.stop({ handle, requestId: `test-cleanup-${crypto.randomUUID()}`, reason: 'shutdown' })
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

function backendResult(input: BeeGameUsageBillingRecordInput, id: string): BeeGameUsageBillingRecordResult {
  const usage = input.usage
  return {
    duplicate: false,
    event: { id, idempotencyKey: input.idempotencyKey, userId: 'owner', sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}), ...(input.projectId ? { projectId: input.projectId } : {}),
      pricingVersion: input.pricingVersion ?? 'weighted-v1', usageSource: input.usageSource ?? 'runtime_snapshot', usage,
      delta: usage, weightedTokens: usage.total_tokens, weightedTokensDelta: usage.total_tokens,
      creditsMicro: usage.total_tokens, createdAt: '2026-09-06T00:00:00.000Z', metadata: input.metadata ?? {} },
    cumulativeUsage: usage, cumulativeWeightedTokens: usage.total_tokens, creditsMicro: usage.total_tokens,
  }
}

function billing() {
  const authority: BeeGameUsageBillingClient = {
    async recordUsage(_ownerId, input) { return backendResult(input, 'record-event') },
    async debitRealTimeUsage(_ownerId, input) { return backendResult(input, 'debit-event') },
  }
  return createUsageBillingClient({ ownerId: 'owner', billingClient: authority })
}

function runtime(body: string): RuntimeConfigurationClient & { calls: () => number } {
  let calls = 0
  return {
    protocolVersion: 1,
    ownerId: 'owner',
    async resolve() {
      calls += 1
      return {
        command: [process.execPath, join(import.meta.dir, 'native-file-revision.ts'), 'valid', Buffer.from(body).toString('base64')],
        env: { OPENAI_API_KEY: 'offline-unused-secret-sentinel' },
      }
    },
    calls: () => calls,
  } as RuntimeConfigurationClient & { calls: () => number }
}

function requestInput(requestId: string): { start: RevisionStartInput; validMarkdown: string } {
  const fixture = structuredClone(initialInputs.lifecycle)
  fixture.start.requestId = requestId
  fixture.start.inputDigest = foundationRevisionInputDigest({ ownerId: fixture.start.ownerId, projectId: fixture.start.projectId, input: fixture.start.input })
  return fixture
}

async function waitFor(stage: ReturnType<typeof createFoundationRevision>, handle: RevisionHandle): Promise<RevisionResult> {
  const deadline = Date.now() + 10_000
  let latest: RevisionResult | undefined
  while (Date.now() < deadline) {
    latest = await stage.getResult(handle)
    if (latest.status === 'completed' && latest.billingStatus === 'settled') return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`lifecycle did not reach expected state: ${latest?.status ?? 'unknown'}`)
}

test('public lifecycle preserves native document metadata and replays exact bytes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-metadata-')))
  roots.push(root)
  const documents = reviewFixtureDocuments()
  const sourceUpdatedAt = '2026-08-13T01:00:00.000Z'
  documents[0]!.content = `---\ndocument_id: GDD\nversion: 1.0.0\nupdated_at: ${sourceUpdatedAt}\n---\n# incomplete`
  const sourceResult = buildSingleReviewFixture({
    documents,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'metadata-review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) },
  })
  const requests = requestInput('metadata-lifecycle-request')
  requests.start.input.sourceResult = sourceResult
  requests.start.input.sourceBinding = {
    ownerId: sourceResult.ownerId,
    projectId: sourceResult.projectId,
    resultId: sourceResult.resultId,
    resultDigest: revisionDigest(sourceResult),
  }
  requests.start.inputDigest = foundationRevisionInputDigest({
    ownerId: requests.start.ownerId,
    projectId: requests.start.projectId,
    input: requests.start.input,
  })
  const validMarkdown = `---\ndocument_id: GDD\nversion: 1.0.0\nupdated_at: ${sourceUpdatedAt}\n---\n${initialInputs.lifecycle.validMarkdown}`
  const configured = runtime(validMarkdown)
  const first = createFoundationRevision({ workspacePath: root }, { runtimeConfiguration: configured, billing: billing() })
  const handle = await first.start(requests.start)
  live.push({ root, stage: first, handle })
  const completed = await waitFor(first, handle)
  expect(completed.status).toBe('completed')
  if (completed.status !== 'completed') return
  expect(completed.result.documents[0]!.content).toBe(validMarkdown)
  expect(await first.start(requests.start)).toEqual(handle)
  expect(await first.getResult(handle)).toEqual(completed)
  expect(configured.calls()).toBe(1)
})
