import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BeeGameUsageBillingClient,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { createAuthenticationClient } from '../../../../../auth/public'
import { createUsageBillingClient } from '../../../../../billing/public'
import { createRuntimeConfigurationClient } from '../../../../../runtime-configuration/public'
import {
  createFoundationRevision,
  type RevisionHandle,
  type RevisionResult,
  type RevisionStartInput,
} from '../../public'
import { openRevisionExecutionLease } from '../execution-lease'
import { openRevisionAttemptStore } from '../attempt-store'
import { readRevisionRequestByHandle } from '../request-store'
import publicInitialInputs from './fixtures/public-initial-inputs.json'

const ownerId = 'p3-6-owner'
const projectId = 'p3-6-project'
const roots: string[] = []
const live: Array<{
  root: string
  stage: ReturnType<typeof createFoundationRevision>
  handle: RevisionHandle
}> = []
type PublicInitialInputsFixture = {
  lifecycle: { start: RevisionStartInput; validMarkdown: string }
  infrastructure: { start: RevisionStartInput; validMarkdown: string }
}
const initialInputs = publicInitialInputs as unknown as PublicInitialInputsFixture

afterEach(async () => {
  for (const { root, stage, handle } of live.splice(0)) {
    await stage.stop({
      handle,
      requestId: `p3-6-cleanup-${crypto.randomUUID()}`,
      reason: 'shutdown',
    })
    const deadline = Date.now() + 5000
    let free = false
    while (Date.now() < deadline) {
      const registration = await readRevisionRequestByHandle(root, handle.id, ownerId)
      const lease = await openRevisionExecutionLease(
        root,
        registration.prepared.request,
        { readOnlyHandle: handle.id },
      )
      const store = await openRevisionAttemptStore(
        root,
        registration.prepared.request,
        { readOnlyHandle: handle.id },
      )
      const state = await store.readRequest()
      if (state.activeAttemptIds.length === 0 && await lease.status() === 'free') {
        free = true
        break
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(free).toBe(true)
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function requestInput(requestId: string): RevisionStartInput {
  const fixture = structuredClone(initialInputs.infrastructure)
  fixture.start.requestId = requestId
  return fixture.start
}

function billingResult(
  input: BeeGameUsageBillingRecordInput,
  id: string,
): BeeGameUsageBillingRecordResult {
  const usage = { ...input.usage }
  return {
    duplicate: false,
    event: {
      id,
      idempotencyKey: input.idempotencyKey,
      userId: ownerId,
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

function billing() {
  const calls: Array<{ ownerId: string; eventId: string; kind: 'record' | 'debit' }> = []
  const authority: BeeGameUsageBillingClient = {
    async recordUsage(userId, input) {
      calls.push({ ownerId: userId, eventId: input.idempotencyKey, kind: 'record' })
      return billingResult(input, `record-${calls.length}`)
    },
    async debitRealTimeUsage(userId, input) {
      calls.push({ ownerId: userId, eventId: input.idempotencyKey, kind: 'debit' })
      return billingResult(input, `debit-${calls.length}`)
    },
  }
  return {
    client: createUsageBillingClient({ ownerId, billingClient: authority }),
    calls,
  }
}

async function waitFor(
  stage: ReturnType<typeof createFoundationRevision>,
  handle: RevisionHandle,
  predicate: (result: RevisionResult) => boolean,
  timeout = 10_000,
) {
  const deadline = Date.now() + timeout
  let latest: RevisionResult | undefined
  while (Date.now() < deadline) {
    latest = await stage.getResult(handle)
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`P3.6 lifecycle did not reach expected state: ${latest?.status ?? 'unknown'}`)
}

test('real public auth and runtime configuration gate dispatch, then explicit resume completes Revision', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-infrastructure-p3-6-')))
  roots.push(root)
  const request = requestInput('p3-6-request')
  const nativeBody = initialInputs.infrastructure.validMarkdown
  const command = [
    process.execPath,
    join(import.meta.dir, 'owned-attempt-fixture.ts'),
    'valid',
    Buffer.from(nativeBody).toString('base64'),
  ]
  let authenticationAvailable = false
  let credentialCalls = 0
  const credential = {
    async getValidAccessToken() {
      credentialCalls += 1
      return authenticationAvailable ? 'p3-6-access-token' : undefined
    },
  }
  const authentication = createAuthenticationClient({ ownerId, credential })
  const repositoryCalls: Array<{
    dataDir: string
    ownerId: string
    token: string
    modelConfigId: string | undefined
  }> = []
  const runtimeConfiguration = createRuntimeConfigurationClient({
    ownerId,
    dataDir: root,
    modelConfigId: 'p3-6-model-config',
    authentication,
    repository: {
      async getRuntimeEnv(dataDir, requestedOwnerId, token, modelConfigId) {
        if (typeof dataDir !== 'string' || typeof requestedOwnerId !== 'string' || typeof token !== 'string') {
          throw new Error('runtime repository fixture received an incomplete owner binding')
        }
        repositoryCalls.push({
          dataDir,
          ownerId: requestedOwnerId,
          token,
          modelConfigId,
        })
        return {
          BEEGAME_P3_6_MARKER: 'repository-config',
          OPENAI_API_KEY: 'offline-unused-secret-sentinel',
        }
      },
    },
    command,
    runtime: { modelType: 'openai', env: { BEEGAME_P3_6_RUNTIME: 'runtime-config' } },
  })
  const charged = billing()
  const stage = createFoundationRevision(
    { workspacePath: root },
    { runtimeConfiguration, billing: charged.client },
  )
  const handle = await stage.start(request)
  live.push({ root, stage, handle })

  const blocked = await waitFor(
    stage,
    handle,
    result => result.status === 'needs_action' && result.resumable,
  )
  expect(blocked.status).toBe('needs_action')
  expect(credentialCalls).toBeGreaterThan(0)
  // Authentication failed before the runtime public client reached its
  // repository or returned a command, so no native dispatch was possible.
  expect(repositoryCalls).toEqual([])
  expect(charged.calls).toEqual([])
  const registration = await readRevisionRequestByHandle(root, handle.id, ownerId)
  const attempts = await openRevisionAttemptStore(
    root,
    registration.prepared.request,
    { readOnlyHandle: handle.id },
  )
  expect((await attempts.readRequest()).activeAttemptIds).toEqual([])
  const gdd = await attempts.read('docs/GDD.md')
  expect(gdd.active).toBeNull()
  expect(gdd.attempt).toBe(0)
  expect(gdd.lastReceipt).toBeNull()
  expect(gdd.eventCount).toBe(0)

  authenticationAvailable = true
  const resumed = await stage.resume({ handle, requestId: 'p3-6-explicit-resume' })
  expect(['running', 'completed']).toContain(resumed.status)
  const completed = await waitFor(
    stage,
    handle,
    result => result.status === 'completed' && result.billingStatus === 'settled',
  )
  expect(completed.status).toBe('completed')
  expect(repositoryCalls.length).toBeGreaterThan(0)
  expect(repositoryCalls.every(call => call.dataDir === root)).toBe(true)
  expect(repositoryCalls.every(call => call.ownerId === ownerId)).toBe(true)
  expect(repositoryCalls.every(call => call.token === 'p3-6-access-token')).toBe(true)
  expect(repositoryCalls.every(call => call.modelConfigId === 'p3-6-model-config')).toBe(true)
  expect(charged.calls.length).toBeGreaterThan(0)
  expect(charged.calls.every(call => call.ownerId === ownerId)).toBe(true)

  const resolved = await runtimeConfiguration.resolve({ ownerId })
  expect(resolved.command).toEqual(command)
  expect(resolved.env).toMatchObject({
    BEEGAME_P3_6_MARKER: 'repository-config',
    BEEGAME_P3_6_RUNTIME: 'runtime-config',
    BEEGAME_MODEL_TYPE: 'openai',
  })
})
