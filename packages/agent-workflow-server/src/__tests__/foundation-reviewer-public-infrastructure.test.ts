import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BeeGameUsageBillingClient,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { createAuthenticationClient } from '../auth/public'
import { createUsageBillingClient } from '../billing/public'
import { createRuntimeConfigurationClient } from '../runtime-configuration/public'
import {
  createFoundationReviewer,
  foundationReviewerInputDigest,
  type ReviewerHandle,
} from '../beegame/stage-modules/foundation-reviewer/public'
const CANONICAL_FOUNDATION_DOCUMENTS = ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md',
  'docs/TECHNICAL_DESIGN.md', 'docs/ART_DIRECTION.md', 'docs/UI_UX_SPEC.md', 'docs/AUDIO_DESIGN.md', 'docs/ASSET_PLAN.md'] as const

const ownerId = 'reviewer-public-infrastructure-owner'
const projectId = 'reviewer-public-infrastructure-project'
const modelConfigId = 'reviewer-public-model-config'
const subject = {
  kind: 'initial' as const,
  sourceResultId: 'reviewer-public-source-result',
  sourceDocumentRevision: 'a'.repeat(64),
  confirmedBriefDigest: 'b'.repeat(64),
}

type RuntimeCall = {
  dataDir: string
  ownerId: string
  token: string
  modelConfigId: string | undefined
}
type BillingCall = {
  method: 'record' | 'debit'
  ownerId: string
  input: BeeGameUsageBillingRecordInput
}

function makeInput(requestId: string, documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path,
  content: '# Offline source\nREPAIR_REQUIRED: This offline fixture contains an incomplete rule.',
}))) {
  const input = { subject, documents, requirements: { status: 'unavailable' as const, reason: 'Offline fixture' } }
  return {
    protocolVersion: 1 as const,
    requestId,
    ownerId,
    projectId,
    input,
    inputDigest: foundationReviewerInputDigest({ ownerId, projectId, input }),
  }
}

