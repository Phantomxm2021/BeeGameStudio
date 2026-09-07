import { describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FROZEN_DOCUMENTS } from './test-fixtures/frozen-documents'
import { createAuthorLifecycle } from './lifecycle'
import { authorDigest, type AuthorConfiguration, type AuthorHandle, type AuthorResult } from './contract'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './domain/types'
import type { AuthorRuntime, AuthorRuntimeExecuteInput } from './runtime/runtime'
import type { UsageBillingClient, UsageBillingInput } from '../../../../billing/public'
import { createAuthorPersistence } from './persistence'
import type { AuthorCheckpoint } from './checkpoint'

const pause = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms))
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  for (let index = 0; index < 400; index++) { const value = await read(); if (ready(value)) return value; await pause() }
  throw new Error('Timed out waiting for private author fixture')
}
async function config(): Promise<AuthorConfiguration> {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'author-lifecycle-')))
  return { workspacePath, privateRootPath: join(workspacePath, '.beegame/workflow/foundation-authoring/state'), model: { command: ['fake-native'], env: {} } }
}
function request(requestId = 'start-1') {
  const input = { confirmedBrief: 'Lifecycle fixed brief', confirmedBriefDigest: createHash('sha256').update('Lifecycle fixed brief').digest('hex') }
  return { protocolVersion: 1 as const, requestId, ownerId: 'owner', projectId: 'project', input,
    inputDigest: authorDigest({ ownerId: 'owner', projectId: 'project', input }) }
}
function nativeFixture() {
  const calls: FoundationDocumentPath[] = []
  const executions: Array<{ path: FoundationDocumentPath; dispatchId: string; resumeSessionId?: string }> = []
  let active = 0
  let peak = 0
  let hold = false
  let lateAfterStop = false
  let failure: FoundationDocumentPath | undefined
  let held: Array<() => void> = []
  const factory = (): AuthorRuntime => {
    let stopped = false
    let usage = { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }
    let rejectHeld: ((error: Error) => void) | undefined
    return {
      async execute(input: AuthorRuntimeExecuteInput) {
        const path = String(input.prompt).match(/Author exactly one complete raw Markdown body for (docs\/[^.]+\.md)\./)?.[1] as FoundationDocumentPath
        if (!CANONICAL_FOUNDATION_DOCUMENTS.includes(path)) throw new Error('Unexpected author prompt')
        calls.push(path); active++; peak = Math.max(peak, active)
        executions.push({ path, dispatchId: input.dispatchId, resumeSessionId: input.resumeSessionId })
        usage = { prompt_tokens: 1, completion_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 2 }
        try {
          await input.onNativeSessionId?.(randomUUID())
          if (hold) await new Promise<void>((resolve, reject) => { held.push(resolve); rejectHeld = reject })
          else await pause(15)
          if ((stopped && !lateAfterStop) || failure === path) throw new Error('fixture failure containing SECRET must not escape')
          const body = FROZEN_DOCUMENTS[path]
          for (const message of [
            { type: 'stream_event', event: { type: 'message_start', message: { id: randomUUID() } } },
            { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
            { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: body } } },
            { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
            { type: 'result', subtype: 'success', is_error: false },
          ]) await input.onMessage?.(message)
          const usage = { prompt_tokens: 1, completion_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 2 }
          return { usage, turnUsage: usage, markdown: body, terminal: { kind: 'completed', markdown: body, terminalDigest: 'fixture' } }
        } finally { active-- }
      },
      getUsageSnapshot() { return { ...usage } },
      stop() { stopped = true; if (!lateAfterStop) rejectHeld?.(new Error('fixture stopped')) },
      dispose() { stopped = true; rejectHeld?.(new Error('fixture disposed')) },
    }
  }
  return { factory, calls, executions, release() { const pending = held; held = []; for (const resume of pending) resume() },
    get heldCount() { return held.length },
    get peak() { return peak }, set hold(value: boolean) { hold = value }, set lateAfterStop(value: boolean) { lateAfterStop = value }, set failure(value: FoundationDocumentPath | undefined) { failure = value } }
}
const terminal = (value: AuthorResult) => value.status !== 'running'

