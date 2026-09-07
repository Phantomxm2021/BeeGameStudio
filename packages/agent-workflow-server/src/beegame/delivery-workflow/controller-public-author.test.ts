import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { createFoundationAuthoring, AuthorResult, AuthorStartInput } from '../stage-modules/foundation-authoring/public'
import { createDeliveryWorkflowController } from './controller'
import { createInitialDeliveryRun } from './run-store'
import { resumeRun, retryRun, stopRun } from './recovery'
import { assertNoRetiredAuthorRun } from './retired-foundation-author'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun, type DeliveryWorkerPort, type DispatchRecord } from './types'

async function fixture(withAuthor = true) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'controller-public-author-')))
  const brief = 'Controller public author fixture'
  const run: DeliveryRun = { ...createInitialDeliveryRun({ ownerId: 'owner', projectId: 'project', confirmedBriefContext: brief,
    confirmedBriefDigest: createHash('sha256').update(brief).digest('hex') }), phase: 'DOCUMENT_DRAFTING', documentStep: 'FOUNDATION_DRAFTING' }
  const handle = { protocolVersion: 1 as const, producer: 'foundation-authoring' as const, id: randomUUID() }
  let outcome: AuthorResult = { status: 'running', handle }
  const calls = { starts: [] as AuthorStartInput[], resumes: [] as string[], stops: [] as string[], legacy: 0 }
  const unused = async (): Promise<never> => { calls.legacy++; throw new Error('Legacy worker port must not be used') }
  const workerPort: DeliveryWorkerPort = { start: unused, submit: unused, stop: unused, status: unused }
  const author: ReturnType<typeof createFoundationAuthoring> = {
    async start(input) { calls.starts.push(input); return handle },
    async resume(input) { calls.resumes.push(input.requestId); if (outcome.status !== 'completed') outcome = { status: 'running', handle }; return handle },
    async stop(input) { calls.stops.push(input.requestId); if (outcome.status !== 'completed') outcome = { status: 'stopped', handle }; return outcome },
    async getResult() { return structuredClone(outcome) },
  }
  const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort, ...(withAuthor ? { author } : {}) })
  await controller.store.commit(run, { runId: run.runId, type: 'run.created', phase: run.phase, status: run.status, revision: run.revision })
  function complete() {
    const input = calls.starts[0]!
    outcome = { status: 'completed', handle, result: {
      protocolVersion: 1, producer: 'foundation-authoring', kind: 'foundation_documents', resultId: 'a'.repeat(64),
      ownerId: 'owner', projectId: 'project', inputDigest: input.inputDigest, confirmedBriefDigest: run.confirmedBriefDigest,
      receiptSetDigest: 'b'.repeat(64), documentRevision: 'documents', workspaceRevision: 'workspace',
      documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: 'c'.repeat(64), byteLength: 20,
        artifactPath: `.beegame/workflow/foundation-authoring/artifacts/${'a'.repeat(64)}/${path}` })),
    } }
  }
  return { workspacePath, run, controller, calls, complete,
    set outcome(value: AuthorResult) { outcome = value }, handle }
}

test('actual public Author lifecycle snapshots never match the retired execution guard', async () => {
  const f = await fixture()
  const check = async () => {
    const snapshot = (await f.controller.store.load())!
    const before = structuredClone(snapshot)
    expect(() => assertNoRetiredAuthorRun(snapshot)).not.toThrow()
    expect(snapshot).toEqual(before)
  }
  try {
    await check() // Fresh DOCUMENT_DRAFTING run, before an opaque handle exists.
    await f.controller.start(f.run)
    await check()
    await f.controller.stopAuthor(f.run, 'user stopped')
    await check()
    await f.controller.resume(f.run)
    await check()
    f.complete()
    await f.controller.ensureProgress(f.run)
    await check()
    expect(f.calls.legacy).toBe(0)
  } finally { await f.controller.dispose() }
})

