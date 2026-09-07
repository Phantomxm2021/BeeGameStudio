import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { createReviewerTargetedController, ReviewerTargetedRecoveryRequiredError, targetedControllerMustRecheckAfterIdle } from '../targeted-controller'
import { openReviewerTargetedJournal } from '../targeted-journal'

const fixtureCommand = [process.execPath, join(import.meta.dir, '../test-fixtures/native-targeted-controller.ts')]
const client = (mode = 'success') => ({ protocolVersion: 1 as const, ownerId: 'owner', async resolve(_input: { ownerId: string }) {
  return { command: [...fixtureCommand, `--fixture-mode=${mode}`], env: {
    BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast',
    OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong',
  } }
} })
async function withFixture<T>(normalizedFacts: boolean, run: (value: { workspacePath: string; identity: { ownerId: string; projectId: string; requestId: string }; candidate: ReturnType<typeof firstCandidateFixture>['input'] & { kind: 'first' } }) => Promise<T>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'targeted-controller-')))
  try { return await run({ workspacePath, identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' }, candidate: { kind: 'first', ...firstCandidateFixture(normalizedFacts).input } }) }
  finally { await rm(workspacePath, { recursive: true, force: true }) }
}
async function until(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('targeted controller did not reach fixture condition')
}

test('targeted controller runs the shared fact slots through validation', async () => withFixture(false, async ({ workspacePath, identity, candidate }) => {
  let resolutions = 0
  const infrastructure = client()
  const controller = await createReviewerTargetedController({ workspacePath, identity, candidate }, { ...infrastructure, async resolve(value) { resolutions++; return infrastructure.resolve(value) } })
  const result = await controller.run()
  expect(result.state.factTasks.length).toBeGreaterThan(0)
  expect(result.state.factTasks.every(task => task.status === 'completed')).toBe(true)
  expect(['deterministic_failed', 'semantic_review', 'targeted_staged']).toContain(result.state.phase)
  expect(resolutions).toBeGreaterThan(0)
}), 30_000)

test('idle exit rechecks a stale pre-terminal snapshot before returning', async () => withFixture(false, async ({ workspacePath, identity, candidate }) => {
  const controller = await createReviewerTargetedController({ workspacePath, identity, candidate }, client())
  const terminal = await controller.run()
  // Model the exact race: the loop read extracting_facts before the last
  // worker's accept append, then observed an empty worker map. The journal's
  // fresh state has already crossed the deterministic boundary.
  const stale = { ...structuredClone(terminal.state), phase: 'extracting_facts' as const }
  expect(targetedControllerMustRecheckAfterIdle(stale, terminal.state)).toBe(true)
}), 30_000)

test('targeted semantic controller selects the strong model and stages the summary', async () => withFixture(true, async ({ workspacePath, identity, candidate }) => {
  const controller = await createReviewerTargetedController({ workspacePath, identity, candidate }, client())
  const result = await controller.run()
  expect(result.state.phase).toBe('targeted_staged')
  expect(result.state.semanticTasks.length).toBeGreaterThan(0)
  expect(result.state.semanticTasks.every(task => task.status === 'completed')).toBe(true)
}), 30_000)

test('missing configuration claims no task and explicit resume retries it', async () => withFixture(true, async ({ workspacePath, identity, candidate }) => {
  let ready = false
  const infrastructure = client()
  let calls = 0
  const controller = await createReviewerTargetedController({ workspacePath, identity, candidate }, { ...infrastructure, async resolve(value) {
    calls++
    const resolved = await infrastructure.resolve(value)
    return ready ? resolved : { ...resolved, env: {} }
  } })
  const blocked = await controller.run()
  expect(blocked.state.phase).toBe('needs_action')
  expect(blocked.state.semanticTasks.every(task => task.attempt === 0 && task.dispatch === undefined)).toBe(true)
  ready = true
  expect((await controller.resume('config-fixed')).state.phase).toBe('targeted_staged')
  expect(calls).toBeGreaterThan(1)
}), 30_000)

test('stop records durable intent while configuration is pending', async () => withFixture(true, async ({ workspacePath, identity, candidate }) => {
  let entered = false
  let complete!: (value: Awaited<ReturnType<ReturnType<typeof client>['resolve']>>) => void
  const pendingConfig = new Promise<Awaited<ReturnType<ReturnType<typeof client>['resolve']>>>(resolve => { complete = resolve })
  const controller = await createReviewerTargetedController({ workspacePath, identity, candidate }, { ...client(), async resolve() { entered = true; return pendingConfig } })
  const running = controller.run()
  await until(async () => entered)
  const stopped = await controller.stop('stop-config')
  await running
  expect(stopped.phase).toBe('stopped')
  expect(stopped.semanticTasks.every(task => task.attempt === 0 && task.dispatch === undefined)).toBe(true)
  complete(await client().resolve({ ownerId: 'owner' }))
}), 30_000)

test('invalid worker output retries without a business attempt cap until stopped', async () => withFixture(true, async ({ workspacePath, identity, candidate }) => {
  const controller = await createReviewerTargetedController({ workspacePath, identity, candidate }, client('invalid'))
  const running = controller.run()
  try {
    await until(async () => Object.values((await controller.read()).usageByDispatch).some(value => value.total_tokens > 0))
    await new Promise(resolve => setTimeout(resolve, 500))
    await controller.stop('stop-retries')
    await running
    const state = await controller.read()
    expect(state.semanticTasks.some(task => task.attempt >= 1 && task.status === 'retryable')).toBe(true)
  } finally { await controller.stop('cleanup'); await running.catch(() => {}) }
}), 30_000)

test('free journal with a running dispatch requires lifecycle cleanup before recovery', async () => withFixture(false, async ({ workspacePath, identity, candidate }) => {
  const journal = await openReviewerTargetedJournal({ workspacePath, identity, candidate })
  await journal.append('claim-before-recovery', { kind: 'claim', taskId: 'targeted-fact-0', dispatchId: 'orphan-dispatch' })
  const controller = await createReviewerTargetedController({ workspacePath, identity, candidate }, client())
  await expect(controller.run()).rejects.toBeInstanceOf(ReviewerTargetedRecoveryRequiredError)
  await expect(controller.stop('unsafe-stop')).rejects.toBeInstanceOf(ReviewerTargetedRecoveryRequiredError)
  expect((await controller.read()).factTasks[0]!.status).toBe('running')
}), 30_000)

test('stale targeted execution lease is retained and never stolen', async () => withFixture(true, async ({ workspacePath, identity, candidate }) => {
  const controller = await createReviewerTargetedController({ workspacePath, identity, candidate }, client())
  const path = join(workspacePath, '.beegame/workflow/foundation-reviewer/state', controller.runId, 'execution.lock')
  const record = { version: 1, runId: controller.runId, pid: 2_147_483_647, token: '9d88bc8f-e5ea-46b0-b062-d064f16529d7' }
  await writeFile(path, JSON.stringify(record))
  expect((await controller.run()).execution).toBe('stale')
  expect(await Bun.file(path).json()).toEqual(record)
}), 30_000)
