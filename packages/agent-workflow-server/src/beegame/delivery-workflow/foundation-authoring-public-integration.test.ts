import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BeeGameUsageBillingClient, BeeGameUsageBillingRecordInput, BeeGameUsageBillingRecordResult } from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { createFoundationAuthoringHost } from '../foundation-authoring-host'
import { createFoundationAuthoringLink } from './foundation-authoring-link'
import { createDeliveryWorkflowController } from './controller'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'

// The only executable is a deterministic, network-free protocol fixture.
// No old controller, dispatcher or worker adapter participates in these runs.
async function fixture() {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'author-public-link-')))
  const ownerId = 'fixture-owner'
  const store = createRunStore(workspacePath, ownerId)
  const brief = 'Public author and orchestration integration fixture'
  const run: DeliveryRun = {
    ...createInitialDeliveryRun({ ownerId, projectId: 'fixture-project', confirmedBriefContext: brief,
      confirmedBriefDigest: createHash('sha256').update(brief).digest('hex') }),
    phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING',
  }
  await store.commit(run, { runId: run.runId, type: 'run.created', phase: run.phase, status: run.status, revision: run.revision })
  let token: string | undefined = 'offline-authenticated-fixture'
  let authCalls = 0
  let configurationCalls = 0
  const usageCalls: { method: 'record' | 'debit'; ownerId: string; input: BeeGameUsageBillingRecordInput }[] = []
  function receipt(value: BeeGameUsageBillingRecordInput, method: string): BeeGameUsageBillingRecordResult {
    return {
      duplicate: false,
      event: { id: `${method}:${value.idempotencyKey}`, idempotencyKey: value.idempotencyKey, userId: ownerId,
        sessionId: value.sessionId, projectId: value.projectId, turnId: value.turnId,
        pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot', usage: value.usage, delta: value.usage,
        weightedTokens: 2, weightedTokensDelta: 2, creditsMicro: 2, createdAt: '2026-09-06T00:00:00.000Z', metadata: value.metadata ?? {} },
      cumulativeUsage: value.usage, cumulativeWeightedTokens: 2, creditsMicro: 2,
    }
  }
  const billingClient: BeeGameUsageBillingClient = {
    async recordUsage(requestedOwner, value) {
      usageCalls.push({ method: 'record', ownerId: requestedOwner, input: structuredClone(value) })
      return receipt(value, 'record')
    },
    async debitRealTimeUsage(requestedOwner, value) {
      usageCalls.push({ method: 'debit', ownerId: requestedOwner, input: structuredClone(value) })
      return receipt(value, 'debit')
    },
  }
  const author = createFoundationAuthoringHost({ ownerId, workspacePath, dataDir: workspacePath,
    modelConfigId: 'fixture-model', billingClient,
    getCredential: () => ({ async getValidAccessToken() { authCalls++; return token } }),
    async getRuntimeEnv(dataDir, requestedOwner, accessToken, modelConfigId) {
      configurationCalls++
      expect(dataDir).toBe(workspacePath)
      expect(requestedOwner).toBe(ownerId)
      expect(accessToken).toBe('offline-authenticated-fixture')
      expect(modelConfigId).toBe('fixture-model')
      return {}
    },
    command: [process.execPath, fileURLToPath(new URL('../stage-modules/foundation-authoring/private/test-fixtures/native-author.ts', import.meta.url))],
  })
  const bridge = createFoundationAuthoringLink({ store, author, pollIntervalMs: 60_000 })
  async function settle(active = bridge): Promise<DeliveryRun> {
    for (let attempt = 0; attempt < 500; attempt++) {
      const current = await active.ensureProgress(run)
      if (current.status !== 'running') return current
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('Offline public integration did not settle')
  }
  async function cleanup() {
    bridge.dispose()
    const current = await store.load()
    if (current?.authorStage?.handle && current.authorStage.status === 'running')
      await author.stop({ handle: current.authorStage.handle, requestId: 'fixture-cleanup', reason: 'Offline fixture cleanup' })
  }
  return { workspacePath, ownerId, run, store, author, bridge, settle, cleanup, usageCalls,
    set token(value: string | undefined) { token = value },
    get authCalls() { return authCalls }, get configurationCalls() { return configurationCalls } }
}

