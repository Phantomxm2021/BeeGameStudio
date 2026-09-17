import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../../../foundation-documents'
import { foundationPublicDigest } from '../../../foundation-public-result'
import { captureFoundationIrInput } from '../input'
import { foundationReadyReceiptFromInput } from '../private/core/source-input'
import { createGameIrLifecycle, type GameIrCompiler } from './lifecycle'
import { compileGameIr } from './compiler'
import type { GameIrReadyResult, GameIrStartInput } from '../public'
import type { ReviewerReviewResult } from '../../foundation-reviewer/public'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')

test('explicit correction preserves the old publication, is repeatable, and never runs another agent', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-correction-')))
  try {
    const review = acceptedReview()
    const draft = { schemaVersion: 'game-ir-direct-draft.v2', parameters: { volume: 1 }, assets: [],
      scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }], ui: [], vfx: [], logic: {} }
    let calls = 0
    const stage = createGameIrLifecycle(workspacePath, infrastructure(), input => compileGameIr({ ...input,
      execute: async () => { calls++; return JSON.stringify(draft) } }))
    const handle = await stage.start({ protocolVersion: 1, ownerId: 'owner', projectId: 'project', requestId: 'initial',
      acceptedReview: review, publishedDocumentRevision: review.documentSetDigest })
    const initial = await waitFor(stage, handle)
    if (initial.status !== 'completed') throw new Error('fixture failed')
    const oldBytes = await readFile(join(workspacePath, initial.result.committedPath), 'utf8')
    const correction = { handle, expectedResultDigest: foundationPublicDigest(initial.result),
      draft: { ...draft, parameters: { volume: 0.5 } } }
    await expect(stage.revise({ ...correction, expectedResultDigest: sha('stale') })).rejects.toThrow('expected settled')
    const revised = await stage.revise(correction)
    if (revised.status !== 'completed') throw new Error('revision failed')
    expect(revised.handle.id).not.toBe(handle.id)
    expect(revised.result.committedPath).not.toBe(initial.result.committedPath)
    expect((await stage.revise(correction)).handle).toEqual(revised.handle)
    expect(await readFile(join(workspacePath, initial.result.committedPath), 'utf8')).toBe(oldBytes)
    expect((await stage.readResult({ handle, foundationRevision: review.documentSetDigest })).candidate.parameters).toEqual({ volume: 1 })
    const restarted = createGameIrLifecycle(workspacePath, infrastructure())
    expect((await restarted.readResult({ handle: revised.handle, foundationRevision: review.documentSetDigest })).candidate.parameters).toEqual({ volume: 0.5 })
    expect(calls).toBe(1)
    await expect(stage.revise({ ...correction, draft: { ...draft, schemaVersion: 'invalid' } })).rejects.toThrow()
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

function acceptedReview(): ReviewerReviewResult {
  const brief = 'Confirmed brief'
  const briefDigest = sha(brief)
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
    const content = `# ${path}\n`
    return { path, content, digest: sha(content), byteLength: Buffer.byteLength(content) }
  })
  const documentSetDigest = foundationPublicDigest(documents.map(document => [document.path, document.digest]))
  const body = {
    protocolVersion: 6 as const, producer: 'foundation-reviewer' as const,
    ownerId: 'owner', projectId: 'project', requestId: 'review-request', inputDigest: sha('input'),
    subject: { kind: 'initial' as const, sourceResultId: 'source', sourceDocumentRevision: sha('source'), confirmedBriefDigest: briefDigest },
    requirements: { status: 'available' as const, content: brief, digest: briefDigest }, documents,
    documentSetDigest, policyDigest: sha('policy'), evidenceDigest: sha('evidence'),
    audit: { policy: {}, summary: 'accepted' },
  }
  return { ...body, resultId: foundationPublicDigest(body) } as ReviewerReviewResult
}

function nativeReview(): ReviewerReviewResult {
  const review = acceptedReview()
  const documents = review.documents.map(document => {
    const content = '# 修理\n原文。'
    return { ...document, content, digest: sha(content), byteLength: Buffer.byteLength(content) }
  })
  const documentSetDigest = foundationPublicDigest(documents.map(document => [document.path, document.digest]))
  const { resultId: _resultId, ...body } = { ...review, documents, documentSetDigest }
  return { ...body, resultId: foundationPublicDigest(body) } as ReviewerReviewResult
}

