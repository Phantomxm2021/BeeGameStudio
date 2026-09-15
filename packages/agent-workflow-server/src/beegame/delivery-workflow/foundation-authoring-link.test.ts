import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { createFoundationAuthoring, AuthorResult, AuthorStartInput } from '../stage-modules/foundation-authoring/public'
import { createInitialDeliveryRun, createRunStore } from './run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'
import { createFoundationAuthoringLink } from './foundation-authoring-link'

async function fixture() {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'author-link-')))
  const store = createRunStore(workspace, 'owner')
  const brief = 'An offline orchestration fixture'
  const run: DeliveryRun = { ...createInitialDeliveryRun({ ownerId: 'owner', projectId: 'project', confirmedBriefContext: brief,
    confirmedBriefDigest: createHash('sha256').update(brief).digest('hex') }), phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING' }
  await store.commit(run, { runId: run.runId, type: 'run.created', phase: run.phase, status: run.status, revision: run.revision })
  const handle = { protocolVersion: 1 as const, producer: 'foundation-authoring' as const, id: randomUUID() }
  let outcome: AuthorResult = { status: 'running', handle }
  const starts: AuthorStartInput[] = []; const resumes: string[] = []; const stops: string[] = []
  let stopHook: (() => Promise<void>) | undefined
  const author: ReturnType<typeof createFoundationAuthoring> = {
    async start(value) { starts.push(structuredClone(value)); return handle },
    async resume(value) { resumes.push(value.requestId); if (outcome.status !== 'completed') outcome = { status: 'running', handle }; return handle },
    async stop(value) {
      // Inspect bytes, without acquiring the orchestration lease already held
      // by the caller. The fake author does not call the orchestration store.
      const durable = JSON.parse(await readFile(join(workspace, '.beegame/workflow/run.json'), 'utf8')) as DeliveryRun
      expect(durable.authorStage!.control.action).toBe('stop')
      if (!stops.length) expect(durable.status).not.toBe('stopped')
      stops.push(value.requestId)
      await stopHook?.()
      if (outcome.status !== 'completed') outcome = { status: 'stopped', handle }
      return outcome
    },
    async getResult() { return structuredClone(outcome) },
  }
  const bridge = createFoundationAuthoringLink({ store, author, pollIntervalMs: 60_000 })
  function complete() {
    const request = starts[0]!
    outcome = { status: 'completed', handle, result: { protocolVersion: 1, producer: 'foundation-authoring', kind: 'foundation_documents',
      resultId: 'a'.repeat(64), inputDigest: request.inputDigest, ownerId: request.ownerId, projectId: request.projectId,
      confirmedBriefDigest: request.input.confirmedBriefDigest, receiptSetDigest: 'b'.repeat(64), documentRevision: 'doc-revision', workspaceRevision: 'workspace-revision',
      documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: 'c'.repeat(64), byteLength: 20,
        artifactPath: `.beegame/workflow/foundation-authoring/artifacts/${'a'.repeat(64)}/${path}` })) } }
  }
  return { run, workspace, store, bridge, author, starts, resumes, stops, complete, set stopHook(value: () => Promise<void>) { stopHook = value },
    set outcome(value: AuthorResult) { outcome = value }, handle }
}

test('orchestration owns only a public invocation and pauses at the public completion handoff', async () => {
  const f = await fixture()
  try {
    const started = await f.bridge.start(f.run)
    expect(f.starts).toHaveLength(1)
    expect(started.foundationDraftState).toEqual({ completedPaths: [] })
    expect(started.activeDispatch).toBeUndefined()
    expect(Object.keys(started.authorStage!).sort()).toEqual(['control', 'handle', 'inputDigest', 'protocolVersion', 'requestId', 'status'])
    await f.bridge.start(f.run); expect(f.starts).toHaveLength(1)
    f.complete()
    const complete = await f.bridge.ensureProgress(f.run)
    expect(complete.status).toBe('needs_action')
    expect(complete.phase).toBe('DOCUMENT_REVIEW')
    expect(complete.authorStage!.status).toBe('completed')
    expect(complete.foundationDraftState).toEqual({ completedPaths: [] })
    expect(complete.foundationAuditState).toBeUndefined()
    await f.bridge.resume(complete)
    expect(f.starts).toHaveLength(1)
    expect(f.resumes).toHaveLength(0)
  } finally { f.bridge.dispose() }
})

