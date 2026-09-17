import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorDigest, type AuthorConfiguration, type AuthorResult, type AuthorStartInput } from './contract'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { createAutonomousAuthorLifecycle } from './autonomous-lifecycle'
import { autonomousAuthorFinishPrompt, autonomousAuthorPrompt, createAutonomousAuthorUsageMeter, runAutonomousAuthor, type AutonomousNativeExecutor } from './autonomous-native'
import { captureAuthorBaseline, captureAutonomousDocuments, initializeAutonomousFiles, publishAutonomousDocuments } from './autonomous-files'
import { createAuthorPersistence } from './persistence'
import type { AuthorOperations } from './contract'
import type { UsageBillingClient, UsageBillingInput } from '../../../../billing/public'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const pause = () => new Promise(resolve => setTimeout(resolve, 10))
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  for (let index = 0; index < 400; index++) { const value = await read(); if (predicate(value)) return value; await pause() }
  throw new Error('Autonomous author fixture timed out')
}
async function fixture() {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'autonomous-author-')))
  roots.push(workspacePath)
  const config: AuthorConfiguration = { workspacePath, privateRootPath: join(workspacePath, '.beegame/workflow/foundation-authoring/state'), model: { command: ['offline-fixture'], env: {} } }
  const input = { confirmedBrief: 'Create a bee game with 60 seconds, 10 nectar and 3 lives.', confirmedBriefDigest: '' }
  input.confirmedBriefDigest = createHash('sha256').update(input.confirmedBrief).digest('hex')
  const start: AuthorStartInput = { protocolVersion: 1, requestId: 'bundle', ownerId: 'owner', projectId: 'project', input,
    inputDigest: authorDigest({ ownerId: 'owner', projectId: 'project', input }) }
  const submissions: UsageBillingInput[] = []
  let rejectBilling = false
  const billing: UsageBillingClient = { protocolVersion: 1, ownerId: 'owner', async submitUsage(value) {
    if (rejectBilling) throw new Error('offline authority temporarily unavailable')
    submissions.push(value)
    return { protocolVersion: 1, ownerId: value.ownerId, eventId: value.eventId, idempotencyKey: value.eventId,
      pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot', usage: value.usage, duplicate: false, skipped: true }
  } }
  return { config, start, billing, submissions, rejectBilling: (value: boolean) => { rejectBilling = value },
    create: (execute: AutonomousNativeExecutor): AuthorOperations => createAutonomousAuthorLifecycle(config, { billing }, execute) }
}
const usage = { prompt_tokens: 2, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 5 }
async function writeDocuments(root: string) {
  // Deliberately write the opposite of the legacy dependency order. The host
  // must admit the set without dictating the agent's internal work sequence.
  for (const path of [...CANONICAL_FOUNDATION_DOCUMENTS].reverse()) await writeFile(join(root, path), `# ${path}\n\nA complete authored decision for ${path}.\n`)
}
const success: AutonomousNativeExecutor = async input => {
  await input.onUsage(usage); await writeDocuments(input.workspacePath)
  return { usage, report: { status: 'completed', summary: 'The eight documents are ready.' } }
}
const closed = (value: AuthorResult) => value.status !== 'running'

test('native failure preserves work and billing; resume remains explicit and idempotent', async () => {
  const f = await fixture()
  const limits = { maxActiveMs: 1000, maxNoDocumentProgressMs: 500 }
  f.config.executionLimits = limits
  let calls = 0, candidate = ''
  const executor: AutonomousNativeExecutor = async input => {
    calls++; candidate = input.workspacePath
    expect(input.executionLimits).toEqual(limits)
    if (calls > 1) return success(input)
    await input.onUsage(usage)
    await writeFile(join(candidate, 'docs/GDD.md'), '# Preserved on budget stop')
    await new Promise(resolve => setTimeout(resolve, 40))
    return { failure: 'model_failed', usage }
  }
  const stage = f.create(executor), handle = await stage.start(f.start)
  const paused = await until(() => stage.getResult(handle), closed)
  expect(paused.status).toBe('needs_action')
  expect(paused.status === 'needs_action' && paused.reason).toContain('complete metered result')
  expect(paused.timing!.currentCallElapsedMs).toBe(0)
  expect(paused.timing!.historicalElapsedMs).toBeGreaterThanOrEqual(40)
  expect(f.submissions).toHaveLength(1)
  expect(await readFile(join(candidate, 'docs/GDD.md'), 'utf8')).toContain('Preserved')
  for (let index = 0; index < 3; index++) expect(await stage.getResult(handle)).toEqual(paused)
  expect(calls).toBe(1)
  f.config.executionLimits = { maxActiveMs: 9999, maxNoDocumentProgressMs: 9999 }
  const reopened = f.create(executor)
  await reopened.resume({ handle, requestId: 'explicit-budget-resume' })
  const completed = await until(() => reopened.getResult(handle), closed)
  expect(completed.status).toBe('completed')
  expect(completed.timing!.historicalElapsedMs).toBeGreaterThanOrEqual(paused.timing!.historicalElapsedMs)
  await reopened.resume({ handle, requestId: 'explicit-budget-resume' })
  expect(await reopened.getResult(handle)).toEqual(completed)
  expect(calls).toBe(2); expect(f.submissions).toHaveLength(2)
})