function infrastructure() {
  return {
    runtimeConfiguration: { protocolVersion: 1 as const, ownerId: 'owner', async resolve() { return { command: ['unused'], env: {} } } },
    billing: { protocolVersion: 1 as const, ownerId: 'owner', async submitUsage(input: any) {
      return { protocolVersion: 1 as const, ownerId: 'owner', eventId: input.eventId, idempotencyKey: input.eventId,
        pricingVersion: 'weighted-v1' as const, usageSource: 'runtime_snapshot' as const, usage: input.usage,
        skipped: true as const, duplicate: false as const }
    } },
  }
}

function readyFor(source: ReturnType<typeof captureFoundationIrInput>): GameIrReadyResult {
  const receipt = foundationReadyReceiptFromInput(source)
  return { schemaVersion: 'game-ir-ready-receipt.v2' as const, taskId: 'ir-request', publicationId: 'publication',
    gameIrSchemaVersion: 'game-ir.v2' as const, foundationRevision: source.publishedDocumentRevision,
    foundationReceiptDigest: receipt.receiptDigest, candidateDigest: sha('candidate'), manifestDigest: sha('manifest'),
    committedPath: `.beegame/ir/game-ir.v2/revisions/${source.publishedDocumentRevision}/COMMITTED.json`,
  }
}

function meteredInfrastructure(submitUsage: (input: any) => Promise<any>, resolve: () => Promise<{ command: string[]; env: Record<string, string> }> = async () => ({ command: [process.execPath, join(import.meta.dir, 'test-fixtures/native-operation.ts')], env: { BEEGAME_EXTERNAL_REVIEW: '1' } })) {
  return {
    runtimeConfiguration: { protocolVersion: 1 as const, ownerId: 'owner', resolve },
    billing: { protocolVersion: 1 as const, ownerId: 'owner', submitUsage },
  }
}

function validReceipt(input: any) {
  const usage = input.usage
  const event = { eventId: input.eventId, duplicate: false, weightedTokensDelta: usage.total_tokens, creditsMicro: 1 }
  return { protocolVersion: 1 as const, ownerId: 'owner', eventId: input.eventId, idempotencyKey: input.eventId,
    pricingVersion: 'weighted-v1' as const, usageSource: 'runtime_snapshot' as const, usage,
    duplicate: false, recorded: event, debited: event }
}

async function waitFor(stage: ReturnType<typeof createGameIrLifecycle>, handle: any) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await stage.getResult(handle)
    if (result.status !== 'running') return result
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Game IR fixture timed out')
}