test('controller uses only the public author and pauses without deriving Reviewer state', async () => {
  const f = await fixture()
  try {
    await f.controller.start(f.run)
    await f.controller.start(f.run)
    expect(f.calls.starts).toHaveLength(1)
    f.complete()
    await f.controller.ensureProgress(f.run)
    await f.controller.resume(f.run)
    const current = (await f.controller.store.load())!
    expect(current.status).toBe('needs_action')
    expect(current.authorStage!.status).toBe('completed')
    expect(current.foundationAuditState).toBeUndefined()
    expect(current.foundationDraftState).toEqual({ completedPaths: [] })
    expect(current.activeDispatch).toBeUndefined()
    expect(f.calls.resumes).toHaveLength(0)
    expect(f.calls.legacy).toBe(0)
  } finally { await f.controller.dispose() }
})

test('controller stop, explicit resume and disposal operate on the opaque handle', async () => {
  const f = await fixture()
  try {
    await f.controller.start(f.run)
    expect((await f.controller.stopAuthor(f.run, 'user stopped')).status).toBe('stopped')
    await f.controller.resume(f.run)
    expect((await f.controller.store.load())!.status).toBe('running')
    expect(f.calls.resumes).toHaveLength(1)
    await f.controller.dispose()
    expect(f.calls.stops).toHaveLength(2)
    expect((await f.controller.store.load())!.status).toBe('stopped')
    expect(f.calls.legacy).toBe(0)
  } finally { await f.controller.dispose() }
})

test('missing public author is fail-closed and cannot fall back to the old scheduler', async () => {
  const f = await fixture(false)
  try {
    await expect(f.controller.start(f.run)).rejects.toThrow('public module is required')
    await expect(f.controller.resume(f.run)).rejects.toThrow('public module is required')
    expect(f.calls.legacy).toBe(0)
  } finally { await f.controller.dispose() }
})

test('legacy dispatch, terminal replay and recovery cannot mutate a linked author', async () => {
  const f = await fixture()
  try {
    await f.controller.start(f.run)
    const before = await f.controller.store.load()
    await expect(f.controller.dispatcher.dispatch({ runId: f.run.runId, ownerId: 'owner', projectId: 'project',
      workspacePath: f.workspacePath, workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: f.run.revision.document,
      taskId: 'docs/GDD.md', contract: { documentSet: 'foundation' } })).rejects.toThrow('legacy worker dispatch')
    await expect(f.controller.dispatcher.completeDispatch('late-old-worker', {})).rejects.toThrow('legacy worker terminals')
    const late: DispatchRecord = { dispatchId: 'late-old-worker', workerType: 'document-author', phase: 'DOCUMENT_DRAFTING',
      status: 'completed', revision: f.run.revision.document, startedAt: '2026-09-06T00:00:00.000Z' }
    await expect(f.controller.dispatcher.replayTerminal(late)).rejects.toThrow('legacy worker terminals')
    const input = { store: f.controller.store, runId: f.run.runId }
    await expect(resumeRun(input)).rejects.toThrow('not legacy recovery')
    await expect(retryRun(input)).rejects.toThrow('not legacy recovery')
    await expect(stopRun({ ...input, reason: 'old stop' })).rejects.toThrow('not legacy recovery')
    expect(await f.controller.store.reconcile(async () => { throw new Error('Must not inspect old worker sessions') })).toEqual(before)
    await expect(f.controller.requestChange(f.run, 'change the brief')).rejects.toThrow('public handoff acceptance')
    expect(await f.controller.store.load()).toEqual(before)
    expect(f.calls.legacy).toBe(0)
  } finally { await f.controller.dispose() }
})

test('legacy author checkpoints require explicit migration, never an automatic public restart', async () => {
  const f = await fixture()
  try {
    const legacy = { ...f.run, foundationDraftState: { completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]!] } }
    await f.controller.store.commit(legacy, { runId: legacy.runId, type: 'fixture.legacy', phase: legacy.phase, status: legacy.status, revision: legacy.revision })
    await expect(f.controller.resume(legacy)).rejects.toThrow('explicit migration')
    expect(f.calls.starts).toHaveLength(0)
    expect(f.calls.legacy).toBe(0)
  } finally { await f.controller.dispose() }
})