test('autonomous author invokes one complete file bundle and preserves the public result contract', async () => {
  const f = await fixture(); let calls = 0, candidate = ''
  const stage = f.create(async input => { calls++; candidate = input.workspacePath; return success(input) })
  const handle = await stage.start(f.start)
  const result = await until(() => stage.getResult(handle), closed)
  expect(result.status).toBe('completed'); expect(result.billingStatus).toBe('settled'); expect(calls).toBe(1)
  expect(result.status === 'completed' && result.result.documents.map(doc => doc.path)).toEqual([...CANONICAL_FOUNDATION_DOCUMENTS])
  expect(candidate).not.toBe(f.config.workspacePath)
  expect(f.submissions).toHaveLength(1)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) expect(await readFile(join(f.config.workspacePath, path), 'utf8')).toContain('document_id:')
  expect(await stage.getResult(handle)).toEqual(result)
  expect(await stage.start(f.start)).toEqual(handle)
  expect(calls).toBe(1); expect(f.submissions).toHaveLength(1)
})

test('the task prompt is a natural document assignment without an audit policy', () => {
  const prompt = autonomousAuthorPrompt('zh')
  expect(prompt).toContain('requirements.md contains the confirmed game requirements')
  expect(prompt).toContain('Use your own judgment')
  expect(prompt).not.toMatch(/audit|review|consistency check|finish immediately|GDD\.md first|Agent tool|delegat|run_in_background|expected_output_files|\.reference|authoring-reference|deliveryInterfaces|Attempt policy/i)
})

test('the finishing prompt naturally continues useful existing work', () => {
  const prompt = autonomousAuthorFinishPrompt('zh')
  expect(prompt).toContain('Preserve useful completed work')
  expect(prompt).toContain('Use your own judgment')
  expect(prompt).not.toMatch(/audit|review|consistency|repeat the check|finish immediately/i)
})

test('native author submits one file-agent call without delegation policy', async () => {
  const f = await fixture()
  let captured: any
  const result = await runAutonomousAuthor({
    configuration: f.config.model,
    workspacePath: f.config.workspacePath,
    logPath: join(f.config.workspacePath, 'author.log'),
    signal: new AbortController().signal,
    onUsage: async () => {},
    onProgress: async () => {},
  }, async input => {
    captured = input
    await input.onMessage?.({ type: 'result', modelUsage: { fixture: { inputTokens: 1, outputTokens: 1 } } })
    return { result: { structured_output: { status: 'completed', summary: 'Captured native delegation boundary.' } },
      completion: { scope: 'direct-child', pid: null, exitCode: 0, signalCode: null, stdoutDrained: true, termination: 'none' } }
  })
  expect(result.report?.status).toBe('completed')
  expect(captured.writablePaths).toEqual([...CANONICAL_FOUNDATION_DOCUMENTS])
  expect(captured.readOnlyPaths).toEqual(['requirements.md'])
  expect(captured).not.toHaveProperty('delegateOutputPaths')
  expect(captured).not.toHaveProperty('delegatePrerequisitePaths')
})

