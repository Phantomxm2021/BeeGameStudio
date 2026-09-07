import { afterEach, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
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
import { prepareRevisionRequest } from '../request-preparation'
import { revisionDigest } from '../json-digest'
import { openRevisionAttemptStore } from '../attempt-store'
import { openRevisionExecutionLease } from '../execution-lease'
import { readRevisionRequestByHandle } from '../request-store'
import type { RuntimeConfigurationClient } from '../../../../../runtime-configuration/public'
import publicFollowupInputs from './fixtures/public-followup-inputs.json'

const roots: string[] = []
const live: Array<{
  root: string
  stage: ReturnType<typeof createFoundationRevision>
  handle: RevisionHandle
}> = []
type PublicDocumentPath = 'docs/GDD.md' | 'docs/LEVEL_SCENE_DESIGN.md' | 'docs/BALANCE_DESIGN.md' | 'docs/TECHNICAL_DESIGN.md' |
  'docs/ART_DIRECTION.md' | 'docs/UI_UX_SPEC.md' | 'docs/AUDIO_DESIGN.md' | 'docs/ASSET_PLAN.md'
type PublicDocument = { path: PublicDocumentPath; content: string; digest: string; byteLength: number }
type PublicSourceResult = {
  resultId: string
  documentSetDigest: string
  documents: PublicDocument[]
  issues: Array<{ issue: { id: string; remediation: { documentPath: string } } }>
}
type PublicBinding = { ownerId: string; projectId: string; resultId: string; resultDigest: string }
type PublicNextRoundInput = {
  kind: 'next_round'
  sourceResult: PublicSourceResult
  sourceBinding: PublicBinding
}
type PublicFollowupInputs = {
  retry: {
    input: {
      kind: 'retry_same_round'
      sourceResult: PublicSourceResult
      sourceBinding: PublicBinding
      previousCandidateResult: { candidateId: string; documents: PublicDocument[] }
      previousCandidateBinding: PublicBinding
      previousRecheckResult: unknown
      previousRecheckBinding: PublicBinding
    }
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
    await stage.stop({
      handle,
      requestId: `next-round-cleanup-${crypto.randomUUID()}`,
      reason: 'shutdown',
    })
    const deadline = Date.now() + 5000
    let closed = false
    while (Date.now() < deadline) {
      try {
        const registration = await readRevisionRequestByHandle(
          root,
          handle.id,
          'owner',
        )
        const store = await openRevisionAttemptStore(
          root,
          registration.prepared.request,
          {
            readOnlyHandle: handle.id,
          },
        )
        const lease = await openRevisionExecutionLease(
          root,
          registration.prepared.request,
          {
            readOnlyHandle: handle.id,
          },
        )
        const state = await store.readRequest()
        // needs_action is not closure evidence; both the durable active set and
        // the private execution lease must be closed before removing this root.
        if (
          state.activeAttemptIds.length === 0 &&
          (await lease.status()) === 'free'
        ) {
          closed = true
          break
        }
      } catch {
        /* The owner may still be finishing its stop acknowledgement. */
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(closed).toBe(true)
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})

function nextRoundFixture() {
  const fixture = structuredClone(followupInputs.nextRound)
  const input = fixture.input
  const sourceResult = input.sourceResult
  const request = {
    ...input,
    ownerId: 'owner',
    projectId: 'project',
    requestId: 'public-next-round',
  }
  const plan = prepareRevisionRequest(request)
  if (plan.round !== 2 || plan.batches.length !== 1)
    throw new Error('next-round request did not plan one round-two repair')
  const batch = plan.batches[0]
  if (
    !batch ||
    batch.scope !== 'section' ||
    batch.documentPath !== 'docs/TECHNICAL_DESIGN.md'
  )
    throw new Error(
      'next-round fixture did not produce the expected Technical section batch',
    )

  const start: RevisionStartInput = {
    protocolVersion: 1,
    requestId: request.requestId,
    ownerId: request.ownerId,
    projectId: request.projectId,
    inputDigest: foundationRevisionInputDigest({
      ownerId: request.ownerId,
      projectId: request.projectId,
      input,
    }),
    input,
  }
  return {
    sourceResult,
    start,
    plan,
    previousCandidateId: fixture.previousCandidateId,
    previousIssueIds: fixture.previousIssueIds,
    sectionText: fixture.sectionText,
  }
}

function backendResult(
  input: BeeGameUsageBillingRecordInput,
  id: string,
): BeeGameUsageBillingRecordResult {
  const usage = input.usage
  return {
    duplicate: false,
    event: {
      id,
      idempotencyKey: input.idempotencyKey,
      userId: 'owner',
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      pricingVersion: input.pricingVersion ?? 'weighted-v1',
      usageSource: input.usageSource ?? 'runtime_snapshot',
      usage,
      delta: usage,
      weightedTokens: usage.total_tokens,
      weightedTokensDelta: usage.total_tokens,
      creditsMicro: usage.total_tokens,
      createdAt: '2026-09-07T00:00:00.000Z',
      metadata: input.metadata ?? {},
    },
    cumulativeUsage: usage,
    cumulativeWeightedTokens: usage.total_tokens,
    creditsMicro: usage.total_tokens,
  }
}

function infrastructure(body: string) {
  let runtimeCalls = 0
  const runtimeConfiguration: RuntimeConfigurationClient = {
    protocolVersion: 1,
    ownerId: 'owner',
    async resolve() {
      runtimeCalls += 1
      return {
        // This is the fixed local Bun fixture process; no model/network service
        // is involved in this public lifecycle test.
        command: [
          process.execPath,
          join(import.meta.dir, 'lifecycle-followup-fixture.ts'),
          'valid',
          Buffer.from(body).toString('base64'),
        ],
        env: { OPENAI_API_KEY: 'offline-unused-secret-sentinel' },
      }
    },
  }
  const authority: BeeGameUsageBillingClient = {
    async recordUsage(_ownerId, input) {
      return backendResult(input, 'record-event')
    },
    async debitRealTimeUsage(_ownerId, input) {
      return backendResult(input, 'debit-event')
    },
  }
  return {
    runtimeConfiguration,
    billing: createUsageBillingClient({
      ownerId: 'owner',
      billingClient: authority,
    }),
    runtimeCalls: () => runtimeCalls,
  }
}

async function waitFor(
  stage: ReturnType<typeof createFoundationRevision>,
  handle: RevisionHandle,
  predicate: (result: RevisionResult) => boolean,
  timeout = 5000,
) {
  const deadline = Date.now() + timeout
  let latest: RevisionResult | undefined
  while (Date.now() < deadline) {
    latest = await stage.getResult(handle)
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(
    `next-round lifecycle did not reach expected state: ${latest?.status ?? 'unknown'}`,
  )
}

test('public next-round continues from new review issues, retains the prior candidate, and leaves canonical bytes untouched', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'revision-next-round-')),
  )
  roots.push(root)
  const fixture = nextRoundFixture()
  await mkdir(join(root, 'docs'), { recursive: true })
  const canonical = new Map<string, string>()
  for (const document of fixture.sourceResult.documents) {
    const path = join(root, document.path)
    const bytes = `canonical-${document.path}`
    canonical.set(path, bytes)
    await writeFile(path, bytes)
  }

  expect(fixture.sourceResult.issues).toHaveLength(1)
  expect(fixture.sourceResult.issues[0]!.issue.remediation.documentPath).toBe(
    'docs/TECHNICAL_DESIGN.md',
  )
  expect(
    new Set(fixture.previousIssueIds).has(
      fixture.sourceResult.issues[0]!.issue.id,
    ),
  ).toBe(false)
  expect(fixture.plan.retainedDocumentPaths).toEqual([])
  expect(
    fixture.plan.staging.documents.find(
      document => document.path === 'docs/GDD.md',
    )?.content,
  ).toBe(
    fixture.sourceResult.documents.find(
      document => document.path === 'docs/GDD.md',
    )?.content,
  )

  const infra = infrastructure(fixture.sectionText)
  const stage = createFoundationRevision(
    { workspacePath: root },
    {
      runtimeConfiguration: infra.runtimeConfiguration,
      billing: infra.billing,
    },
  )
  const handle = await stage.start(fixture.start)
  live.push({ root, stage, handle })

  const duplicate = await stage.start(structuredClone(fixture.start))
  expect(duplicate).toEqual(handle)
  const completed = await waitFor(
    stage,
    handle,
    result =>
      result.status === 'completed' && result.billingStatus === 'settled',
  )
  expect(completed.status).toBe('completed')
  if (completed.status !== 'completed') return

  expect(completed.result.round).toBe(2)
  expect(completed.result.candidateId).not.toBe(
    fixture.previousCandidateId,
  )
  expect(completed.result.sourceReviewResultId).toBe(
    fixture.sourceResult.resultId,
  )
  expect(completed.result.sourceReviewResultDigest).toBe(
    revisionDigest(fixture.sourceResult),
  )
  expect(completed.result.baseDocumentSetDigest).toBe(
    fixture.sourceResult.documentSetDigest,
  )
  expect(completed.result.previous).toBeUndefined()
  expect(completed.result.repairClaims.map(claim => claim.issueId)).toEqual(
    fixture.plan.repairIssueIds,
  )
  expect(completed.result.unresolvedIssues).toEqual([])

  const retainedPath = 'docs/GDD.md'
  expect(
    completed.result.documents.find(document => document.path === retainedPath)
      ?.content,
  ).toBe(
    fixture.sourceResult.documents.find(
      document => document.path === retainedPath,
    )?.content,
  )
  expect(
    completed.result.documents.find(
      document => document.path === 'docs/TECHNICAL_DESIGN.md',
    )?.content,
  ).toContain('technical.supported_actions: ["move","attack","dash","parry"]')
  for (const sourceDocument of fixture.sourceResult.documents) {
    if (sourceDocument.path === 'docs/TECHNICAL_DESIGN.md') continue
    expect(
      completed.result.documents.find(
        document => document.path === sourceDocument.path,
      ),
    ).toEqual(sourceDocument)
  }

  const replay = await stage.start(structuredClone(fixture.start))
  expect(replay).toEqual(handle)
  expect(await stage.getResult(handle)).toEqual(completed)
  expect(infra.runtimeCalls()).toBe(1)
  for (const [path, bytes] of canonical)
    expect(await readFile(path, 'utf8')).toBe(bytes)
})
