import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createReviewerFactController } from '../fact-controller'
import { openReviewerFactJournal } from '../fact-journal'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'
import { selectFoundationFactFastRuntime, selectFoundationSemanticRuntime } from '../model-selection'

const identity = { ownerId: 'controller-owner', projectId: 'project', requestId: 'request' }
const docs = () => CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) }))
async function fixture(run: (input: { workspacePath: string; identity: typeof identity; documents: ReturnType<typeof docs> }) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-controller-')))
  try { await run({ workspacePath, identity, documents: docs() }) }
  finally { await rm(workspacePath, { recursive: true, force: true }) }
}
const client = (mode = 'success') => ({ protocolVersion: 1 as const, ownerId: identity.ownerId, async resolve() {
  return { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts'), `--fixture-mode=${mode}`],
    env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast', OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced' } }
} })
async function until(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 500; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('controller did not reach test condition')
}

test('controller drives all facts with owned lease and completed replay never resolves configuration', async () => fixture(async input => {
  let resolutions = 0
  const infrastructure = client()
  const controller = await createReviewerFactController(input, { ...infrastructure, async resolve() { resolutions++; return infrastructure.resolve() } })
  const initial = await controller.read()
  const result = await controller.run()
  expect(result.state.phase).toBe('facts_staged')
  expect(resolutions).toBe(initial.collection.tasks.length)
  expect(result.state.collection.aggregateUsage.total_tokens).toBe(resolutions * 10)
  const restored = await createReviewerFactController(input, { ...infrastructure, async resolve() { throw new Error('must not execute on replay') } })
  expect((await restored.run()).state).toEqual(result.state)
  const root = join(input.workspacePath, '.beegame/workflow/foundation-reviewer/state', controller.runId)
  expect(await readdir(root)).not.toContain('execution.lock')
}), 20_000)

test('two controllers cannot spawn the same dispatch and remote stop intent is observed', async () => fixture(async input => {
  let resolutions = 0
  const infrastructure = client('stop')
  const owner = await createReviewerFactController(input, { ...infrastructure, async resolve() { resolutions++; return infrastructure.resolve() } })
  const other = await createReviewerFactController(input, client())
  const running = owner.run()
  try {
    await until(async () => (await owner.read()).collection.aggregateUsage.total_tokens >= 10)
    const duplicate = await other.run()
    expect(duplicate.execution).toBe('busy')
    await other.stop('external-stop')
    const result = await running
    expect(result.state.phase).toBe('stopped')
    expect(result.state.collection.tasks.filter(task => task.dispatch).every(task => task.attempt === 0)).toBe(true)
    expect(resolutions).toBeLessThanOrEqual(4)
    expect(result.state.collection.tasks.some(task => task.status === 'completed')).toBe(false)
  } finally { await owner.stop('cleanup'); await running }
}), 20_000)

test('durable stop precedes child termination and explicit continue retains burned usage', async () => fixture(async input => {
  const stoppedClient = client('stop')
  let mode = 'stop'
  const controller = await createReviewerFactController(input, { ...stoppedClient, resolve: () => client(mode).resolve() })
  const running = controller.run()
  await until(async () => (await controller.read()).collection.aggregateUsage.total_tokens >= 10)
  const stopped = await controller.stop('stop')
  await running
  expect(stopped.phase).toBe('stopped')
  const before = stopped.collection.aggregateUsage.total_tokens
  mode = 'success'
  const continued = await controller.resume('continue')
  expect(continued.state.phase).toBe('facts_staged')
  expect(continued.state.collection.aggregateUsage.total_tokens).toBe(before + continued.state.collection.tasks.length * 10)
  expect((await controller.stop('stop')).phase).toBe('facts_staged')
}), 20_000)

test('missing model configuration starts no native work and can be explicitly retried', async () => fixture(async input => {
  let ready = false
  const infrastructure = client()
  const controller = await createReviewerFactController(input, { ...infrastructure, async resolve() {
    const value = await infrastructure.resolve()
    return ready ? value : { ...value, env: {} }
  } })
  const blocked = await controller.run()
  expect(blocked.state.phase).toBe('needs_action')
  expect(blocked.state.collection.tasks.every(task => task.attempt === 0)).toBe(true)
  ready = true
  expect((await controller.resume('config-fixed')).state.phase).toBe('facts_staged')
}), 20_000)

test('native failures consume at most two attempts and preserve usage', async () => fixture(async input => {
  const controller = await createReviewerFactController(input, client('error'))
  const result = await controller.run()
  expect(result.state.phase).toBe('needs_action')
  expect(result.state.collection.tasks.every(task => task.attempt <= 2)).toBe(true)
  expect(result.state.collection.tasks.some(task => task.attempt === 2)).toBe(true)
  expect(result.state.collection.aggregateUsage.total_tokens).toBeGreaterThanOrEqual(20)
  await expect(controller.resume('retry-exhausted')).rejects.toThrow('require action')
}), 20_000)