test('partial work remains private; stop preserves files and explicit resume continues the bundle', async () => {
  const f = await fixture(); let calls = 0, candidate = '', began = false
  const stage = f.create(async input => {
    calls++; candidate = input.workspacePath
    await input.onUsage(usage)
    if (calls === 1) {
      await writeFile(join(candidate, 'docs/GDD.md'), '# Preserved draft\n')
      await writeFile(join(candidate, 'working-notes.md'), 'Preserved agent working notes')
      began = true
      await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      return { usage, failure: 'stopped' }
    }
    expect(await readFile(join(candidate, 'docs/GDD.md'), 'utf8')).toBe('# Preserved draft\n')
    expect(await readFile(join(candidate, 'working-notes.md'), 'utf8')).toContain('Preserved')
    return success(input)
  })
  const handle = await stage.start(f.start)
  await until(async () => began, Boolean)
  expect(await Bun.file(join(f.config.workspacePath, 'docs/GDD.md')).exists()).toBe(false)
  await stage.stop({ handle, requestId: 'stop', reason: 'user requested pause' })
  expect((await until(() => stage.getResult(handle), closed)).status).toBe('stopped')
  expect(calls).toBe(1)
  await stage.resume({ handle, requestId: 'resume' })
  expect((await until(() => stage.getResult(handle), closed)).status).toBe('completed')
  expect(calls).toBe(2); expect(f.submissions).toHaveLength(2)
  await stage.resume({ handle, requestId: 'resume' })
  expect(calls).toBe(2)
})

test('failed and blocked agents never cause automatic model retries on reads or reopen', async () => {
  for (const failure of ['failed', 'blocked'] as const) {
    const f = await fixture(); let calls = 0
    const execute: AutonomousNativeExecutor = async input => { calls++; await input.onUsage(usage); return failure === 'failed'
      ? { usage, failure: 'model_failed' } : { usage, report: { status: 'blocked', summary: 'A user decision is required.' } } }
    const stage = f.create(execute), handle = await stage.start(f.start)
    expect((await until(() => stage.getResult(handle), closed)).status).toBe('needs_action')
    const reopened = f.create(execute)
    for (let index = 0; index < 4; index++) { expect((await reopened.getResult(handle)).status).toBe('needs_action'); await pause() }
    expect(calls).toBe(1)
  }
})

test('a newer resume arriving during native stop cleanup is applied after cleanup, not lost', async () => {
  const f = await fixture(); let calls = 0, began = false, stopping = false
  const stage = f.create(async input => {
    calls++; await input.onUsage(usage)
    if (calls > 1) return success(input)
    began = true
    await new Promise<void>(resolve => input.signal.addEventListener('abort', () => { stopping = true; resolve() }, { once: true }))
    await new Promise(resolve => setTimeout(resolve, 100))
    return { usage, failure: 'stopped' }
  })
  const handle = await stage.start(f.start)
  await until(async () => began, Boolean)
  const stop = stage.stop({ handle, requestId: 'stop-race', reason: 'pause' })
  await until(async () => stopping, Boolean)
  await stage.resume({ handle, requestId: 'resume-race' })
  await stop
  expect((await until(() => stage.getResult(handle), closed)).status).toBe('completed')
  expect(calls).toBe(2)
})

for (const malformed of ['missing-document', 'changed-requirements', 'symlink', 'hardlink', 'invalid-utf8']) {
  test(`autonomous bundle admission rejects ${malformed} before publishing any document`, async () => {
    const f = await fixture(); let calls = 0
    const stage = f.create(async input => {
      calls++; await input.onUsage(usage); await writeDocuments(input.workspacePath)
      if (malformed === 'missing-document') await rm(join(input.workspacePath, 'docs/ASSET_PLAN.md'))
      if (malformed === 'changed-requirements') await writeFile(join(input.workspacePath, 'requirements.md'), 'Unapproved requirements')
      if (malformed === 'symlink' || malformed === 'hardlink') {
        await rm(join(input.workspacePath, 'docs/GDD.md'))
        if (malformed === 'symlink') await symlink(join(input.workspacePath, 'docs/UI_UX_SPEC.md'), join(input.workspacePath, 'docs/GDD.md'))
        else await link(join(input.workspacePath, 'docs/UI_UX_SPEC.md'), join(input.workspacePath, 'docs/GDD.md'))
      }
      if (malformed === 'invalid-utf8') await writeFile(join(input.workspacePath, 'docs/GDD.md'), Buffer.from([0xc3, 0x28]))
      return { usage, report: { status: 'completed', summary: 'Claimed complete.' } }
    })
    const handle = await stage.start(f.start)
    expect((await until(() => stage.getResult(handle), closed)).status).toBe('needs_action')
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) expect(await Bun.file(join(f.config.workspacePath, path)).exists()).toBe(false)
    await stage.getResult(handle); expect(calls).toBe(1)
  })
}