test('orchestration persists public Author timing without reading its private attempts', async () => {
  const f = await fixture()
  try {
    await f.bridge.start(f.run)
    f.outcome = { status: 'running', handle: f.handle, timing: { currentCallElapsedMs: 123, historicalElapsedMs: 456 } }
    const projected = await f.bridge.ensureProgress(f.run)
    expect(projected.authorStage?.timing).toEqual({ currentCallElapsedMs: 123, historicalElapsedMs: 456 })
    expect((await f.store.load())?.authorStage?.timing).toEqual(projected.authorStage?.timing)
  } finally { f.bridge.dispose() }
})

test('timing-only polling does not append duplicate public-result events', async () => {
  const f = await fixture()
  try {
    await f.bridge.start(f.run)
    f.outcome = { status: 'running', handle: f.handle, timing: { currentCallElapsedMs: 123, historicalElapsedMs: 456 } }
    await f.bridge.ensureProgress(f.run)
    const before = (await readFile(join(f.workspace, '.beegame/workflow/events.jsonl'), 'utf8')).trim().split('\n').length
    f.outcome = { status: 'running', handle: f.handle, timing: { currentCallElapsedMs: 999, historicalElapsedMs: 456 } }
    const unchanged = await f.bridge.ensureProgress(f.run)
    const after = (await readFile(join(f.workspace, '.beegame/workflow/events.jsonl'), 'utf8')).trim().split('\n').length
    expect(after).toBe(before)
    expect(unchanged.authorStage?.timing).toEqual({ currentCallElapsedMs: 123, historicalElapsedMs: 456 })
  } finally { f.bridge.dispose() }
})

test('stop intent is durable before the public stop and a racing completed result cannot start review', async () => {
  const f = await fixture()
  try {
    await f.bridge.start(f.run)
    f.stopHook = async () => { f.complete() }
    const stopped = await f.bridge.stop(f.run, 'user stopped')
    expect(stopped.status).toBe('stopped')
    expect(stopped.authorStage!.result).toBeDefined()
    expect(stopped.foundationAuditState).toBeUndefined()
    expect(f.stops).toEqual([`${stopped.authorStage!.requestId}:stop:1`])
    expect(stopped.authorStage!.control.requestId).toBe(stopped.authorStage!.requestId)
  } finally { f.bridge.dispose() }
})

test('a new orchestration instance resumes only through the original opaque handle', async () => {
  const f = await fixture()
  await f.bridge.start(f.run); f.bridge.dispose()
  const recovered = createFoundationAuthoringLink({ store: f.store, author: f.author, pollIntervalMs: 60_000 })
  try {
    const current = await recovered.ensureProgress(f.run)
    expect(f.starts).toHaveLength(1)
    expect(current.authorStage!.handle).toEqual(f.handle)
    expect(f.resumes).toHaveLength(1)
    f.complete()
    expect((await recovered.ensureProgress(f.run)).authorStage!.result).toBeDefined()
  } finally { recovered.dispose() }
})

test('observing a failed author is not an implicit retry', async () => {
  const f = await fixture()
  try {
    await f.bridge.start(f.run)
    f.outcome = { status: 'needs_action', handle: f.handle, reason: 'fixture failure', resumable: true }
    expect((await f.bridge.ensureProgress(f.run)).status).toBe('needs_action')
    expect(f.resumes).toHaveLength(0)
    const resumed = await f.bridge.resume(f.run)
    expect(f.resumes).toEqual([`${resumed.authorStage!.requestId}:run:1`])
    expect(resumed.authorStage!.control.requestId).toBe(resumed.authorStage!.requestId)
  } finally { f.bridge.dispose() }
})

test('running autonomous Author projects public progress without exposing private execution state', async () => {
  const f = await fixture()
  try {
    await f.bridge.start(f.run)
    f.outcome = { status: 'running', handle: f.handle, progress: { modelResponses: 4, message: 'Working on document files' } }
    const current = await f.bridge.ensureProgress(f.run)
    expect(current.currentMessage).toContain('Working on document files')
    expect(current.currentMessage).toContain('4')
    expect(current.authorStage!.status).toBe('running')
    expect(current.foundationDraftState).toEqual({ completedPaths: [] })
    expect(current.activeDispatch).toBeUndefined()
  } finally { f.bridge.dispose() }
})

test('repeated controls retain the invocation binding and reuse the same command generation', async () => {
  const f = await fixture()
  try {
    await f.bridge.start(f.run)
    const first = await f.bridge.stop(f.run, 'user stopped')
    const second = await f.bridge.stop(f.run, 'user stopped')
    expect(second.authorStage!.control).toEqual(first.authorStage!.control)
    expect(f.stops[1]).toBe(f.stops[0])
    const resumed = await f.bridge.resume(f.run)
    const repeated = await f.bridge.resume(f.run)
    expect(repeated.authorStage!.control).toEqual(resumed.authorStage!.control)
    expect(resumed.authorStage!.control.sequence).toBe(2)
    expect(f.resumes).toEqual([`${resumed.authorStage!.requestId}:run:2`])
  } finally { f.bridge.dispose() }
})

