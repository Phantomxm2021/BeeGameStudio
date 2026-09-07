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
import { createFoundationRevision, foundationRevisionInputDigest,
  type RevisionHandle, type RevisionResult, type RevisionStartInput } from '../../public'
import type { RuntimeConfigurationClient } from '../../../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../../../billing/public'
import { readRevisionRequestByHandle } from '../request-store'
import { openRevisionExecutionLease } from '../execution-lease'
import { openRevisionAttemptStore } from '../attempt-store'
import { revisionDigest } from '../json-digest'
import publicInitialInputs from './fixtures/public-initial-inputs.json'

const documentPath = 'docs/GDD.md' as const
const roots: string[] = []
const live: Array<{ root: string; stage: ReturnType<typeof createFoundationRevision>; handle: RevisionHandle }> = []
type PublicInitialInputsFixture = {
  lifecycle: { start: RevisionStartInput; validMarkdown: string }
  infrastructure: { start: RevisionStartInput; validMarkdown: string }
}
const initialInputs = publicInitialInputs as unknown as PublicInitialInputsFixture

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
      if (state.activeAttemptIds.length === 0 && await leases.status() === 'free') { closed = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(closed).toBe(true)
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function requestInput(requestId = 'lifecycle-request') {
  const fixture = structuredClone(initialInputs.lifecycle)
  fixture.start.requestId = requestId
  return fixture
}

function backendResult(input: BeeGameUsageBillingRecordInput, id: string, duplicate = false): BeeGameUsageBillingRecordResult {
  const usage = input.usage
  return {
    duplicate,
    event: { id, idempotencyKey: input.idempotencyKey, userId: 'owner', sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}), ...(input.projectId ? { projectId: input.projectId } : {}),
      pricingVersion: input.pricingVersion ?? 'weighted-v1', usageSource: input.usageSource ?? 'runtime_snapshot', usage, delta: usage,
      weightedTokens: usage.total_tokens, weightedTokensDelta: usage.total_tokens, creditsMicro: usage.total_tokens,
      createdAt: '2026-09-06T00:00:00.000Z', metadata: input.metadata ?? {} },
    cumulativeUsage: usage, cumulativeWeightedTokens: usage.total_tokens, creditsMicro: usage.total_tokens,
  }
}

function billing(options: { failRecord?: () => boolean; failDebit?: () => boolean } = {}) {
  const calls: string[] = []
  const authority: BeeGameUsageBillingClient = {
    async recordUsage(_ownerId, input) {
      calls.push(`record:${input.idempotencyKey}`)
      if (options.failRecord?.()) throw new Error('record unavailable')
      return backendResult(input, 'record-event', calls.filter(call => call.startsWith('record:')).length > 1)
    },
    async debitRealTimeUsage(_ownerId, input) {
      calls.push(`debit:${input.idempotencyKey}`)
      if (options.failDebit?.()) throw new Error('debit unavailable')
      return backendResult(input, 'debit-event', calls.filter(call => call.startsWith('debit:')).length > 1)
    },
  }
  return { client: createUsageBillingClient({ ownerId: 'owner', billingClient: authority }), calls }
}

function runtime(options: { mode?: 'valid' | 'wait'; ready?: string; resolve?: () => boolean; body?: string } = {}) {
  let calls = 0
  const client: RuntimeConfigurationClient = {
    protocolVersion: 1,
    ownerId: 'owner',
    async resolve() {
      calls += 1
      if (options.resolve?.()) throw new Error('runtime authorization unavailable')
      const command = [process.execPath, join(import.meta.dir, 'owned-attempt-fixture.ts'), options.mode ?? 'valid',
        Buffer.from(options.body ?? initialInputs.lifecycle.validMarkdown).toString('base64')]
      if (options.ready) command.push(options.ready)
      return { command, env: { OPENAI_API_KEY: 'offline-unused-secret-sentinel' } }
    },
  }
  return { client, calls: () => calls }
}

function stage(root: string, infrastructure: { runtimeConfiguration: RuntimeConfigurationClient; billing: UsageBillingClient }) {
  return createFoundationRevision({ workspacePath: root }, infrastructure)
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
  throw new Error(`lifecycle did not reach expected state: ${latest?.status ?? 'unknown'}`)
}

function remember(root: string, stageValue: ReturnType<typeof createFoundationRevision>, handle: RevisionHandle) {
  live.push({ root, stage: stageValue, handle })
  return handle
}

test('completes, reopens, and replays idempotently without caller mutation or respawn', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-complete-')))
  roots.push(root)
  const requests = requestInput()
  const configured = runtime()
  const charged = billing()
  const first = stage(root, { runtimeConfiguration: configured.client, billing: charged.client })
  const original = structuredClone(requests.start)
  const pending = first.start(requests.start)
  ;(requests.start.input.sourceResult as { documents: { content: string }[] }).documents[0]!.content = '# caller mutation'
  const handle = remember(root, first, await pending)
  const completed = await waitFor(first, handle, result => result.status === 'completed' && result.billingStatus === 'settled')
  expect(completed.status).toBe('completed')
  const duplicate = await first.start(original)
  expect(duplicate).toEqual(handle)
  const reopened = stage(root, { runtimeConfiguration: configured.client, billing: charged.client })
  const replay = await reopened.getResult(handle)
  expect(replay).toEqual(completed)
  if (completed.status === 'completed') {
    completed.result.documents[0]!.content = '# returned mutation'
    expect((await reopened.getResult(handle)).status).toBe('completed')
    const unchanged = await reopened.getResult(handle)
    if (unchanged.status === 'completed') expect(unchanged.result.documents[0]!.content).toBe(requests.validMarkdown.trim())
  }
  expect(configured.calls()).toBe(1)
})