test('real public author plus foundation clients publishes eight documents through the orchestration link', async () => {
  const f = await fixture()
  try {
    await f.bridge.start(f.run)
    const completed = await f.settle()
    expect(completed.authorStage!.status).toBe('completed')
    expect(completed.status).toBe('needs_action')
    expect(completed.phase).toBe('DOCUMENT_REVIEW')
    expect(completed.foundationAuditState).toBeUndefined()
    expect(completed.foundationDraftState).toEqual({ completedPaths: [] })
    expect(completed.activeDispatch).toBeUndefined()
    const result = completed.authorStage!.result!
    expect(result.documents.map(document => document.path)).toEqual([...CANONICAL_FOUNDATION_DOCUMENTS])
    for (const document of result.documents) {
      const bytes = await readFile(join(f.workspacePath, document.artifactPath))
      expect(bytes.byteLength).toBe(document.byteLength)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(document.digest)
    }
    expect(f.authCalls).toBe(1)
    expect(f.configurationCalls).toBe(1)
    expect(f.usageCalls.filter(call => call.method === 'record')).toHaveLength(1)
    expect(f.usageCalls.filter(call => call.method === 'debit')).toHaveLength(1)
    for (const record of f.usageCalls.filter(call => call.method === 'record')) {
      expect(record.ownerId).toBe(f.ownerId)
      expect(record.input.projectId).toBe(f.run.projectId)
      expect(record.input.usage.total_tokens).toBe(16)
      const debit = f.usageCalls.find(call => call.method === 'debit' && call.input.idempotencyKey === record.input.idempotencyKey)
      expect(debit?.input).toEqual(record.input)
    }
    const calls = f.usageCalls.length
    f.bridge.dispose()
    const recovered = createFoundationAuthoringLink({ store: f.store, author: f.author, pollIntervalMs: 60_000 })
    try {
      expect((await recovered.ensureProgress(f.run)).authorStage!.result).toEqual(result)
      await recovered.resume(f.run)
      expect(f.authCalls).toBe(1)
      expect(f.usageCalls).toHaveLength(calls)
      expect((await f.store.load())!.foundationAuditState).toBeUndefined()
    } finally { recovered.dispose() }
  } finally { await f.cleanup() }
}, 15_000)

test('missing authentication pauses the real author without loading configuration; explicit retry uses restored credentials', async () => {
  const f = await fixture()
  try {
    f.token = undefined
    await f.bridge.start(f.run)
    const failed = await f.settle()
    expect(failed.status).toBe('needs_action')
    expect(failed.authorStage!.result).toBeUndefined()
    expect(f.configurationCalls).toBe(0)
    expect(f.usageCalls).toHaveLength(0)
    const attempts = f.authCalls
    await f.bridge.ensureProgress(f.run)
    expect(f.authCalls).toBe(attempts)
    f.token = 'offline-authenticated-fixture'
    await f.bridge.resume(f.run)
    const completed = await f.settle()
    expect(completed.authorStage!.handle).toEqual(failed.authorStage!.handle)
    expect(completed.authorStage!.status).toBe('completed')
    expect(completed.foundationAuditState).toBeUndefined()
    expect(f.configurationCalls).toBe(1)
  } finally { await f.cleanup() }
}, 15_000)

test('production controller drives the real public author through the authenticated host without legacy workers', async () => {
  const f = await fixture()
  f.bridge.dispose()
  let legacyCalls = 0
  const unused = async (): Promise<never> => { legacyCalls++; throw new Error('Legacy worker must not execute Author') }
  const controller = createDeliveryWorkflowController({ workspacePath: f.workspacePath, ownerId: f.ownerId,
    author: f.author, workerPort: { start: unused, submit: unused, stop: unused, status: unused } })
  try {
    await controller.start(f.run)
    let current = (await f.store.load())!
    for (let attempt = 0; attempt < 500 && current.status === 'running'; attempt++) {
      await controller.ensureProgress(f.run)
      current = (await f.store.load())!
      if (current.status === 'running') await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(current.authorStage!.status).toBe('completed')
    expect(current.authorStage!.result!.documents).toHaveLength(8)
    expect(current.status).toBe('needs_action')
    expect(current.foundationAuditState).toBeUndefined()
    expect(current.foundationDraftState).toEqual({ completedPaths: [] })
    await controller.resume(f.run)
    expect((await f.store.load())!.status).toBe('needs_action')
    expect(f.authCalls).toBe(1)
    expect(legacyCalls).toBe(0)
  } finally { await controller.dispose(); await f.cleanup() }
}, 15_000)