test('an edit to official documents during generation blocks the whole publication and is preserved', async () => {
  const f = await fixture()
  const stage = f.create(async input => {
    await mkdir(join(f.config.workspacePath, 'docs'), { recursive: true })
    await writeFile(join(f.config.workspacePath, 'docs/GDD.md'), 'User edit during authoring')
    return success(input)
  })
  const handle = await stage.start(f.start)
  expect((await until(() => stage.getResult(handle), closed)).status).toBe('needs_action')
  expect(await readFile(join(f.config.workspacePath, 'docs/GDD.md'), 'utf8')).toBe('User edit during authoring')
  expect(await Bun.file(join(f.config.workspacePath, 'docs/ASSET_PLAN.md')).exists()).toBe(false)
})

test('billing pending withholds publication, and settlement recovery does not repeat native work', async () => {
  const f = await fixture(); f.rejectBilling(true); let calls = 0
  const stage = f.create(async input => { calls++; return success(input) }), handle = await stage.start(f.start)
  const store = createAuthorPersistence({ rootPath: f.config.privateRootPath })
  await until(() => store.load<any>(handle.id), state => Boolean(state?.prepared))
  expect((await stage.getResult(handle)).billingStatus).toBe('pending')
  expect(await Bun.file(join(f.config.workspacePath, 'docs/GDD.md')).exists()).toBe(false)
  f.rejectBilling(false)
  expect((await until(() => stage.getResult(handle), closed)).status).toBe('completed')
  expect(calls).toBe(1); expect(f.submissions).toHaveLength(1)
})

test('concurrent idempotent starts and cross-instance observation share one execution', async () => {
  const f = await fixture(); let calls = 0
  const execute: AutonomousNativeExecutor = async input => { calls++; await pause(); return success(input) }
  const a = f.create(execute), b = f.create(execute)
  const [first, second] = await Promise.all([a.start(f.start), b.start(f.start)])
  expect(first).toEqual(second)
  expect((await until(() => b.getResult(second), closed)).status).toBe('completed')
  expect(calls).toBe(1)
  const different = { ...f.start, input: { ...f.start.input, changeRequest: 'Changed scope' } }
  different.inputDigest = authorDigest({ ownerId: different.ownerId, projectId: different.projectId, input: different.input })
  await expect(a.start(different)).rejects.toThrow('conflicts')
})

test('cross-instance stop stays running until the owning native process has drained', async () => {
  const f = await fixture(); let began = false, stopping = false, release!: () => void
  const drained = new Promise<void>(resolve => { release = resolve })
  const execute: AutonomousNativeExecutor = async input => {
    await input.onUsage(usage); began = true
    await new Promise<void>(resolve => input.signal.addEventListener('abort', () => { stopping = true; resolve() }, { once: true }))
    await drained
    return { usage, failure: 'stopped' }
  }
  const owner = f.create(execute), observer = f.create(execute), handle = await owner.start(f.start)
  await until(async () => began, Boolean)
  const pending = await observer.stop({ handle, requestId: 'remote-stop', reason: 'pause' })
  expect(pending.status).toBe('running')
  await until(async () => stopping, Boolean)
  expect((await observer.getResult(handle)).status).toBe('running')
  release()
  expect((await until(() => observer.getResult(handle), closed)).status).toBe('stopped')
})

test('candidate preparation refuses linked ancestors without creating directories at the destination', async () => {
  const f = await fixture(), destination = join(f.config.workspacePath, 'outside')
  await mkdir(destination)
  await symlink(destination, join(f.config.workspacePath, 'redirect'))
  const candidatePath = join(f.config.workspacePath, 'redirect', 'must-not-exist', 'workspace')
  await expect(initializeAutonomousFiles({ candidatePath, workspacePath: f.config.workspacePath, start: f.start,
    baseline: await captureAuthorBaseline(f.config.workspacePath) })).rejects.toThrow('symbolic link')
  expect(await Bun.file(join(destination, 'must-not-exist')).exists()).toBe(false)
})

test('completed artifact corruption fails closed without reauthoring or replacing project edits', async () => {
  const f = await fixture(); let calls = 0
  const stage = f.create(async input => { calls++; return success(input) }), handle = await stage.start(f.start)
  const outcome = await until(() => stage.getResult(handle), closed)
  if (outcome.status !== 'completed') throw new Error('Expected completed fixture')
  await writeFile(join(f.config.workspacePath, 'docs/GDD.md'), 'Later user edit')
  expect((await stage.getResult(handle)).status).toBe('completed')
  await writeFile(join(f.config.workspacePath, outcome.result.documents[0]!.artifactPath), 'Corrupt artifact')
  await expect(stage.getResult(handle)).rejects.toThrow('immutable artifact changed')
  expect(calls).toBe(1)
  expect(await readFile(join(f.config.workspacePath, 'docs/GDD.md'), 'utf8')).toBe('Later user edit')
})