test('two public instances share one durable execution and one runtime authorization', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-concurrent-')))
  roots.push(root)
  const requests = requestInput('concurrent-request')
  const configured = runtime()
  const charged = billing()
  const infrastructure = { runtimeConfiguration: configured.client, billing: charged.client }
  const left = stage(root, infrastructure)
  const right = stage(root, infrastructure)
  const [leftHandle, rightHandle] = await Promise.all([left.start(requests.start), right.start(requests.start)])
  remember(root, left, leftHandle)
  remember(root, right, rightHandle)
  expect(leftHandle).toEqual(rightHandle)
  const result = await waitFor(left, leftHandle, value => value.status === 'completed' && value.billingStatus === 'settled')
  expect(result.status).toBe('completed')
  expect(configured.calls()).toBe(1)
})

test('remote stop waits for the owned child, then resume starts a fresh valid attempt', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-stop-')))
  roots.push(root)
  const ready = join(root, 'wait-ready')
  const requests = requestInput('stop-request')
  const configured = runtime({ mode: 'wait', ready })
  const charged = billing()
  const first = stage(root, { runtimeConfiguration: configured.client, billing: charged.client })
  const handle = remember(root, first, await first.start(requests.start))
  const deadline = Date.now() + 5000
  let readySeen = false
  while (Date.now() < deadline) {
    try { readySeen = await readFile(ready, 'utf8') === 'ready'; if (readySeen) break }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  expect(readySeen).toBe(true)
  const resumedRuntime = runtime()
  const remote = stage(root, { runtimeConfiguration: resumedRuntime.client, billing: charged.client })
  remember(root, remote, handle)
  const stopped = await remote.stop({ handle, requestId: 'user-stop', reason: 'user_requested' })
  expect(['stopped', 'needs_action']).toContain(stopped.status)
  await waitFor(remote, handle, result => result.status === 'stopped')
  const resumed = await remote.resume({ handle, requestId: 'resume-after-stop' })
  expect(['running', 'completed', 'needs_action']).toContain(resumed.status)
  await waitFor(remote, handle, result => result.status === 'completed' && result.billingStatus === 'settled')
  expect(configured.calls()).toBe(1)
  expect(resumedRuntime.calls()).toBe(1)
}, 15_000)

test('configuration authorization failure creates no attempt and resume can continue', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-auth-')))
  roots.push(root)
  const requests = requestInput('auth-request')
  let unavailable = true
  const configured = runtime({ resolve: () => unavailable })
  const charged = billing()
  const first = stage(root, { runtimeConfiguration: configured.client, billing: charged.client })
  const handle = remember(root, first, await first.start(requests.start))
  const blocked = await waitFor(first, handle, result => result.status === 'needs_action' && result.resumable)
  expect(blocked.status).toBe('needs_action')
  unavailable = false
  const resumed = await first.resume({ handle, requestId: 'resume-auth-request' })
  expect(['running', 'completed']).toContain(resumed.status)
  await waitFor(first, handle, result => result.status === 'completed' && result.billingStatus === 'settled')
  expect(configured.calls()).toBe(2)
})

test('billing failure leaves completed work pending and resume retries billing without runtime replay', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-billing-')))
  roots.push(root)
  const requests = requestInput('billing-request')
  let unavailable = true
  const configured = runtime()
  const charged = billing({ failRecord: () => unavailable })
  const first = stage(root, { runtimeConfiguration: configured.client, billing: charged.client })
  const handle = remember(root, first, await first.start(requests.start))
  const pending = await waitFor(first, handle, result => result.status === 'completed' && result.billingStatus === 'pending')
  expect(pending.status).toBe('completed')
  unavailable = false
  const resumed = await first.resume({ handle, requestId: 'resume-billing-request' })
  expect(['completed', 'needs_action']).toContain(resumed.status)
  await waitFor(first, handle, result => result.status === 'completed' && result.billingStatus === 'settled')
  expect(configured.calls()).toBe(1)
})