test('stale owner lease is reported without stealing it or restarting orphan work', async () => fixture(async input => {
  const controller = await createReviewerFactController(input, client())
  const path = join(input.workspacePath, '.beegame/workflow/foundation-reviewer/state', controller.runId, 'execution.lock')
  const record = { version: 1, runId: controller.runId, pid: 2147483647, token: '9d88bc8f-e5ea-46b0-b062-d064f16529d7' }
  await writeFile(path, JSON.stringify(record))
  expect((await controller.run()).execution).toBe('stale')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(record)
  expect((await controller.read()).collection.tasks.every(task => task.attempt === 0)).toBe(true)
}))

test('outstanding claims without an execution owner enter explicit recovery instead of replaying native work', async () => fixture(async input => {
  const journal = await openReviewerFactJournal(input)
  await journal.append('claim', { kind: 'claim', taskId: 'fact-0', dispatchId: 'unobserved' })
  const controller = await createReviewerFactController(input, { ...client(), async resolve() { throw new Error('recovery must not spawn') } })
  const result = await controller.run()
  expect(result.state.phase).toBe('needs_action')
  expect(result.state.collection.tasks[0]!.dispatch?.status).toBe('interrupted')
}))

test('configuration public contract rejects foreign owner', async () => fixture(async input => {
  await expect(createReviewerFactController(input, { ...client(), ownerId: 'another-owner' })).rejects.toThrow('owner mismatch')
}))

test('durable stop cancels a pending configuration wait without later spawning', async () => fixture(async input => {
  let entered = false
  let complete!: (value: Awaited<ReturnType<ReturnType<typeof client>['resolve']>>) => void
  const pending = new Promise<Awaited<ReturnType<ReturnType<typeof client>['resolve']>>>(resolve => { complete = resolve })
  const controller = await createReviewerFactController(input, { ...client(), resolve() { entered = true; return pending } })
  const running = controller.run()
  await until(async () => entered)
  expect((await controller.stop('stop-pending-config')).phase).toBe('stopped')
  expect((await running).state.collection.tasks.every(task => task.attempt === 0)).toBe(true)
  complete(await client().resolve())
  await new Promise(resolve => setTimeout(resolve, 30))
  expect((await controller.read()).collection.tasks.every(task => task.attempt === 0)).toBe(true)
}))

test('execution lease release cannot remove a replacement owner token', async () => fixture(async input => {
  const journal = await openReviewerFactJournal(input)
  const lease = await journal.tryExecutionLease()
  expect(lease.kind).toBe('owned')
  if (lease.kind !== 'owned') throw new Error('lease unavailable')
  expect((await journal.tryExecutionLease()).kind).toBe('busy')
  const path = join(input.workspacePath, '.beegame/workflow/foundation-reviewer/state', journal.runId, 'execution.lock')
  const replacement = { version: 1, runId: journal.runId, pid: process.pid, token: '7b855ca6-67ce-4dc3-908b-9753b4e59fe3' }
  await writeFile(path, JSON.stringify(replacement))
  await expect(lease.release()).rejects.toThrow('not owned')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(replacement)
}))

test('provider tier selection preserves aliases and rejects ambiguous or missing providers', () => {
  for (const provider of ['ANTHROPIC', 'OPENAI', 'GEMINI', 'GROK']) {
    const env = { [`${provider}_DEFAULT_HAIKU_MODEL`]: 'fast', [`${provider}_DEFAULT_SONNET_MODEL`]: 'balanced', [`${provider}_DEFAULT_OPUS_MODEL`]: 'strong' }
    expect(selectFoundationFactFastRuntime(undefined, env)[`${provider}_DEFAULT_SONNET_MODEL`]).toBe('fast')
    expect(selectFoundationSemanticRuntime(undefined, env, 'balanced')[`${provider}_DEFAULT_SONNET_MODEL`]).toBe('balanced')
    expect(selectFoundationSemanticRuntime(undefined, env, 'strong')[`${provider}_DEFAULT_SONNET_MODEL`]).toBe('strong')
    expect(env[`${provider}_DEFAULT_SONNET_MODEL`]).toBe('balanced')
  }
  expect(() => selectFoundationFactFastRuntime(undefined, {})).toThrow()
  expect(() => selectFoundationFactFastRuntime(undefined, { OPENAI_DEFAULT_HAIKU_MODEL: 'a', GEMINI_DEFAULT_HAIKU_MODEL: 'b' })).toThrow('multiple providers')
})