function billingResult(
  owner: string,
  input: BeeGameUsageBillingRecordInput,
  id: string,
  duplicate: boolean,
): BeeGameUsageBillingRecordResult {
  const usage = { ...input.usage }
  return {
    duplicate,
    event: {
      id,
      idempotencyKey: input.idempotencyKey,
      userId: owner,
      sessionId: input.sessionId,
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
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

function makeBillingAuthority(boundOwnerId: string) {
  const records = new Map<string, BeeGameUsageBillingRecordResult>()
  const debits = new Map<string, BeeGameUsageBillingRecordResult>()
  const calls: BillingCall[] = []
  const inputs = new Map<string, BeeGameUsageBillingRecordInput>()

  async function submit(
    method: BillingCall['method'],
    requestedOwnerId: string,
    input: BeeGameUsageBillingRecordInput,
  ) {
    if (requestedOwnerId !== boundOwnerId) throw new Error('billing authority owner mismatch')
    calls.push({ method, ownerId: requestedOwnerId, input: structuredClone(input) })
    const ledger = method === 'record' ? records : debits
    const previousInput = inputs.get(`${method}:${input.idempotencyKey}`)
    if (previousInput && JSON.stringify(previousInput) !== JSON.stringify(input)) {
      throw new Error('billing authority received conflicting event bytes')
    }
    inputs.set(`${method}:${input.idempotencyKey}`, structuredClone(input))
    const previous = ledger.get(input.idempotencyKey)
    if (previous) return { ...structuredClone(previous), duplicate: true }
    const result = billingResult(boundOwnerId, input, `${method}:${ledger.size + 1}`, false)
    ledger.set(input.idempotencyKey, structuredClone(result))
    return result
  }

  const client: BeeGameUsageBillingClient = {
    recordUsage: (requestedOwnerId, input) => submit('record', requestedOwnerId, input),
    debitRealTimeUsage: (requestedOwnerId, input) => submit('debit', requestedOwnerId, input),
  }
  return { client, records, debits, calls, inputs }
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeout = 30_000,
) {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`${label} did not settle: ${JSON.stringify(latest)}`)
}

async function makeFixture(requestId: string) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-public-infrastructure-')))
  const input = makeInput(requestId)
  await mkdir(join(workspacePath, 'docs'), { recursive: true })
  for (const document of input.input.documents) {
    await mkdir(join(workspacePath, document.path, '..'), { recursive: true })
    await writeFile(join(workspacePath, document.path), document.content)
  }
  let token: string | undefined
  let credentialCalls = 0
  const runtimeCalls: RuntimeCall[] = []
  const credential = {
    async getValidAccessToken() {
      credentialCalls += 1
      return token
    },
  }
  const authentication = createAuthenticationClient({ ownerId, credential })
  const runtimeConfiguration = createRuntimeConfigurationClient({
    ownerId,
    dataDir: workspacePath,
    modelConfigId,
    authentication,
    repository: {
      async getRuntimeEnv(dataDir, requestedOwnerId, accessToken, requestedModelConfigId) {
        if (typeof dataDir !== 'string' || typeof requestedOwnerId !== 'string' || typeof accessToken !== 'string') {
          throw new Error('fixture repository requires a complete owner binding')
        }
        runtimeCalls.push({ dataDir, ownerId: requestedOwnerId, token: accessToken, modelConfigId: requestedModelConfigId })
        return { BEEGAME_REVIEWER_REPOSITORY: 'offline-fixture' }
      },
    },
    command: [process.execPath, join(import.meta.dir, '../beegame/stage-modules/foundation-reviewer/private/test-fixtures/native-file-review.ts'), 'repair-flow'],
    runtime: {
      modelType: 'openai',
      env: {
        OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast',
        OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced',
        OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong',
      },
    },
  })
  const billingAuthority = makeBillingAuthority(ownerId)
  const billing = createUsageBillingClient({ ownerId, billingClient: billingAuthority.client })
  const reviewer = createFoundationReviewer({ workspacePath }, { runtimeConfiguration, billing })
  let handle: ReviewerHandle | undefined

  async function cleanup() {
    if (handle) {
      await reviewer.stop({ handle, requestId: `cleanup-${randomUUID()}`, reason: 'offline Reviewer fixture cleanup' })
      await waitFor(() => reviewer.getResult(handle!), result => result.status !== 'running', 'Reviewer cleanup')
    }
    await rm(workspacePath, { recursive: true, force: true })
  }

  return {
    workspacePath,
    input,
    reviewer,
    runtimeCalls,
    billing,
    billingAuthority,
    get credentialCalls() { return credentialCalls },
    setToken(value: string | undefined) { token = value },
    async setHandle(value: ReviewerHandle) { handle = value },
    cleanup,
  }
}

test('public Reviewer has no native claim or usage without authentication', async () => {
  const fixture = await makeFixture('reviewer-public-no-token')
  try {
    const handle = await fixture.reviewer.start(fixture.input)
    await fixture.setHandle(handle)
    const blocked = await waitFor(
      () => fixture.reviewer.getResult(handle),
      result => result.status === 'needs_action',
      'unauthenticated Reviewer',
    )
    expect(blocked.status).toBe('needs_action')
    if (blocked.status !== 'needs_action') throw new Error('expected public needs_action')
    expect(blocked.resumable).toBe(true)
    expect(fixture.credentialCalls).toBeGreaterThan(0)
    expect(fixture.runtimeCalls).toEqual([])
    expect(fixture.billingAuthority.calls).toEqual([])

  } finally {
    await fixture.cleanup()
  }
}, 35_000)

test('public Reviewer resumes native-file audit and publishes with idempotent billing offline', async () => {
  const fixture = await makeFixture('reviewer-public-resume')
  const before = new Map<string, string>()
  for (const document of fixture.input.input.documents) {
    before.set(document.path, await readFile(join(fixture.workspacePath, document.path), 'utf8'))
  }
  try {
    const handle = await fixture.reviewer.start(fixture.input)
    await fixture.setHandle(handle)
    const blocked = await waitFor(
      () => fixture.reviewer.getResult(handle),
      result => result.status === 'needs_action',
      'Reviewer authentication gate',
    )
    expect(blocked.status).toBe('needs_action')
    expect(fixture.runtimeCalls).toEqual([])
    expect(fixture.billingAuthority.calls).toEqual([])

    fixture.setToken('reviewer-public-offline-token')
    const resumed = await fixture.reviewer.resume({ handle, requestId: 'reviewer-public-explicit-resume' })
    expect(['running', 'completed']).toContain(resumed.status)
    const completed = await waitFor(
      () => fixture.reviewer.getResult(handle),
      result => {
        if (result.status === 'failed' || (result.status === 'needs_action' && !result.resumable))
          throw new Error(`Native-file Reviewer cannot complete: ${JSON.stringify(result)}`)
        return result.status === 'completed' && result.billingStatus === 'settled'
      },
      'public Reviewer completion',
      30_000,
    )
    expect(completed.status).toBe('completed')
    if (completed.status !== 'completed') throw new Error('expected a completed Reviewer result')
    expect(completed.result.kind).toBe('issues_found')
    expect(completed.result.audit.policy).toBe('native-file-audit.v1')
    expect(completed.result.audit).not.toHaveProperty('validation')
    expect(completed.result.documents.map(document => document.path)).toEqual(fixture.input.input.documents.map(document => document.path))
    expect(completed.result.issues.length).toBeGreaterThan(0)

    expect(fixture.runtimeCalls.length).toBeGreaterThan(0)
    expect(fixture.runtimeCalls.every(call => call.dataDir === fixture.workspacePath)).toBe(true)
    expect(fixture.runtimeCalls.every(call => call.ownerId === ownerId)).toBe(true)
    expect(fixture.runtimeCalls.every(call => call.token === 'reviewer-public-offline-token')).toBe(true)
    expect(fixture.runtimeCalls.every(call => call.modelConfigId === modelConfigId)).toBe(true)
    expect(fixture.billingAuthority.calls.length).toBeGreaterThan(0)
    expect(fixture.billingAuthority.calls.every(call => call.ownerId === ownerId)).toBe(true)
    expect(fixture.billingAuthority.calls.every(call => call.input.projectId === projectId)).toBe(true)

    const firstAuthorityInput = [...fixture.billingAuthority.records.keys()].map(key => fixture.billingAuthority.inputs.get(`record:${key}`))[0]
    if (!firstAuthorityInput) throw new Error('completed Reviewer event was not recorded by fake authority')
    const eventId = firstAuthorityInput.idempotencyKey
    const accountCount = fixture.billingAuthority.records.size + fixture.billingAuthority.debits.size
    const replay = await fixture.billing.submitUsage({
      ownerId,
      projectId,
      sessionId: firstAuthorityInput.sessionId,
      ...(firstAuthorityInput.turnId === undefined ? {} : { turnId: firstAuthorityInput.turnId }),
      eventId,
      usage: firstAuthorityInput.usage,
      ...(firstAuthorityInput.metadata === undefined ? {} : { metadata: firstAuthorityInput.metadata }),
    })
    expect(replay.duplicate).toBe(true)
    if ('skipped' in replay) throw new Error('nonzero Reviewer usage unexpectedly skipped')
    expect(replay.recorded.duplicate).toBe(true)
    expect(replay.debited.duplicate).toBe(true)
    expect(fixture.billingAuthority.records.size + fixture.billingAuthority.debits.size).toBe(accountCount)

    for (const document of fixture.input.input.documents) {
      expect(await readFile(join(fixture.workspacePath, document.path), 'utf8')).toBe(before.get(document.path)!)
    }
  } finally {
    await fixture.cleanup()
  }
}, 140_000)