describe('independent author lifecycle, offline native fixture', () => {
  for (const phase of ['initial', 'parallel'] as const) {
    test(`lost ${phase} native processes require explicit retry and never resume historical sessions`, async () => {
      const fixture = nativeFixture(); fixture.hold = true
      const configuration = await config()
      const store = createAuthorPersistence({ rootPath: configuration.privateRootPath })
      const stage = createAuthorLifecycle(configuration, fixture.factory)
      const handle = await stage.start(request())
      await until(async () => fixture.heldCount, count => count === 1)
      if (phase === 'parallel') {
        fixture.release() // GDD, then Level are dependency predecessors.
        await until(async () => fixture.heldCount, count => count === 1)
        fixture.release()
        await until(async () => fixture.heldCount, count => count === 2)
      }
      const checkpoint = (await store.load<AuthorCheckpoint>(handle.id))!
      const completedPaths = [...checkpoint.context.foundationDraftState.completedPaths]
      const interrupted = checkpoint.context.foundationDraftState.documents
        ? checkpoint.context.foundationDraftState.documents.flatMap(doc => doc.dispatch?.status === 'running' ? [doc.dispatch] : [])
        : [checkpoint.context.activeDispatch!]
      expect(interrupted).toHaveLength(phase === 'initial' ? 1 : 2)
      for (const dispatch of interrupted) expect(checkpoint.sessions[dispatch.dispatchId]).toBeDefined()
      const controlKey = authorDigest(['author-control', handle.id])
      const originalControl = await store.load(controlKey)
      const countBefore = fixture.calls.length
      // Quiesce every fake process before reconstructing a crash snapshot.
      // This is not a concurrent mutation of a live execution checkpoint.
      await stage.stop({ handle, requestId: 'quiesce-lost-processes', reason: 'Reconstruct offline process loss' })
      await store.save(handle.id, checkpoint)
      await store.save(controlKey, originalControl)
      const rebuilt = createAuthorLifecycle(configuration, fixture.factory)
      expect((await rebuilt.getResult(handle)).status).toBe('running')
      expect(fixture.calls).toHaveLength(countBefore)
      await rebuilt.resume({ handle, requestId: 'observe-recovery' })
      expect((await until(() => rebuilt.getResult(handle), value => value.status !== 'running')).status).toBe('needs_action')
      expect(fixture.calls).toHaveLength(countBefore)
      const unavailable = (await store.load<AuthorCheckpoint>(handle.id))!
      expect(unavailable.context.foundationDraftState.completedPaths).toEqual(completedPaths)
      // An already-observed control is not a new retry request.
      await rebuilt.resume({ handle, requestId: 'observe-recovery' })
      expect((await rebuilt.getResult(handle)).status).toBe('needs_action')
      expect(fixture.calls).toHaveLength(countBefore)
      fixture.hold = false
      await rebuilt.resume({ handle, requestId: 'explicit-fresh-retry' })
      expect((await until(() => rebuilt.getResult(handle), value => value.status === 'completed')).status).toBe('completed')
      for (const path of completedPaths) expect(fixture.calls.filter(value => value === path)).toHaveLength(1)
      for (const previous of interrupted) {
        const retry = fixture.executions.slice(countBefore).find(value => value.path === previous.taskId)
        expect(retry).toBeDefined()
        expect(retry!.dispatchId).not.toBe(previous.dispatchId)
      }
      expect(fixture.executions.every(value => value.resumeSessionId === undefined)).toBe(true)
      expect(fixture.calls).toHaveLength(8 + interrupted.length)
    })
  }
  test('parallel stop drains late successful callbacks without admitting their documents', async () => {
    const fixture = nativeFixture(); fixture.hold = true
    const configuration = await config()
    const store = createAuthorPersistence({ rootPath: configuration.privateRootPath })
    const stage = createAuthorLifecycle(configuration, fixture.factory)
    const handle = await stage.start(request())
    await until(async () => fixture.heldCount, count => count === 1)
    fixture.release()
    await until(async () => fixture.heldCount, count => count === 1)
    fixture.release()
    await until(async () => fixture.heldCount, count => count === 2)
    const checkpoint = (await store.load<AuthorCheckpoint>(handle.id))!
    const completed = checkpoint.context.foundationDraftState.completedPaths
    const bytes = await Promise.all(completed.map(path => readFile(join(configuration.workspacePath, path), 'utf8')))
    fixture.lateAfterStop = true
    const stop = { handle, requestId: 'parallel-late-stop', reason: 'User requested stop' }
    const stopped = stage.stop(stop)
    const controlKey = authorDigest(['author-control', handle.id])
    await until(() => store.load<{ action: string }>(controlKey), control => control?.action === 'stop')
    // Deliberately emit successful streams after durable stop intent, before
    // the stop acknowledgment. No canonical commit may admit these streams.
    fixture.release()
    expect((await stopped).status).toBe('stopped')
    expect((await store.load<AuthorCheckpoint>(handle.id))!.context.foundationDraftState.completedPaths).toEqual(completed)
    for (let index = 0; index < completed.length; index++)
      expect(await readFile(join(configuration.workspacePath, completed[index]!), 'utf8')).toBe(bytes[index])
    for (const path of ['docs/BALANCE_DESIGN.md', 'docs/UI_UX_SPEC.md'])
      await expect(readFile(join(configuration.workspacePath, path))).rejects.toThrow()
    fixture.hold = false
    fixture.lateAfterStop = false
    await stage.resume({ handle, requestId: 'resume-after-late-drain' })
    await stage.stop(stop)
    expect((await until(() => stage.getResult(handle), value => value.status === 'completed')).status).toBe('completed')
    for (const path of completed) expect(fixture.calls.filter(value => value === path)).toHaveLength(1)
    expect(fixture.calls).toHaveLength(10)
  })
  test('a second instance observes a live invocation without claiming duplicate native work', async () => {
    const fixture = nativeFixture(); fixture.hold = true
    const configuration = await config()
    const first = createAuthorLifecycle(configuration, fixture.factory)
    const handle = await first.start(request())
    await until(async () => fixture.heldCount, count => count === 1)
    const second = createAuthorLifecycle(configuration, fixture.factory)
    expect(await second.start(request())).toEqual(handle)
    await second.resume({ handle, requestId: 'second-instance-observe' })
    expect((await second.getResult(handle)).status).toBe('running')
    expect(fixture.calls).toHaveLength(1)
    fixture.hold = false
    fixture.release()
    const result = await until(() => second.getResult(handle), value => value.status === 'completed')
    expect(result.status).toBe('completed')
    expect(fixture.calls).toHaveLength(8)
    expect(new Set(fixture.executions.map(value => value.dispatchId)).size).toBe(8)
  })
  test('rebuild after artifact publication but before result checkpoint preserves the exact completed result', async () => {
    const fixture = nativeFixture()
    const configuration = await config()
    const store = createAuthorPersistence({ rootPath: configuration.privateRootPath })
    const first = createAuthorLifecycle(configuration, fixture.factory)
    const handle = await first.start(request())
    const original = await until(() => first.getResult(handle), value => value.status === 'completed')
    // stop awaits lease release even when the completed result is immutable.
    await first.stop({ handle, requestId: 'quiesce-published', reason: 'Offline publication crash reconstruction' })
    const checkpoint = (await store.load<AuthorCheckpoint>(handle.id))!
    expect(checkpoint.result).toBeDefined()
    const { result: published, ...withoutResult } = checkpoint
    await store.save(handle.id, { ...withoutResult, context: { ...checkpoint.context, status: 'running' } })
    const rebuilt = createAuthorLifecycle(configuration, fixture.factory)
    expect((await rebuilt.getResult(handle)).status).toBe('running')
    await rebuilt.resume({ handle, requestId: 'recover-published-result' })
    const restored = await until(() => rebuilt.getResult(handle), value => value.status === 'completed')
    expect(restored).toEqual(original)
    expect(restored.status === 'completed' && restored.result).toEqual(published!)
    expect(fixture.calls).toHaveLength(8)
  })
  test('owns all eight authors and returns one immutable final result across repeated starts', async () => {
    const fixture = nativeFixture()
    const configuration = await config()
    const stage = createAuthorLifecycle(configuration, fixture.factory)
    const handles = await Promise.all([stage.start(request()), stage.start(request())])
    expect(handles[0]).toEqual(handles[1])
    const result = await until(() => stage.getResult(handles[0]!), terminal)
    expect(result.status).toBe('completed')
    expect(fixture.calls[0]).toBe('docs/GDD.md')
    expect(new Set(fixture.calls).size).toBe(8)
    expect(fixture.calls.length).toBe(8)
    expect(fixture.peak).toBeGreaterThan(1)
    expect(fixture.peak).toBeLessThanOrEqual(4)
    const otherInstance = createAuthorLifecycle(configuration, fixture.factory)
    expect(await otherInstance.start(request())).toEqual(handles[0])
    expect(await otherInstance.getResult(handles[0]!)).toEqual(result)
    if (result.status === 'completed') result.result.documents.length = 0
    const unchanged = await stage.getResult(handles[0]!)
    expect(unchanged.status === 'completed' && unchanged.result.documents.length).toBe(8)
  })
  test('rejects conflicting start identity without dispatching again', async () => {
    const fixture = nativeFixture(); fixture.hold = true
    const stage = createAuthorLifecycle(await config(), fixture.factory)
    const handle = await stage.start(request())
    const changed = request(); changed.input.confirmedBrief += ' changed'
    changed.input.confirmedBriefDigest = createHash('sha256').update(changed.input.confirmedBrief).digest('hex')
    changed.inputDigest = authorDigest({ ownerId: changed.ownerId, projectId: changed.projectId, input: changed.input })
    await expect(stage.start(changed)).rejects.toThrow('conflicts')
    expect((await stage.stop({ handle, requestId: 'stop-1', reason: 'test stop' })).status).toBe('stopped')
  })
  test('stops an in-flight author, resumes privately, and does not replay an old stop', async () => {
    const fixture = nativeFixture(); fixture.hold = true
    const configuration = await config()
    const stage = createAuthorLifecycle(configuration, fixture.factory)
    const handle = await stage.start(request())
    await until(async () => fixture.calls.length, value => value === 1)
    const stop = { handle, requestId: 'stop-1', reason: 'user requested stop' }
    expect((await stage.stop(stop)).status).toBe('stopped')
    fixture.hold = false
    await stage.resume({ handle, requestId: 'resume-1' })
    await stage.stop(stop)
    const result = await until(() => stage.getResult(handle), value => value.status === 'completed' || value.status === 'needs_action')
    expect(result.status).toBe('completed')
    expect(fixture.calls.length).toBe(9)
  })
  test('retains accepted documents when one author fails and retries only actionable work', async () => {
    const fixture = nativeFixture(); fixture.failure = 'docs/LEVEL_SCENE_DESIGN.md'
    const stage = createAuthorLifecycle(await config(), fixture.factory)
    const handle: AuthorHandle = await stage.start(request())
    const failed = await until(() => stage.getResult(handle), terminal)
    expect(failed.status).toBe('needs_action')
    expect(JSON.stringify(failed)).not.toContain('SECRET')
    fixture.failure = undefined
    await stage.resume({ handle, requestId: 'retry-1' })
    const final = await until(() => stage.getResult(handle), value => value.status === 'completed')
    expect(final.status).toBe('completed')
    expect(fixture.calls.filter(path => path === 'docs/GDD.md').length).toBe(1)
    expect(fixture.calls.filter(path => path === 'docs/LEVEL_SCENE_DESIGN.md').length).toBe(2)
  })
  test('stopped and failed model turns submit their observed usage to the unified billing client', async () => {
    const fixture = nativeFixture(); fixture.hold = true
    const calls: UsageBillingInput[] = []
    const billing: UsageBillingClient = { protocolVersion: 1, ownerId: 'owner', async submitUsage(input) {
      calls.push(structuredClone(input))
      return { protocolVersion: 1, ownerId: 'owner', eventId: input.eventId, idempotencyKey: input.eventId,
        pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot', usage: input.usage, duplicate: false, skipped: true }
    } }
    const stage = createAuthorLifecycle(await config(), fixture.factory, { billing })
    const handle = await stage.start(request())
    await until(async () => fixture.calls.length, value => value === 1)
    expect((await stage.stop({ handle, requestId: 'stop-usage', reason: 'test stop' })).billingStatus).toBe('settled')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.usage.total_tokens).toBe(2)
    fixture.hold = false; fixture.failure = 'docs/GDD.md'
    await stage.resume({ handle, requestId: 'failed-turn' })
    await until(() => stage.getResult(handle), value => value.status === 'needs_action')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.usage.total_tokens).toBe(2)
    expect(calls[1]!.eventId).not.toBe(calls[0]!.eventId)
  })
  test('billing outage leaves final documents completed; read-only getResult does not retry pending billing', async () => {
    const fixture = nativeFixture(); const configuration = await config()
    const calls: UsageBillingInput[] = []; let unavailable = true
    const billing: UsageBillingClient = { protocolVersion: 1, ownerId: 'owner', async submitUsage(input) {
      calls.push(structuredClone(input))
      if (unavailable) throw new Error('SECRET billing outage')
      return { protocolVersion: 1, ownerId: 'owner', eventId: input.eventId, idempotencyKey: input.eventId,
        pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot', usage: input.usage, duplicate: false, skipped: true }
    } }
    const stage = createAuthorLifecycle(configuration, fixture.factory, { billing })
    const handle = await stage.start(request())
    const result = await until(() => stage.getResult(handle), terminal)
    expect(result.status).toBe('completed'); expect(result.billingStatus).toBe('pending')
    const before = calls.length
    await stage.getResult(handle); expect(calls).toHaveLength(before)
    unavailable = false
    const recovered = createAuthorLifecycle(configuration, fixture.factory, { billing })
    await recovered.resume({ handle, requestId: 'billing-replay' })
    expect((await until(() => recovered.getResult(handle), value => value.billingStatus === 'settled')).status).toBe('completed')
    expect(fixture.calls).toHaveLength(8)
    const replayed = calls.slice(before)
    expect(replayed).toHaveLength(8)
    for (const input of replayed) expect(calls.slice(0, before).some(original => JSON.stringify(original) === JSON.stringify(input))).toBe(true)
  })
  test('explicit resume recovers the original committed receipt before clearing a lost-checkpoint dispatch', async () => {
    const fixture = nativeFixture(); fixture.hold = true
    const configuration = await config()
    const store = createAuthorPersistence({ rootPath: configuration.privateRootPath })
    const stage = createAuthorLifecycle(configuration, fixture.factory)
    const handle = await stage.start(request())
    await until(async () => fixture.heldCount, value => value === 1)
    const beforeCommit = (await store.load<AuthorCheckpoint>(handle.id))!
    const controlKey = authorDigest(['author-control', handle.id])
    const originalControl = await store.load(controlKey)
    fixture.release()
    await until(async () => fixture.calls.length, value => value > 1)
    await stage.stop({ handle, requestId: 'quiesce-fixture', reason: 'Quiesce all fixture processes before crash reconstruction' })
    // Reconstruct a crash after GDD receipt/journal commit but before its
    // checkpoint write. No worker remains alive while disk is reconstructed.
    beforeCommit.context.status = 'needs_action'
    beforeCommit.context.blockedReason = 'Interrupted fixture execution'
    await store.save(handle.id, beforeCommit)
    await store.save(controlKey, originalControl)
    fixture.hold = false
    const recovered = createAuthorLifecycle(configuration, fixture.factory)
    await recovered.resume({ handle, requestId: 'resume-crash' })
    const result = await until(() => recovered.getResult(handle), value => value.status === 'completed')
    expect(result.status).toBe('completed')
    expect(fixture.calls.filter(path => path === 'docs/GDD.md')).toHaveLength(1)
  })
  test('a durable resume awaiting execution is public running, not its predecessor stopped result', async () => {
    const fixture = nativeFixture(); fixture.hold = true
    const configuration = await config()
    const store = createAuthorPersistence({ rootPath: configuration.privateRootPath })
    const stage = createAuthorLifecycle(configuration, fixture.factory)
    const handle = await stage.start(request())
    await until(async () => fixture.heldCount, value => value === 1)
    await stage.stop({ handle, requestId: 'stop-before-resume', reason: 'Offline pending-control fixture' })
    const command = { handle, requestId: 'resume-after-stop' }
    const before = await store.load<AuthorCheckpoint>(handle.id)
    await store.withLock(handle.id, async () => {
      await stage.resume(command)
      expect((await stage.getResult(handle)).status).toBe('running')
      expect((await stage.getResult(handle)).status).toBe('running')
      expect(await store.load<AuthorCheckpoint>(handle.id)).toEqual(before)
      expect(fixture.calls).toHaveLength(1)
    })
    fixture.hold = false
    await stage.resume(command)
    expect((await until(() => stage.getResult(handle), terminal)).status).toBe('completed')
  })
})