test('orphaned attempted work becomes needs_action without starting another model', async () => {
  const f = await fixture(); let calls = 0
  const stage = f.create(async input => { calls++; await input.onUsage(usage); return { failure: 'failed', usage } })
  const handle = await stage.start(f.start)
  await until(() => stage.getResult(handle), closed)
  await pause()
  const store = createAuthorPersistence({ rootPath: f.config.privateRootPath })
  const checkpoint = (await store.load<any>(handle.id))!
  checkpoint.status = 'running'; checkpoint.attempt.status = 'running'
  await store.save(handle.id, checkpoint)
  expect((await until(() => f.create(success).getResult(handle), closed)).status).toBe('needs_action')
  expect(calls).toBe(1)
})

test('prepared bundle publication can recover after a partial write with the exact same package', async () => {
  const f = await fixture(), candidatePath = join(f.config.privateRootPath, 'candidate')
  const baseline = await captureAuthorBaseline(f.config.workspacePath)
  await initializeAutonomousFiles({ candidatePath, workspacePath: f.config.workspacePath, start: f.start, baseline })
  await writeDocuments(candidatePath)
  const prepared = await captureAutonomousDocuments({ candidatePath, start: f.start, baseline, updatedAt: new Date().toISOString() })
  const input = { workspacePath: f.config.workspacePath, start: f.start, prepared }
  await expect(publishAutonomousDocuments(input, { async afterCanonicalWrite(index) { if (index === 1) throw new Error('simulated interruption') } })).rejects.toThrow('interruption')
  const result = await publishAutonomousDocuments(input)
  expect(result.documents).toHaveLength(8)
  expect(await publishAutonomousDocuments(input)).toEqual(result)
})

test('native usage counts distinct messages, deduplicates snapshots and trusts cumulative parent/child totals', () => {
  const meter = createAutonomousAuthorUsageMeter()
  meter.observe({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 10 } } } })
  meter.observe({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 3 } } })
  meter.observe({ type: 'assistant', message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 3 } } })
  meter.observe({ type: 'assistant', message: { id: 'm2', usage: { input_tokens: 5, output_tokens: 2 } } })
  expect(meter.snapshot()?.total_tokens).toBe(20)
  meter.observe({ type: 'result', modelUsage: { parent: { inputTokens: 15, outputTokens: 5 }, child: { inputTokens: 7, outputTokens: 3 } } })
  expect(meter.snapshot()?.total_tokens).toBe(30)
  meter.observe({ type: 'result', modelUsage: { parent: { inputTokens: 15, outputTokens: 5 }, child: { inputTokens: 7, outputTokens: 3 } } })
  expect(meter.snapshot()?.total_tokens).toBe(30)
  meter.observe({ type: 'result', modelUsage: { parent: { inputTokens: 2, outputTokens: 1 } } })
  expect(meter.snapshot()?.total_tokens).toBe(33)
})

test('interleaved background trace usage stays scoped, deduplicates stdout, and cannot double count after terminal drain', () => {
  const meter = createAutonomousAuthorUsageMeter()
  const trace = (scope: string, event: any) => meter.observe({ type: 'stream_event', nativeTraceAgentId: scope, event })
  trace('child-a', { type: 'message_start', message: { id: 'a', usage: { input_tokens: 10 } } })
  trace('child-b', { type: 'message_start', message: { id: 'b', usage: { input_tokens: 20 } } })
  trace('child-a', { type: 'message_delta', usage: { output_tokens: 5 } })
  trace('child-b', { type: 'message_delta', usage: { output_tokens: 7 } })
  meter.observe({ type: 'assistant', message: { id: 'a', usage: { input_tokens: 10, output_tokens: 5 } } })
  expect(meter.snapshot()?.total_tokens).toBe(42)
  meter.observe({ type: 'result', modelUsage: { all: { inputTokens: 30, outputTokens: 12 } } })
  trace('child-a', { type: 'message_start', message: { id: 'a', usage: { input_tokens: 10 } } })
  trace('child-a', { type: 'message_delta', usage: { output_tokens: 5 } })
  expect(meter.snapshot()?.total_tokens).toBe(42)
})