test('a newer resume waits for an in-flight public stop before issuing its command', async () => {
  const f = await fixture()
  let release!: () => void
  let entered!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const stopping = new Promise<void>(resolve => { entered = resolve })
  try {
    await f.bridge.start(f.run)
    f.stopHook = async () => { entered(); await barrier }
    const stopped = f.bridge.stop(f.run, 'user stopped')
    await stopping
    const resumed = f.bridge.resume(f.run)
    expect(f.resumes).toHaveLength(0)
    release()
    await Promise.all([stopped, resumed])
    const current = await f.bridge.ensureProgress(f.run)
    expect(current.status).toBe('running')
    expect(current.authorStage!.control.action).toBe('run')
    expect(f.stops).toHaveLength(1)
    expect(f.resumes).toHaveLength(1)
  } finally { release?.(); f.bridge.dispose() }
})

test('an unacknowledged stop retains durable intent and never reports stopped', async () => {
  const f = await fixture()
  f.bridge.dispose()
  const bridge = createFoundationAuthoringLink({ store: f.store, author: {
    ...f.author,
    async stop() { throw new Error('offline stop unavailable') },
  }, pollIntervalMs: 60_000 })
  try {
    await bridge.start(f.run)
    await expect(bridge.stop(f.run, 'user stopped')).rejects.toThrow('offline stop unavailable')
    const pending = (await f.store.load())!
    expect(pending.authorStage!.control.action).toBe('stop')
    expect(pending.status).toBe('needs_action')
    expect(pending.authorStage!.result).toBeUndefined()
    expect(pending.foundationAuditState).toBeUndefined()
  } finally { bridge.dispose() }
})

test('an ambiguous start preserves its request and stop does not create a replacement author', async () => {
  const f = await fixture()
  f.bridge.dispose()
  const requests: AuthorStartInput[] = []
  const bridge = createFoundationAuthoringLink({ store: f.store, author: {
    ...f.author,
    async start(request) { requests.push(request); throw new Error('start acknowledgment lost') },
  }, pollIntervalMs: 60_000 })
  try {
    await expect(bridge.start(f.run)).rejects.toThrow('start acknowledgment lost')
    const ambiguous = (await f.store.load())!
    expect(ambiguous.authorStage!.requestId).toBe(requests[0]!.requestId)
    expect(ambiguous.authorStage!.handle).toBeUndefined()
    const pending = await bridge.stop(f.run, 'user stopped')
    expect(pending.status).toBe('needs_action')
    expect(pending.authorStage!.control.action).toBe('stop')
    await bridge.start(f.run)
    expect(requests).toHaveLength(1)
    expect(f.stops).toHaveLength(0)
  } finally { bridge.dispose() }
})

test('a foreign public handle is rejected without admitting a result or entering review', async () => {
  const f = await fixture()
  try {
    await f.bridge.start(f.run)
    f.outcome = { status: 'running', handle: { ...f.handle, id: randomUUID() } }
    await expect(f.bridge.ensureProgress(f.run)).rejects.toThrow('handle does not match')
    const current = (await f.store.load())!
    expect(current.phase).toBe('DOCUMENT_DRAFTING')
    expect(current.authorStage!.handle).toEqual(f.handle)
    expect(current.authorStage!.result).toBeUndefined()
    expect(current.foundationAuditState).toBeUndefined()
  } finally { f.bridge.dispose() }
})

test('background observation failure surfaces an orchestration pause without falsifying author status', async () => {
  const f = await fixture()
  f.bridge.dispose()
  let unavailable = false
  const bridge = createFoundationAuthoringLink({ store: f.store, author: { ...f.author,
    async getResult(handle) {
      if (unavailable) throw new Error('fixture secret must not enter the orchestration snapshot')
      return f.author.getResult(handle)
    },
  }, pollIntervalMs: 1 })
  try {
    await bridge.start(f.run)
    unavailable = true
    let current = (await f.store.load())!
    for (let attempt = 0; attempt < 100 && current.status === 'running'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5))
      current = (await f.store.load())!
    }
    expect(current.status).toBe('needs_action')
    expect(current.authorStage!.status).toBe('running')
    expect(current.blockedReason).toContain('public status could not be observed')
    expect(JSON.stringify(current)).not.toContain('fixture secret')
    expect(current.foundationAuditState).toBeUndefined()
    unavailable = false
    expect((await bridge.ensureProgress(f.run)).status).toBe('running')
    expect(f.resumes).toHaveLength(0)
  } finally { bridge.dispose() }
})
