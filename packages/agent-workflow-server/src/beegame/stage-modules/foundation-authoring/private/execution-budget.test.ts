import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile, symlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAuthorBudget } from './execution-budget'
import { runAutonomousAuthor } from './autonomous-native'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'author-budget-')))
  roots.push(root); await mkdir(join(root, 'docs'))
  return root
}
const limits = { maxActiveMs: 2000, maxNoDocumentProgressMs: 120 }
const waitAbort = (signal: AbortSignal) => signal.aborted ? Promise.resolve() :
  new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))

test('no document progress warns without stopping, even beyond legacy active-time limit', async () => {
  const root = await workspace()
  await writeFile(join(root, 'docs/GDD.md'), '# Draft')
  const warnings: string[] = []
  const budget = await startAuthorBudget(root, { ...limits, maxActiveMs: 150 }, warning => { warnings.push(warning) })
  const noise = setInterval(() => { void writeFile(join(root, 'notes.md'), String(Date.now()))
    void utimes(join(root, 'docs/GDD.md'), new Date(), new Date()) }, 20)
  try { await pause(350); expect(budget.signal.aborted).toBe(false)
    expect(budget.failure()).toBeUndefined()
    expect(warnings).toEqual(['document_progress_warning', 'active_time_warning'])
    expect(budget.progress().changedDocuments).toBe(0) }
  finally { clearInterval(noise); await budget.close() }
})

test('changed documents still report progress, active time only warns once', async () => {
  const root = await workspace()
  const warnings: string[] = []
  const budget = await startAuthorBudget(root, { ...limits, maxActiveMs: 150 }, warning => { warnings.push(warning) })
  let revision = 0
  const work = setInterval(() => { void writeFile(join(root, 'docs/GDD.md'), '# Draft ' + ++revision) }, 40)
  try { await pause(350); expect(budget.signal.aborted).toBe(false)
    expect(budget.progress().changedDocuments).toBe(1)
    expect(warnings).toEqual(['active_time_warning']) }
  finally { clearInterval(work); await budget.close() }
})

test('unsafe document progress fails closed without following links', async () => {
  const root = await workspace()
  await symlink('/etc/passwd', join(root, 'docs/GDD.md'))
  const budget = await startAuthorBudget(root, limits)
  try { expect(budget.signal.aborted).toBe(true); expect(budget.failure()).toBe('document_progress_unavailable') }
  finally { await budget.close() }
})

test('large output usage is observed without stopping authoring', async () => {
  const root = await workspace(), observed: number[] = []
  const outcome = await runAutonomousAuthor({ configuration: { command: ['offline'], env: {} }, workspacePath: root,
    logPath: join(root, 'unused'), executionLimits: limits, signal: new AbortController().signal,
    async onUsage(usage) { observed.push(usage.completion_tokens) }, async onProgress() {},
  }, async input => {
    expect(input.prompt).not.toContain('token limit')
    await input.onMessage!({ type: 'assistant', message: { id: 'one', usage: { input_tokens: 1, output_tokens: 83_044 } } })
    expect(input.signal?.aborted).toBe(false)
    await input.onMessage!({ type: 'result', modelUsage: { fixture: { inputTokens: 1, outputTokens: 90_000 } } })
    expect(input.signal?.aborted).toBe(false)
    return { result: { structured_output: { status: 'completed', summary: 'Success beyond the retired cap' } },
      completion: { scope: 'direct-child', pid: null, exitCode: 0, signalCode: null, stdoutDrained: true, termination: 'none' } }
  })
  expect(outcome.failure).toBeUndefined()
  expect(outcome.report?.status).toBe('completed')
  expect(outcome.usage?.completion_tokens).toBe(90_000)
  expect(observed).toEqual([83_044, 90_000])
})

test('model work survives time warnings and an explicit stop still aborts and drains usage', async () => {
  const root = await workspace()
  const stop = new AbortController(), progress: string[] = []
  const outcome = await runAutonomousAuthor({ configuration: { command: ['offline'], env: {} }, workspacePath: root,
    logPath: join(root, 'unused'), executionLimits: { ...limits, maxActiveMs: 150 }, signal: stop.signal,
    async onUsage() {}, async onProgress(value) { progress.push(value.message) },
  }, async input => {
    expect(input.responseTrace).toBe(true)
    expect(input.env.BEEGAME_EXTERNAL_REVIEW).toBe('1')
    expect(input.prompt).not.toContain('Attempt policy')
    expect(input.prompt).not.toContain('attemptDeadlineAt')
    await pause(350)
    expect(input.signal!.aborted).toBe(false)
    stop.abort(); await waitAbort(input.signal!)
    await input.onMessage!({ type: 'result', modelUsage: { fixture: { inputTokens: 1, outputTokens: 2 } } })
    return { failure: 'stopped', completion: { scope: 'direct-child', pid: null, exitCode: 0, signalCode: null, stdoutDrained: true, termination: 'term_requested' } }
  })
  expect(outcome.failure).toBe('stopped')
  expect(progress.some(message => message.includes('任务继续'))).toBe(true)
  expect(outcome.usage?.completion_tokens).toBe(2)
})