test('Game IR start is idempotent and a ready result is durable', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-test-')))
  try {
    const review = acceptedReview()
    const input: GameIrStartInput = { protocolVersion: 1 as const, ownerId: 'owner', projectId: 'project', requestId: 'ir-request',
      acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
    const source = captureFoundationIrInput(input)
    const ready = readyFor(source)
    const compiler: GameIrCompiler = async () => ({ status: 'ready', closure: { candidate: { schemaVersion: 'game-ir.v2', taskId: 'ir-request', sourceRevision: source.publishedDocumentRevision, parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }], ui: [], vfx: [], logic: {} } }, readyReceipt: ready } as any)
    const stage = createGameIrLifecycle(workspacePath, infrastructure(), compiler)
    const handle = await stage.start(input)
    expect(await stage.start(input)).toEqual(handle)
    const result = await waitFor(stage, handle)
    expect(result).toMatchObject({ status: 'completed', billingStatus: 'settled', result: ready })
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('a direct CLI validation failure waits for explicit resume before repair', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-validation-terminal-')))
  try {
    const review = acceptedReview()
    const input: GameIrStartInput = { protocolVersion: 1, ownerId: 'owner', projectId: 'project', requestId: 'validation-terminal',
      acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
    const source = captureFoundationIrInput(input), ready = readyFor(source)
    let calls = 0
    const compiler: GameIrCompiler = async () => {
      calls += 1
      if (calls === 1) return { status: 'needs_action', diagnostic: {
        schemaVersion: 'game-ir-compiler-diagnostic.v1', recoverable: true, step: 'direct', domain: 'all', mode: 'compile',
        reason: 'latest host validation error',
      } }
      return { status: 'ready', closure: { candidate: { schemaVersion: 'game-ir.v2', taskId: 'ir-request',
        sourceRevision: source.publishedDocumentRevision, parameters: {}, assets: [],
        scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }], ui: [], vfx: [],
        logic: { entryScene: 'scene.main' } } }, readyReceipt: ready } as any
    }
    const stage = createGameIrLifecycle(workspacePath, infrastructure(), compiler)
    const handle = await stage.start(input)
    const result = await waitFor(stage, handle)
    expect(result).toMatchObject({ status: 'needs_action', resumable: true })
    expect(calls).toBe(1)
    await stage.resume({ handle, requestId: 'explicit-repair' })
    expect(await waitFor(stage, handle)).toMatchObject({ status: 'completed' })
    expect(calls).toBe(2)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('stop is durable and does not permit an unmetered continuation', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-stop-test-')))
  try {
    const review = acceptedReview()
    const input: GameIrStartInput = { protocolVersion: 1 as const, ownerId: 'owner', projectId: 'project', requestId: 'ir-stop', acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
    let executed = 0
    const compiler: GameIrCompiler = async () => { executed++; await new Promise(resolve => setTimeout(resolve, 50)); throw new Error('should not complete') }
    const stage = createGameIrLifecycle(workspacePath, infrastructure(), compiler)
    const handle = await stage.start(input)
    const stopped = await stage.stop({ handle, requestId: 'stop', reason: 'test stop' })
    expect(['stopped', 'running', 'needs_action']).toContain(stopped.status)
    await new Promise(resolve => setTimeout(resolve, 80))
    expect((await stage.getResult(handle)).status).not.toBe('completed')
    expect(executed).toBeLessThanOrEqual(1)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('invalid handles are rejected before any filesystem path is derived', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-handle-test-')))
  try {
    const stage = createGameIrLifecycle(workspacePath, infrastructure(), async () => {
      throw new Error('compiler must not be reached')
    })
    await expect(stage.getResult({ protocolVersion: 1, producer: 'game-ir', id: '../escape' })).rejects.toThrow()
    await expect(stage.getResult({ protocolVersion: 1, producer: 'game-ir', id: 'a'.repeat(64) })).rejects.toThrow()
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('recovers a lost billing acknowledgement with the same event and does not rerun native work', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-billing-recovery-')))
  try {
    const review = nativeReview()
    const input: GameIrStartInput = { protocolVersion: 1, ownerId: 'owner', projectId: 'project', requestId: 'billing-recovery', acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
    const source = captureFoundationIrInput(input)
    const ready = readyFor(source)
    const billingCalls: any[] = []
    let failures = 2
    const infrastructureForTest = meteredInfrastructure(async value => {
      billingCalls.push(value)
      if (failures-- > 0) throw new Error('billing transport lost')
      return validReceipt(value)
    })
    const compiler: GameIrCompiler = async ({ execute }) => {
      await execute({ kind: 'compile', prompt: 'fixture', outputFormat: 'json' })
      return { status: 'ready', closure: { candidate: { schemaVersion: 'game-ir.v2', taskId: 'ir-request', sourceRevision: source.publishedDocumentRevision, parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }], ui: [], vfx: [], logic: {} } }, readyReceipt: ready } as any
    }
    const stage = createGameIrLifecycle(workspacePath, infrastructureForTest, compiler)
    const handle = await stage.start(input)
    const first = await waitFor(stage, handle)
    expect(first.status).toBe('needs_action')
    if (first.status === 'needs_action') expect(first.resumable).toBe(true)
    const resumed = await stage.resume({ handle, requestId: 'billing-retry' })
    expect(['running', 'completed']).toContain(resumed.status)
    const result = await waitFor(stage, handle)
    expect(result.status).toBe('completed')
    const ownerRoot = (await readdir(join(workspacePath, '.beegame/workflow/game-ir/native-v1')))[0]!
    const eventsRoot = join(workspacePath, '.beegame/workflow/game-ir/native-v1', ownerRoot, handle.id, 'journal', 'events')
    const events = await Promise.all((await readdir(eventsRoot)).map(async name => JSON.parse(await readFile(join(eventsRoot, name), 'utf8'))))
    expect(events.filter((record: any) => record.event.kind === 'claim')).toHaveLength(1)
    expect(new Set(billingCalls.map(call => call.eventId)).size).toBe(1)
    expect(billingCalls).toHaveLength(3)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('rejects a billing receipt bound to another event without publishing or rerunning native work', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-billing-receipt-')))
  try {
    const review = nativeReview()
    const input: GameIrStartInput = { protocolVersion: 1, ownerId: 'owner', projectId: 'project', requestId: 'wrong-receipt', acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
    const source = captureFoundationIrInput(input)
    const ready = readyFor(source)
    const billingCalls: any[] = []
    const infrastructureForTest = meteredInfrastructure(async value => {
      billingCalls.push(value)
      const receipt = validReceipt(value)
      return { ...receipt, eventId: 'wrong-event', idempotencyKey: 'wrong-event' }
    })
    const compiler: GameIrCompiler = async ({ execute }) => {
      await execute({ kind: 'compile', prompt: 'fixture', outputFormat: 'json' })
      return { status: 'ready', closure: { candidate: { schemaVersion: 'game-ir.v2', taskId: 'ir-request', sourceRevision: source.publishedDocumentRevision, parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }], ui: [], vfx: [], logic: {} } }, readyReceipt: ready } as any
    }
    const stage = createGameIrLifecycle(workspacePath, infrastructureForTest, compiler)
    const handle = await stage.start(input)
    expect((await waitFor(stage, handle)).status).toBe('needs_action')
    await stage.resume({ handle, requestId: 'wrong-receipt-retry' })
    expect((await waitFor(stage, handle)).status).toBe('needs_action')
    const ownerRoot = (await readdir(join(workspacePath, '.beegame/workflow/game-ir/native-v1')))[0]!
    const eventsRoot = join(workspacePath, '.beegame/workflow/game-ir/native-v1', ownerRoot, handle.id, 'journal', 'events')
    const events = await Promise.all((await readdir(eventsRoot)).map(async name => JSON.parse(await readFile(join(eventsRoot, name), 'utf8'))))
    expect(events.filter((record: any) => record.event.kind === 'claim')).toHaveLength(1)
    expect(billingCalls).toHaveLength(2)
    expect((await stage.getResult(handle)).status).not.toBe('completed')
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('late compiler completion after a real stop cannot publish READY', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-late-stop-')))
  try {
    const review = nativeReview()
    const input: GameIrStartInput = { protocolVersion: 1, ownerId: 'owner', projectId: 'project', requestId: 'late-stop', acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
    const source = captureFoundationIrInput(input)
    const ready = readyFor(source)
    let began: () => void = () => {}
    let release: () => void = () => {}
    const started = new Promise<void>(resolve => { began = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const compiler: GameIrCompiler = async () => { began(); await gate; return { status: 'ready', closure: { candidate: { schemaVersion: 'game-ir.v2', taskId: 'ir-request', sourceRevision: source.publishedDocumentRevision, parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }], ui: [], vfx: [], logic: {} } }, readyReceipt: ready } as any }
    const stage = createGameIrLifecycle(workspacePath, infrastructure(), compiler)
    const handle = await stage.start(input)
    await started
    await stage.stop({ handle, requestId: 'late-stop-command', reason: 'operator stop' })
    release()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect((await stage.getResult(handle)).status).not.toBe('completed')
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('resume preserves intent when stop arrives before the old drive exits', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-stop-resume-')))
  try {
    const review = acceptedReview()
    const input: GameIrStartInput = { protocolVersion: 1, ownerId: 'owner', projectId: 'project', requestId: 'stop-resume', acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
    const source = captureFoundationIrInput(input)
    const ready = readyFor(source)
    let invocation = 0
    let began: () => void = () => {}
    let release: () => void = () => {}
    const started = new Promise<void>(resolve => { began = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const compiler: GameIrCompiler = async () => {
      invocation++
      if (invocation === 1) { began(); await gate }
      return { status: 'ready', closure: { candidate: { schemaVersion: 'game-ir.v2', taskId: 'ir-request', sourceRevision: source.publishedDocumentRevision, parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }], ui: [], vfx: [], logic: {} } }, readyReceipt: ready } as any
    }
    const stage = createGameIrLifecycle(workspacePath, infrastructure(), compiler)
    const handle = await stage.start(input)
    await started
    await stage.stop({ handle, requestId: 'stop-before-resume', reason: 'operator stop' })
    const resume = stage.resume({ handle, requestId: 'resume-after-stop' })
    await new Promise(resolve => setTimeout(resolve, 15))
    release()
    const resumed = await resume
    expect(['running', 'completed']).toContain(resumed.status)
    expect((await waitFor(stage, handle)).status).toBe('completed')
    expect(invocation).toBe(2)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('resume does not restart a stopped operation whose usage was never observed', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-stop-unknown-usage-')))
  try {
    const review = acceptedReview()
    const input: GameIrStartInput = { protocolVersion: 1, ownerId: 'owner', projectId: 'project', requestId: 'stop-unknown-usage', acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
    const source = captureFoundationIrInput(input)
    const ready = readyFor(source)
    let invocation = 0
    let began: () => void = () => {}
    const started = new Promise<void>(resolve => { began = resolve })
    const compiler: GameIrCompiler = async ({ execute }) => {
      invocation++
      began()
      await execute({ kind: 'compile', prompt: 'no usage fixture', outputFormat: 'json' })
      return { status: 'ready', closure: { candidate: { schemaVersion: 'game-ir.v2', taskId: 'ir-request', sourceRevision: source.publishedDocumentRevision, parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }], ui: [], vfx: [], logic: {} } }, readyReceipt: ready } as any
    }
    const stage = createGameIrLifecycle(workspacePath, meteredInfrastructure(async value => validReceipt(value), async () => ({
      command: [process.execPath, '-e', 'process.stdin.resume(); setTimeout(() => {}, 5000)'], env: {},
    })), compiler)
    const handle = await stage.start(input)
    await started
    await stage.stop({ handle, requestId: 'stop-unknown-usage', reason: 'operator stop' })
    const resumed = await stage.resume({ handle, requestId: 'resume-unknown-usage' })
    expect(resumed.status).toBe('needs_action')
    if (resumed.status === 'needs_action') expect(resumed.resumable).toBe(false)
    expect(invocation).toBe(1)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('readResult rejects missing or tampered committed publication instead of returning cached READY', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'game-ir-reader-validation-')))
  try {
    const review = acceptedReview()
    const input: GameIrStartInput = { protocolVersion: 1, ownerId: 'owner', projectId: 'project', requestId: 'reader-validation', acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
    const source = captureFoundationIrInput(input)
    const ready = readyFor(source)
    const compiler: GameIrCompiler = async () => ({ status: 'ready', closure: { candidate: { schemaVersion: 'game-ir.v2', taskId: 'ir-request', sourceRevision: source.publishedDocumentRevision, parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }], ui: [], vfx: [], logic: {} } }, readyReceipt: ready } as any)
    const stage = createGameIrLifecycle(workspacePath, infrastructure(), compiler)
    const handle = await stage.start(input)
    expect((await waitFor(stage, handle)).status).toBe('completed')
    await expect(stage.readResult({ handle, foundationRevision: source.publishedDocumentRevision })).rejects.toThrow(/direct compiler authority|COMMITTED|publication/i)
    const ownerRoot = (await readdir(join(workspacePath, '.beegame/workflow/game-ir/native-v1')))[0]!
    const eventsRoot = join(workspacePath, '.beegame/workflow/game-ir/native-v1', ownerRoot, handle.id, 'journal', 'events')
    let readyFile: string | undefined
    for (const name of await readdir(eventsRoot)) {
      const record = JSON.parse(await readFile(join(eventsRoot, name), 'utf8'))
      if (record.event.kind === 'ready') { readyFile = name; break }
    }
    if (!readyFile) throw new Error('ready journal record was not written')
    const readyRecord = JSON.parse(await readFile(join(eventsRoot, readyFile), 'utf8'))
    readyRecord.event.ready.committedPath = `${readyRecord.event.ready.committedPath}.tampered`
    await writeFile(join(eventsRoot, readyFile), JSON.stringify(readyRecord))
    await expect(stage.readResult({ handle, foundationRevision: source.publishedDocumentRevision })).rejects.toThrow()
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