test('public input, owner, and error boundaries reject malformed data without leaking infrastructure details', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-invalid-')))
  roots.push(root)
  const requests = requestInput('invalid-request')
  const configured = runtime()
  const charged = billing()
  const first = stage(root, { runtimeConfiguration: configured.client, billing: charged.client })
  await expect(first.start({ ...requests.start, inputDigest: '0'.repeat(64) })).rejects.toThrow('could not be accepted')
  const foreign = { ...requests.start, ownerId: 'foreign', inputDigest: foundationRevisionInputDigest({ ownerId: 'foreign', projectId: 'project', input: requests.start.input }) }
  await expect(first.start(foreign)).rejects.toThrow('could not be accepted')
  const invalidHandle = { protocolVersion: 1, producer: 'foundation-revision', id: 'not-a-uuid' }
  await expect(first.getResult(invalidHandle as never)).rejects.toThrow('could not be accepted')
  expect(JSON.stringify(charged.calls)).not.toContain('offline-unused-secret-sentinel')
})

test('accepted billing continuation is not lost while another instance still owns the completion tail', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-tail-')))
  roots.push(root)
  const requests = requestInput('tail-request')
  let unavailable = true
  const configured = runtime()
  const charged = billing({ failRecord: () => unavailable })
  const first = stage(root, { runtimeConfiguration: configured.client, billing: charged.client })
  const handle = remember(root, first, await first.start(requests.start))
  await waitFor(first, handle, result => result.status === 'completed' && result.billingStatus === 'pending')
  const registration = await readRevisionRequestByHandle(root, handle.id, 'owner')
  const leases = await openRevisionExecutionLease(root, registration.prepared.request)
  const deadline = Date.now() + 5000
  while (await leases.status() !== 'free' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  const tail = await leases.acquire()
  if (tail.kind !== 'owned') throw new Error('test completion tail was not acquired')
  try {
    unavailable = false
    const remote = stage(root, { runtimeConfiguration: configured.client, billing: charged.client })
    remember(root, remote, handle)
    await remote.resume({ handle, requestId: 'resume-held-tail' })
    await new Promise(resolve => setTimeout(resolve, 150))
    expect((await remote.getResult(handle)).billingStatus).toBe('pending')
    await tail.release()
    await waitFor(remote, handle, result => result.status === 'completed' && result.billingStatus === 'settled')
    expect(configured.calls()).toBe(1)
  } finally { await tail.release() }
}, 15_000)

test('public document repair remains an open retry loop beyond two failed attempts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-retry-')))
  roots.push(root)
  const requests = requestInput('open-retry-request')
  let calls = 0
  const runtimeConfiguration: RuntimeConfigurationClient = { protocolVersion: 1, ownerId: 'owner', async resolve() {
    calls += 1
    const body = calls <= 3 ? '# invalid document body' : requests.validMarkdown
    return { command: [process.execPath, join(import.meta.dir, 'owned-attempt-fixture.ts'), 'valid', Buffer.from(body).toString('base64')], env: {} }
  } }
  const charged = billing()
  const first = stage(root, { runtimeConfiguration, billing: charged.client })
  const handle = remember(root, first, await first.start(requests.start))
  await waitFor(first, handle, result => result.status === 'completed' && result.billingStatus === 'settled', 10_000)
  expect(calls).toBe(4)
  expect(new Set(charged.calls.filter(call => call.startsWith('record:'))).size).toBe(4)
}, 15_000)

test('detached public bundle executes and reopens a complete Revision without source-runtime imports', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'revision-lifecycle-detached-')))
  roots.push(root)
  // Keep compiler state independent of the long-running backend suite, just
  // like the Reviewer detached test. The bundle still includes all runtime
  // dependencies and is actually executed and reopened below.
  const buildScript = `const built = await Bun.build(${JSON.stringify({ entrypoints: [join(import.meta.dir, '../../public.ts')],
    target: 'bun', format: 'esm', outdir: root, naming: 'revision-detached.mjs' })});
    if (!built.success || built.outputs.length !== 1) { console.error(built.logs); process.exit(1); }`
  const compiler = Bun.spawn([process.execPath, '--eval', buildScript], {
    cwd: root, env: {}, stdout: 'pipe', stderr: 'pipe', timeout: 5000, killSignal: 'SIGKILL',
  })
  const [buildCode, buildOutput, buildErrors] = await Promise.all([
    compiler.exited, new Response(compiler.stdout).text(), new Response(compiler.stderr).text(),
  ])
  expect(buildCode).toBe(0)
  expect(buildOutput).toBe('')
  expect(buildErrors).toBe('')
  const bundlePath = join(root, 'revision-detached.mjs')
  const detached = await import(bundlePath) as typeof import('../../public')
  expect(Object.keys(detached).sort()).toEqual(['createFoundationRevision', 'foundationRevisionInputDigest'])
  const requests = requestInput('detached-request')
  const configured = runtime()
  const charged = billing()
  const first = detached.createFoundationRevision({ workspacePath: root }, { runtimeConfiguration: configured.client, billing: charged.client })
  const handle = remember(root, first, await first.start(requests.start))
  const completed = await waitFor(first, handle, result => result.status === 'completed' && result.billingStatus === 'settled')
  const reopened = detached.createFoundationRevision({ workspacePath: root }, { runtimeConfiguration: configured.client, billing: charged.client })
  expect(await reopened.getResult(handle)).toEqual(completed)
  expect(await reopened.start(requests.start)).toEqual(handle)
  expect(configured.calls()).toBe(1)
}, 15_000)
