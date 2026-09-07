import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReviewerSemanticController } from '../semantic-controller'
import { createReviewerFactController } from '../fact-controller'
import { openReviewerFactJournal } from '../fact-journal'
import { prepareFoundationReview } from '../prepare-review'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

const identity = { ownerId: 'semantic-controller-owner', projectId: 'project', requestId: 'review' }
const ten = { input_tokens: 7, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 10 }
function client(mode = 'semantic-tiers', provider = 'openai') {
  return { protocolVersion: 1 as const, ownerId: identity.ownerId, async resolve() {
    return { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts'), `--fixture-mode=${mode}`],
      env: { BEEGAME_MODEL_TYPE: provider, [`${provider.toUpperCase()}_DEFAULT_HAIKU_MODEL`]: 'fixture-fast',
        [`${provider.toUpperCase()}_DEFAULT_SONNET_MODEL`]: 'fixture-balanced', [`${provider.toUpperCase()}_DEFAULT_OPUS_MODEL`]: 'fixture-strong' } }
  } }
}
async function fixture(run: (input: Parameters<typeof openReviewerFactJournal>[0]) => Promise<void>, seed = true) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-semantic-controller-')))
  try {
    const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) }))
    const input = { workspacePath, identity, documents }
    if (seed) {
      const prepared = prepareFoundationReview(documents)
      if (prepared.kind !== 'facts_pending') throw new Error('invalid fixture')
      const journal = await openReviewerFactJournal(input)
      for (const [index, packet] of prepared.factPackets.entries()) {
        const taskId = `fact-${index}`, dispatchId = `fact-${index}`
        await journal.append(`claim-${index}`, { kind: 'claim', taskId, dispatchId })
        await journal.append(`accept-${index}`, { kind: 'accept', taskId, dispatchId, usage: ten,
          output: { status: 'completed', results: packet.keys.map(key => ({ key, status: 'absent' })) } })
      }
    }
    await run(input)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
}
async function until(predicate: () => Promise<boolean>) {
  // Reads deliberately replay the full immutable log. Avoid a tight polling
  // loop competing with the execution owner for the same filesystem work.
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 200)) }
  throw new Error('semantic controller did not reach fixture condition')
}

test('semantic controller cannot execute or initialize before facts are staged; owner mismatch is rejected', async () => fixture(async input => {
  let calls = 0
  const controller = await createReviewerSemanticController(input, { ...client(), async resolve() { calls++; throw new Error('must not resolve') } })
  const initial = await controller.read()
  expect((await controller.run()).state).toEqual(initial)
  expect(calls).toBe(0)
  await expect(createReviewerSemanticController(input, { ...client(), ownerId: 'foreign' })).rejects.toThrow('owner mismatch')
}, false))

test('native execution selects fast/balanced/strong, finishes required confirmation, and completed replay is read-only', async () => fixture(async input => {
  let calls = 0
  const configuration = client()
  const controller = await createReviewerSemanticController(input, { ...configuration, async resolve() { calls++; return configuration.resolve() } })
  const pending = controller.run()
  expect(controller.run()).toBe(pending)
  const result = await pending
  expect(result.state.semantic!.phase).toBe('semantic_staged')
  expect(result.state.semantic!.collection.tasks).toHaveLength(11)
  expect(calls).toBe(11)
  expect(result.state.semantic!.collection.aggregateUsage.total_tokens).toBe(100)
  expect(result.state.semantic!.collection.deepAggregateUsage!.total_tokens).toBe(10)
  const restored = await createReviewerSemanticController(input, { ...client(), async resolve() { throw new Error('no configuration on replay') } })
  expect((await restored.run()).state).toEqual(result.state)
  await expect(readFile(join(input.workspacePath, '.beegame/workflow/foundation-reviewer/state', controller.runId, 'execution.lock'))).rejects.toThrow()
}), 60_000)

test('missing strong config preserves all sources and resumes only the unstarted confirmation', async () => fixture(async input => {
  let ready = false, calls = 0
  const controller = await createReviewerSemanticController(input, { ...client(), async resolve() {
    calls++
    const value = await client().resolve()
    if (!ready) delete value.env.OPENAI_DEFAULT_OPUS_MODEL
    return value
  } })
  const blocked = (await controller.run()).state.semantic!
  expect(blocked.phase).toBe('needs_action')
  expect(blocked.collection.tasks.filter(task => task.kind === 'semantic').every(task => task.status === 'completed')).toBe(true)
  const confirmation = blocked.collection.tasks.find(task => task.kind === 'confirmation')!
  expect(confirmation.attempt).toBe(0)
  expect(confirmation.dispatch).toBeUndefined()
  const before = calls
  ready = true
  expect((await controller.resume('strong-config-fixed')).state.semantic!.phase).toBe('semantic_staged')
  expect(calls - before).toBe(1)
}), 60_000)

