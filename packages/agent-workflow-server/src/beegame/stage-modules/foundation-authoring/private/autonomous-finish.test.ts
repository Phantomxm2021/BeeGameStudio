import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorDigest, type AuthorStartInput } from './contract'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { createAutonomousAuthorLifecycle } from './autonomous-lifecycle'
import { runAutonomousAuthor, type AutonomousNativeExecutor } from './autonomous-native'
import { boundedFinishExecutionLimits, defaultAuthorExecutionLimits } from './execution-budget'
import { authorBytesDigest } from './autonomous-files'
import type { UsageBillingClient } from '../../../../billing/public'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const usage = { prompt_tokens: 2, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 5 }
const caps = { maxActiveMs: 300_000, maxNoDocumentProgressMs: 300_000 }
async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'author-finish-regression-')))
  roots.push(root)
  await mkdir(join(root, 'docs'))
  return root
}
async function until(read: () => Promise<boolean>) {
  for (let count = 0; count < 500; count++) {
    if (await read()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Finish fixture timed out')
}
const start = (): AuthorStartInput => {
  const confirmedBrief = 'Preserve the eight bee game drafts and finish the handoff.'
  const input = { confirmedBrief, confirmedBriefDigest: authorBytesDigest(confirmedBrief) }
  return { protocolVersion: 1, requestId: 'finish-fixture', ownerId: 'owner', projectId: 'project', input,
    inputDigest: authorDigest({ ownerId: 'owner', projectId: 'project', input }) }
}

test('explicit diagnostic thresholds remain available without output caps', () => {
  expect(boundedFinishExecutionLimits(defaultAuthorExecutionLimits)).toEqual(caps)
  const smaller = { maxActiveMs: 99, maxNoDocumentProgressMs: 22 }
  expect(boundedFinishExecutionLimits(smaller)).toEqual({ maxActiveMs: 99, maxNoDocumentProgressMs: 22 })
  expect(defaultAuthorExecutionLimits).not.toHaveProperty('maxOutputTokens')
  expect(defaultAuthorExecutionLimits.maxActiveMs).toBe(30 * 60_000)
})

test('an explicit resumed old candidate finishes unchanged drafts without production time limits and seals two usages', async () => {
  const root = await workspace()
  // Retained, valid baseline documents must not force a fresh full budget.
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(root, path), `# ${path}\n\nKeep this existing design decision.\n`)
  const configuration = { workspacePath: root, privateRootPath: join(root, '.beegame/workflow/foundation-authoring/state'), model: { command: ['never-spawned'], env: {} } }
  let calls = 0, candidate = ''
  const billed: string[] = []
  const billing: UsageBillingClient = { protocolVersion: 1, ownerId: 'owner', async submitUsage(value) {
    billed.push(value.eventId)
    return { protocolVersion: 1 as const, ownerId: value.ownerId, eventId: value.eventId, idempotencyKey: value.eventId,
      pricingVersion: 'weighted-v1' as const, usageSource: 'runtime_snapshot' as const, usage: value.usage, duplicate: false, skipped: true }
  } }
  const execute: AutonomousNativeExecutor = async input => {
    calls++; candidate = input.workspacePath
    await input.onUsage(usage)
    if (calls === 1) {
      expect(input.finishOnly).not.toBe(true)
      expect(input.executionLimits).toBeUndefined()
      return { failure: 'active_time_budget', usage }
    }
    expect(input.finishOnly).toBe(true)
    expect(input.executionLimits).toBeUndefined()
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
      expect(await readFile(join(candidate, path), 'utf8')).toBe(await readFile(join(root, path), 'utf8'))
    await input.onProgress({ modelResponses: 1, message: 'Checking preserved drafts' })
    return { report: { status: 'completed', summary: 'Existing drafts checked without rewriting.' }, usage }
  }
  const first = createAutonomousAuthorLifecycle(configuration, { billing }, execute)
  const handle = await first.start(start())
  await until(async () => (await first.getResult(handle)).status === 'needs_action')
  expect(billed).toHaveLength(1)
  const resumed = createAutonomousAuthorLifecycle(configuration, { billing }, execute)
  for (let index = 0; index < 3; index++) expect((await resumed.getResult(handle)).status).toBe('needs_action')
  expect(calls).toBe(1)
  await resumed.resume({ handle, requestId: 'explicit-finish' })
  await until(async () => calls === 2 && (await resumed.getResult(handle)).status === 'completed')
  const result = await resumed.getResult(handle)
  expect(result.billingStatus).toBe('settled')
  expect(result.status === 'completed' && result.result.documents).toHaveLength(8)
  expect(new Set(billed).size).toBe(2)
  expect(await readFile(join(candidate, 'requirements.md'), 'utf8')).toBe(start().input.confirmedBrief)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) expect(await readFile(join(candidate, path), 'utf8')).toContain('Keep this existing design decision.')
  await resumed.resume({ handle, requestId: 'explicit-finish' })
  expect(calls).toBe(2)
})

test('unsafe later candidate cannot hide behind an earlier missing draft on explicit resume', async () => {
  const root = await workspace()
  let calls = 0, candidate = ''
  const stage = createAutonomousAuthorLifecycle({ workspacePath: root, privateRootPath: join(root, '.beegame/workflow/foundation-authoring/state'), model: { command: ['never-spawned'], env: {} } }, {}, async input => {
    calls++; candidate = input.workspacePath
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(candidate, path), '# Preserved draft')
    return { failure: 'active_time_budget', usage }
  })
  const handle = await stage.start(start())
  await until(async () => (await stage.getResult(handle)).status === 'needs_action')
  await rm(join(candidate, CANONICAL_FOUNDATION_DOCUMENTS[0]))
  const unsafe = join(candidate, CANONICAL_FOUNDATION_DOCUMENTS[7])
  await rm(unsafe)
  await symlink(join(candidate, 'requirements.md'), unsafe)
  await stage.resume({ handle, requestId: 'unsafe-resume' })
  // The resume operation must refuse admission before scheduling execution.
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(calls).toBe(1)
  const result = await stage.getResult(handle)
  expect(result.status).toBe('needs_action')
  expect(result.status === 'needs_action' && result.reason).toContain('unsafe')
})

test('native finish mode exceeds the retired output cap while preserving scope and usage', async () => {
  const root = await workspace()
  const result = await runAutonomousAuthor({ configuration: { command: ['never-spawned'], env: {} }, workspacePath: root,
    logPath: join(root, 'unused.log'), finishOnly: true, executionLimits: defaultAuthorExecutionLimits, signal: new AbortController().signal,
    onUsage: async () => {}, onProgress: async () => {},
  }, async input => {
    expect(input.prompt).toContain('Preserve useful completed work')
    expect(input.prompt).not.toMatch(/audit|review|consistency|finish immediately/i)
    expect(input.prompt).not.toContain('"maxOutputTokens"')
    await input.onMessage?.({ type: 'result', modelUsage: { fixture: { inputTokens: 1, outputTokens: 90_000 } } })
    expect(input.signal?.aborted).toBe(false)
    return { result: { structured_output: { status: 'completed', summary: 'Late completion' } },
      completion: { scope: 'direct-child', pid: null, exitCode: 0, signalCode: null, stdoutDrained: true, termination: 'none' } }
  })
  expect(result.failure).toBeUndefined()
  expect(result.report?.status).toBe('completed')
  expect(result.usage?.completion_tokens).toBe(90_000)
})
