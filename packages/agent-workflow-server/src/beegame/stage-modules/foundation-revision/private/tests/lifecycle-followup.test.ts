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
import publicFollowupInputs from './fixtures/public-followup-inputs.json'

const roots: string[] = []
const live: Array<{ root: string; stage: ReturnType<typeof createFoundationRevision>; handle: RevisionHandle }> = []
type PublicDocumentPath = 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md' | 'docs/BALANCE_DESIGN.md' | 'docs/TECHNICAL_DESIGN.md' |
  'docs/ART_DIRECTION.md' | 'docs/UI_UX_SPEC.md' | 'docs/AUDIO_DESIGN.md' | 'docs/ASSET_PLAN.md'
type PublicDocument = { path: PublicDocumentPath; content: string; digest: string; byteLength: number }
type PublicSourceResult = {
  resultId: string
  documentSetDigest: string
  documents: PublicDocument[]
  issues: Array<{ issue: { id: string; remediation: { documentPath: string } } }>
}
type PublicCandidateResult = { candidateId: string; documents: PublicDocument[] }
type PublicBinding = { ownerId: string; projectId: string; resultId: string; resultDigest: string }
type PublicRetryInput = {
  kind: 'retry_same_round'
  sourceResult: PublicSourceResult
  sourceBinding: PublicBinding
  previousCandidateResult: PublicCandidateResult
  previousCandidateBinding: PublicBinding
  previousRecheckResult: unknown
  previousRecheckBinding: PublicBinding
}
type PublicNextRoundInput = {
  kind: 'next_round'
  sourceResult: PublicSourceResult
  sourceBinding: PublicBinding
}
type PublicFollowupInputs = {
  retry: {
    input: PublicRetryInput
    sectionText: string
  }
  nextRound: {
    input: PublicNextRoundInput
    previousCandidateId: string
    previousIssueIds: string[]
    sectionText: string
  }
}
const followupInputs = publicFollowupInputs as unknown as PublicFollowupInputs

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
      if (state.activeAttemptIds.length === 0 && await leases.status() === 'free') { closed = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(closed).toBe(true)
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function retryFixture() {
  const fixture = structuredClone(followupInputs.retry)
  const sourceResult = fixture.input.sourceResult as unknown as {
    issues: Array<{ issue: Record<string, unknown> }>
    issueRegistryDigest: string
    resultId: string
  }
  const recheckResult = fixture.input.previousRecheckResult as {
    issues: Array<{ issue: Record<string, unknown> }>
    issueRegistryDigest: string
    resultId: string
    inputDigest: string
    ownerId: string
    projectId: string
    documentSetDigest: string
    subject: Record<string, unknown>
    recheck?: { candidateResultDigest?: string }
  }
  for (const result of [sourceResult, recheckResult]) {
    for (const entry of result.issues)
      if (entry.issue.type === 'semantic' && !('supportingSections' in entry.issue)) entry.issue.supportingSections = []
    result.issueRegistryDigest = revisionDigest(result.issues.map(entry => entry.issue))
    const { resultId: _ignored, ...body } = result
    result.resultId = revisionDigest(body)
  }
  const candidate = fixture.input.previousCandidateResult as unknown as {
    candidateId: string
    documents: Array<{ path: string; content: string }>
    sourceReviewResultId: string
    sourceReviewResultDigest: string
    resultId: string
  }
  candidate.sourceReviewResultId = sourceResult.resultId
  candidate.sourceReviewResultDigest = revisionDigest(sourceResult)
  const { resultId: _candidateResultId, ...candidateBody } = candidate
  candidate.resultId = revisionDigest(candidateBody)
  const recheckSubject = recheckResult.subject
  recheckSubject.sourceReviewResultId = sourceResult.resultId
  recheckSubject.sourceReviewResultDigest = revisionDigest(sourceResult)
  recheckSubject.candidateResultId = candidate.resultId
  recheckSubject.candidateId = (candidate as unknown as { candidateId: string }).candidateId
  recheckResult.inputDigest = revisionDigest({ ownerId: recheckResult.ownerId, projectId: recheckResult.projectId,
    subject: recheckSubject, documentSetDigest: recheckResult.documentSetDigest })
  const recheckEvidence = recheckResult.recheck
  if (recheckEvidence) recheckEvidence.candidateResultDigest = revisionDigest(candidate)
  const { resultId: _recheckResultId, ...recheckBody } = recheckResult
  recheckResult.resultId = revisionDigest(recheckBody)
  const input = {
    ...fixture.input,
    sourceResult,
    sourceBinding: { ...fixture.input.sourceBinding, resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) },
    previousCandidateResult: candidate,
    previousCandidateBinding: { ...fixture.input.previousCandidateBinding, resultId: candidate.resultId, resultDigest: revisionDigest(candidate) },
    previousRecheckResult: recheckResult,
    previousRecheckBinding: { ...fixture.input.previousRecheckBinding, resultId: recheckResult.resultId, resultDigest: revisionDigest(recheckResult) },
  }
  const request = { ...input, ownerId: 'owner', projectId: 'project', requestId: 'public-followup-retry' }
  const plan = prepareRevisionRequest(request)
  const batch = plan.batches[0]
  if (!batch || batch.scope !== 'section' || batch.documentPath !== 'docs/UI_UX_SPEC.md') throw new Error('follow-up fixture did not produce one UI section batch')
  return { input, request, plan, previousCandidateResult: input.previousCandidateResult, sectionText: fixture.sectionText }
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
    return { command: [process.execPath, join(import.meta.dir, 'lifecycle-followup-fixture.ts'), 'valid', Buffer.from(body).toString('base64')],
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

test('public same-round retry retains PASS bytes and publishes only the authorized failed repair', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-followup-retry-')))
  roots.push(root)
  const fixture = retryFixture()
  const digest = foundationRevisionInputDigest({ ownerId: 'owner', projectId: 'project', input: fixture.input })
  const start: RevisionStartInput = { protocolVersion: 1, requestId: fixture.request.requestId, ownerId: 'owner',
    projectId: 'project', inputDigest: digest, input: fixture.input }
  const plan = fixture.plan
  const batch = plan.batches[0]!
  const infra = infrastructure(fixture.sectionText)
  const stage = createFoundationRevision({ workspacePath: root }, { runtimeConfiguration: infra.runtimeConfiguration, billing: infra.billing })
  const handle = await stage.start(start)
  live.push({ root, stage, handle })
  const result = await waitFor(stage, handle, value => value.status === 'completed' && value.billingStatus === 'settled')
  expect(result.status).toBe('completed')
  if (result.status !== 'completed') return
  expect(result.result.round).toBe(1)
  expect(result.result.previous?.candidateId).toBe(fixture.previousCandidateResult.candidateId)
  expect(result.result.documents.find(document => document.path === 'docs/GDD.md')!.content)
    .toBe(fixture.previousCandidateResult.documents.find(document => document.path === 'docs/GDD.md')!.content)
  expect(result.result.documents.find(document => document.path === batch.documentPath)!.content)
    .toContain('Navigation feedback implemented.')
  expect(result.result.repairClaims.map(claim => claim.issueId)).toEqual(plan.repairIssueIds)
  expect(result.result.unresolvedIssues).toEqual([])
  expect(infra.runtimeCalls()).toBe(1)
})
