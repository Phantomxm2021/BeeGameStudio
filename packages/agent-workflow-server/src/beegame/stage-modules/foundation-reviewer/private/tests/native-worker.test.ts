import { expect, test } from 'bun:test'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { executeReviewWorker, reviewNativeEnvironment, ReviewNativeError, type ReviewNativeCompletion } from '../native-worker'
import { createFactWorkerTask } from '../worker-task'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

const task = () => createFactWorkerTask(CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
  path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)),
})), 0)
async function run(mode: string, options: { signal?: AbortSignal; onUsage?: Parameters<typeof executeReviewWorker>[0]['onUsage'];
  onClosed?: Parameters<typeof executeReviewWorker>[0]['onClosed'] } = {}) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'reviewer-native-'))
  try {
    return await executeReviewWorker({
      configuration: { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts'), `--fixture-mode=${mode}`], env: {} },
      workspacePath, task: task(), ...options,
    })
  } finally {
    expect(await readdir(workspacePath)).toEqual([])
    await rm(workspacePath, { recursive: true, force: true })
  }
}

test('actual offline process accepts strict result and keeps cumulative usage once', async () => {
  const snapshots: number[] = []
  const result = await run('success', { onUsage: value => { snapshots.push(value.total_tokens) } })
  expect(result.value.receipts.length).toBeGreaterThan(0)
  expect(result.usage.total_tokens).toBe(10)
  expect(snapshots).toEqual([7, 10])
})

test('stream noise and repeated counters do not flood durable usage or delay the terminal', async () => {
  const snapshots: number[] = []
  const result = await run('usage-noise', { onUsage: async value => {
    snapshots.push(value.total_tokens)
    await new Promise(resolve => setTimeout(resolve, 2))
  } })
  expect(result.value.receipts.length).toBeGreaterThan(0)
  expect(result.usage.total_tokens).toBe(10)
  expect(snapshots).toEqual([7, 10])
})

test('completion persistence is awaited after direct-child close and final usage, before acceptance', async () => {
  let enter!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  let observation: ReviewNativeCompletion<unknown> | undefined
  let lastUsage = 0
  let settled = false
  const result = run('success', { onUsage: value => { lastUsage = value.total_tokens }, async onClosed(value) {
    observation = value
    enter()
    await barrier
  } }).finally(() => { settled = true })
  try {
    await entered
    expect(settled).toBe(false)
    expect(lastUsage).toBe(10)
    expect(observation?.scope).toBe('direct-child')
    expect(observation?.stdoutDrained).toBe(true)
    expect(observation?.usageObserved).toBe(true)
    expect(observation?.usage.total_tokens).toBe(10)
    expect(observation?.outcome.kind).toBe('accepted')
    expect(observation?.pid).toBeGreaterThan(0)
    expect(['term_requested', 'kill_requested']).toContain(observation!.termination)
    expect(observation!.exitCode !== null || observation!.signalCode !== null).toBe(true)
  } finally { release() }
  expect((await result).value.receipts.length).toBeGreaterThan(0)
})

test('failed completion persistence prevents terminal acceptance after the child has closed', async () => {
  let observed = false
  await expect(run('success', { onClosed(value) {
    observed = value.stdoutDrained && value.outcome.kind === 'accepted'
    throw new Error('completion receipt unavailable')
  } })).rejects.toThrow('completion receipt unavailable')
  expect(observed).toBe(true)
})

test('failure completion retains observed usage and pre-spawn cancellation emits no close receipt', async () => {
  let observation: ReviewNativeCompletion<unknown> | undefined
  await expect(run('error', { onClosed(value) { observation = value } })).rejects.toMatchObject({ code: 'model_error' })
  expect(observation?.outcome).toEqual({ kind: 'failed', code: 'model_error' })
  expect(observation?.usageObserved).toBe(true)
  expect(observation?.usage.total_tokens).toBe(10)
  const controller = new AbortController(); controller.abort()
  let closedCalls = 0
  await expect(run('success', { signal: controller.signal, onClosed() { closedCalls++ } })).rejects.toMatchObject({ code: 'stopped' })
  expect(closedCalls).toBe(0)
})