test('other controller stops a strong worker durably; resume preserves source receipts and burned deep usage', async () => fixture(async input => {
  let mode = 'semantic-strong-stop'
  const controller = await createReviewerSemanticController(input, { ...client(), resolve: () => client(mode).resolve() })
  const peer = await createReviewerSemanticController(input, client())
  const facts = await createReviewerFactController(input, client())
  const pending = controller.run()
  try {
    await until(async () => ((await controller.read()).semantic?.collection.deepAggregateUsage?.total_tokens ?? 0) >= 10)
    expect((await peer.run()).execution).toBe('busy')
    expect((await facts.run()).execution).toBe('busy')
    await peer.stop('remote-stop')
    const stopped = (await pending).state.semantic!
    expect(stopped.phase).toBe('stopped')
    expect(stopped.collection.tasks.find(task => task.kind === 'confirmation')!.attempt).toBe(0)
    mode = 'semantic-tiers'
    const resumed = (await controller.resume('resume-strong')).state
    expect(resumed.semantic!.phase).toBe('semantic_staged')
    expect(resumed.semantic!.collection.deepAggregateUsage!.total_tokens).toBe(20)
    expect((await peer.stop('remote-stop')).semantic!.phase).toBe('semantic_staged')
  } finally { await controller.stop('cleanup'); await pending }
}), 90_000)

test('pending configuration can be stopped before claim, and late configuration cannot spawn', async () => fixture(async input => {
  let entered = false
  let complete!: (value: Awaited<ReturnType<ReturnType<typeof client>['resolve']>>) => void
  const configuration = new Promise<Awaited<ReturnType<ReturnType<typeof client>['resolve']>>>(resolve => { complete = resolve })
  const controller = await createReviewerSemanticController(input, { ...client(), resolve() { entered = true; return configuration } })
  const pending = controller.run()
  await until(async () => entered)
  expect((await controller.stop('stop-config')).semantic!.phase).toBe('stopped')
  await pending
  complete(await client().resolve())
  await new Promise(resolve => setTimeout(resolve, 30))
  expect((await controller.read()).semantic!.collection.tasks.every(task => task.attempt === 0)).toBe(true)
}), 60_000)

test('strong native failure cannot retry beyond one, even after explicit resume', async () => fixture(async input => {
  const controller = await createReviewerSemanticController(input, client('semantic-strong-error'))
  const result = (await controller.run()).state.semantic!
  expect(result.phase).toBe('needs_action')
  expect(result.collection.tasks.find(task => task.kind === 'confirmation')!.attempt).toBe(1)
  expect(result.collection.deepAggregateUsage!.total_tokens).toBe(10)
  await expect(controller.resume('retry-exhausted')).rejects.toThrow('requires action')
}), 60_000)

test('ownerless running siblings in needs_action are recorded lost, without configuration or spawning', async () => fixture(async input => {
  const journal = await openReviewerFactJournal(input)
  await journal.append('begin', { kind: 'begin_semantic' })
  await journal.append('claim', { kind: 'semantic', command: { kind: 'claim', taskId: 'semantic-0', dispatchId: 'orphan' } })
  await journal.append('config', { kind: 'semantic', command: { kind: 'configuration_unavailable', taskId: 'semantic-1' } })
  const controller = await createReviewerSemanticController(input, { ...client(), async resolve() { throw new Error('must not execute') } })
  const state = (await controller.run()).state.semantic!
  expect(state.phase).toBe('needs_action')
  expect(state.collection.tasks[0]!.dispatch!.status).toBe('interrupted')
  expect(state.collection.tasks[0]!.attempt).toBe(1)
}), 60_000)

test('stale semantic lease is retained and never stolen', async () => fixture(async input => {
  const controller = await createReviewerSemanticController(input, client())
  const path = join(input.workspacePath, '.beegame/workflow/foundation-reviewer/state', controller.runId, 'execution.lock')
  const record = { version: 1, runId: controller.runId, pid: 2147483647, token: '9d88bc8f-e5ea-46b0-b062-d064f16529d7' }
  await writeFile(path, JSON.stringify(record))
  expect((await controller.run()).execution).toBe('stale')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(record)
  expect((await controller.read()).semantic).toBeUndefined()
}))

test('stop before the first semantic run persists a pause and cannot be bypassed by run', async () => fixture(async input => {
  let calls = 0
  const controller = await createReviewerSemanticController(input, { ...client(), async resolve() { calls++; throw new Error('paused work must not resolve') } })
  const stopped = await controller.stop('before-run')
  expect(stopped.semantic!.phase).toBe('stopped')
  expect((await controller.run()).state).toEqual(stopped)
  expect(calls).toBe(0)
  expect(stopped.semantic!.collection.tasks.every(task => !task.dispatch)).toBe(true)
}))