test('a failed spawn never invents a measured zero-usage completion', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'reviewer-no-spawn-'))
  let observation: ReviewNativeCompletion<unknown> | undefined
  try {
    await expect(executeReviewWorker({ workspacePath, configuration: { command: [join(workspacePath, 'absent-worker')], env: {} },
      task: task(), onClosed(value) { observation = value } })).rejects.toMatchObject({ code: 'process_exit' })
    expect(observation?.pid).toBeNull()
    expect(observation?.usageObserved).toBe(false)
    expect(observation?.outcome).toEqual({ kind: 'failed', code: 'process_exit' })
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('matched native StructuredOutput tool receipt is accepted without prose terminal', async () => {
  const result = await run('tool')
  expect(result.value.receipts.length).toBeGreaterThan(0)
  expect(result.usage.total_tokens).toBe(10)
})

test('empty model metadata does not discard direct usage counters', async () => {
  expect((await run('empty-model-usage')).usage.total_tokens).toBe(13)
})

test('native Read permission request is denied without widening packet context', async () => {
  expect((await run('permission')).usage.total_tokens).toBe(10)
})

test('empty, forged, wrong-tool and failed-tool outputs cannot complete', async () => {
  for (const mode of ['empty', 'invalid-output', 'wrong-tool', 'failed-tool']) {
    try { await run(mode); throw new Error('unexpected acceptance') }
    catch (error) {
      expect(error).toBeInstanceOf(ReviewNativeError)
      expect((error as ReviewNativeError).code).toBe('invalid_output')
      expect((error as ReviewNativeError).usage.total_tokens).toBe(10)
    }
  }
})

test('model failure and process exit retain observed usage without leaking native detail', async () => {
  for (const [mode, code] of [['error', 'model_error'], ['exit', 'process_exit'], ['invalid-json', 'protocol_error']] as const) {
    try { await run(mode!); throw new Error('unexpected success') }
    catch (error) {
      expect(error).toBeInstanceOf(ReviewNativeError)
      expect((error as ReviewNativeError).code).toBe(code)
      expect((error as ReviewNativeError).usage.total_tokens).toBe(10)
    }
  }
})

test('cancel waits for child cleanup, rejects late success, and preserves usage', async () => {
  for (const mode of ['stop', 'success']) {
  const controller = new AbortController()
  try {
    await run(mode, { signal: controller.signal, onUsage: value => { if (value.total_tokens === 10) controller.abort() } })
    throw new Error('unexpected success')
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewNativeError)
    expect((error as ReviewNativeError).code).toBe('stopped')
    expect((error as ReviewNativeError).usage.total_tokens).toBe(10)
  }
  }
  const stopped = new AbortController(); stopped.abort()
  await expect(run('success', { signal: stopped.signal })).rejects.toMatchObject({ code: 'stopped' })
})

test('failed durable metering hook prevents terminal acceptance', async () => {
  await expect(run('success', { onUsage: () => { throw new Error('private storage failed') } }))
    .rejects.toMatchObject({ code: 'usage_unavailable', usage: { total_tokens: 7 } })
})

test('configuration cannot smuggle arbitrary variables or override inherited HOME', () => {
  const env = reviewNativeEnvironment({ OPENAI_API_KEY: 'explicit-key', NODE_OPTIONS: '--require=bad', HOME: '/foreign', UNRELATED_SECRET: 'secret' })
  expect(env.OPENAI_API_KEY).toBe('explicit-key')
  expect(env.NODE_OPTIONS).toBeUndefined()
  expect(env.UNRELATED_SECRET).toBeUndefined()
  expect(env.HOME as string | undefined).toBe(process.env.HOME)
})
