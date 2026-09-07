import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readdir, lstat, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReviewerTargetedLifecycle } from '../targeted-lifecycle'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { parseReviewerCandidateStart, reviewerCandidateInputDigest } from '../candidate-contract'
import { createReviewerAllRegistrations } from '../review-contract'
import { openReviewerTargetedJournal } from '../targeted-journal'
import { offlineReviewerBilling } from '../test-fixtures/offline-billing'

function start() {
  const { input: authority } = firstCandidateFixture()
  const input = { kind: 'first' as const, ...authority }
  const identity = { ownerId: authority.sourceBinding.ownerId, projectId: authority.sourceBinding.projectId, requestId: 'targeted-lifecycle-request' }
  return parseReviewerCandidateStart({ protocolVersion: 1, ...identity, input, inputDigest: reviewerCandidateInputDigest({ ...identity, input }) })
}
const journalInput = (workspacePath: string, value: ReturnType<typeof start>) => ({ workspacePath,
  identity: { ownerId: value.ownerId, projectId: value.projectId, requestId: value.requestId }, candidate: value.input })
const configuration = (ownerId: string, mode = 'targeted-pass') => ({ protocolVersion: 1 as const, ownerId, async resolve() {
  return { command: [process.execPath, join(import.meta.dir, '../test-fixtures/native-reviewer.ts'), `--fixture-mode=${mode}`],
    env: { BEEGAME_MODEL_TYPE: 'openai', OPENAI_DEFAULT_HAIKU_MODEL: 'fixture-fast', OPENAI_DEFAULT_SONNET_MODEL: 'fixture-balanced', OPENAI_DEFAULT_OPUS_MODEL: 'fixture-strong' } }
} })
async function fixture(run: (workspacePath: string) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'targeted-lifecycle-')))
  try { await run(workspacePath) } finally { await rm(workspacePath, { recursive: true, force: true }) }
}
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 25_000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)) }
  throw new Error('targeted lifecycle did not reach expected state')
}
async function snapshot(path: string): Promise<unknown> {
  const stat = await lstat(path)
  return stat.isDirectory() ? [stat.mtimeMs, await Promise.all((await readdir(path)).sort().map(async name => [name, await snapshot(join(path, name))]))]
    : [stat.mtimeMs, await readFile(path, 'utf8')]
}

test('targeted lifecycle owns execution, public candidate evidence, billing and read-only restart', async () => fixture(async workspacePath => {
  const input = start()
  const billing = offlineReviewerBilling(input.ownerId)
  let calls = 0
  const config = configuration(input.ownerId)
  const api = createReviewerTargetedLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: { ...config, async resolve() { calls++; return config.resolve() } } })
  const handle = await api.start(input)
  expect(await api.start(input)).toEqual(handle)
  const result = await until(() => api.getResult(handle), value => value.status === 'completed' && value.billingStatus === 'settled')
  if (result.status !== 'completed') throw new Error('no candidate result')
  expect(result.result.subject.kind).toBe('candidate')
  if (result.result.recheck?.kind !== 'targeted') throw new Error('targeted evidence missing')
  expect(result.result.recheck!.decision).toBe('round_complete')
  expect(calls).toBe(1)
  expect(billing.recorded.size).toBe(1)
  const journal = await openReviewerTargetedJournal({ ...journalInput(workspacePath, input), readOnly: true })
  await until(() => journal.leaseStatus(), value => value === 'free')
  const before = await snapshot(workspacePath)
  const reopened = createReviewerTargetedLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: { ...config, async resolve() { throw new Error('lookup must not execute') } } })
  expect(await reopened.getResult(handle)).toEqual(result)
  expect(await snapshot(workspacePath)).toEqual(before)
  const resultRoot = join(workspacePath, `.beegame/workflow/foundation-reviewer/results/${result.result.resultId}`)
  await unlink(join(resultRoot, 'COMMITTED.json'))
  const incompleteBefore = await snapshot(resultRoot)
  expect(await reopened.start(input)).toEqual(handle)
  await new Promise(resolve => setTimeout(resolve, 50))
  expect((await reopened.getResult(handle)).status).toBe('needs_action')
  expect(await snapshot(resultRoot)).toEqual(incompleteBefore)
  expect(await readdir(workspacePath)).toEqual(['.beegame'])
}), 35_000)

test('targeted FAIL becomes an immutable same-round retry result, not an execution failure', async () => fixture(async workspacePath => {
  const input = start()
  const api = createReviewerTargetedLifecycle(workspacePath, { billing: offlineReviewerBilling(input.ownerId).client, runtimeConfiguration: configuration(input.ownerId, 'targeted-fail') })
  const handle = await api.start(input)
  const result = await until(() => api.getResult(handle), value => value.status === 'completed' && value.billingStatus === 'settled')
  if (result.status !== 'completed') throw new Error('no candidate result')
  expect(result.result.kind).toBe('issues_found')
  if (result.result.recheck?.kind !== 'targeted') throw new Error('targeted evidence missing')
  expect(result.result.recheck!.decision).toBe('retry_same_round')
  expect(result.result.recheck!.issueVerdicts[0]!.status).toBe('FAIL')
}), 35_000)

test('missing configuration creates no dispatch and explicit resume completes only unfinished targeted work', async () => fixture(async workspacePath => {
  const input = start()
  const billing = offlineReviewerBilling(input.ownerId)
  const config = configuration(input.ownerId)
  const api = createReviewerTargetedLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: { ...config, async resolve() { throw new Error('not configured') } } })
  const handle = await api.start(input)
  const blocked = await until(() => api.getResult(handle), value => value.status === 'needs_action')
  expect(blocked.status === 'needs_action' && blocked.resumable).toBe(true)
  const journal = await openReviewerTargetedJournal({ ...journalInput(workspacePath, input), readOnly: true })
  expect((await journal.read()).semanticTasks[0]!.attempt).toBe(0)
  expect(billing.recorded.size).toBe(0)
  const resumed = createReviewerTargetedLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: config })
  await resumed.resume({ handle, requestId: 'config-restored' })
  await until(() => resumed.getResult(handle), value => value.status === 'completed' && value.billingStatus === 'settled')
  expect((await journal.read()).semanticTasks[0]!.attempt).toBe(1)
}), 35_000)

test('stop cancels pending configuration without a claim and duplicate start cannot resume it', async () => fixture(async workspacePath => {
  const input = start()
  const billing = offlineReviewerBilling(input.ownerId)
  const config = configuration(input.ownerId)
  let calls = 0
  const api = createReviewerTargetedLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: { ...config, async resolve() { calls++; return new Promise<Awaited<ReturnType<typeof config.resolve>>>(() => {}) } } })
  const handle = await api.start(input)
  await until(async () => calls, value => value > 0)
  await api.stop({ handle, requestId: 'stop-before-claim', reason: 'operator stop' })
  await until(() => api.getResult(handle), value => value.status === 'stopped')
  expect(await api.start(input)).toEqual(handle)
  await until(() => api.getResult(handle), value => value.status === 'stopped')
  const journal = await openReviewerTargetedJournal({ ...journalInput(workspacePath, input), readOnly: true })
  expect((await journal.read()).semanticTasks[0]!.dispatch).toBeUndefined()
  expect(calls).toBe(1)
  expect(billing.recorded.size).toBe(0)
}), 35_000)

test('stop and resume cannot launder an unowned native claim into retry authority', async () => fixture(async workspacePath => {
  const input = start()
  const registration = await createReviewerAllRegistrations(workspacePath, input.ownerId).register(input)
  const journal = await openReviewerTargetedJournal(journalInput(workspacePath, input))
  await journal.append('validate', { kind: 'validate' })
  await journal.append('claim', { kind: 'claim', taskId: 'targeted-semantic-0', dispatchId: 'unowned' })
  const config = configuration(input.ownerId)
  const api = createReviewerTargetedLifecycle(workspacePath, { billing: offlineReviewerBilling(input.ownerId).client, runtimeConfiguration: { ...config, async resolve() { throw new Error('unowned claim must not execute') } } })
  for (const value of [await api.getResult(registration.handle), await api.stop({ handle: registration.handle, requestId: 'stop-unowned', reason: 'operator stop' }),
    await api.resume({ handle: registration.handle, requestId: 'resume-unowned' })])
    expect(value.status === 'needs_action' && !value.resumable).toBe(true)
  expect((await journal.read()).semanticTasks[0]!.status).toBe('running')
}))

test('getResult does not repair an incomplete publication; explicit resume repairs only its marker', async () => fixture(async workspacePath => {
  const input = start()
  const config = configuration(input.ownerId)
  const billing = offlineReviewerBilling(input.ownerId)
  let calls = 0
  const api = createReviewerTargetedLifecycle(workspacePath, { billing: billing.client, runtimeConfiguration: { ...config, async resolve() { calls++; return config.resolve() } } })
  const handle = await api.start(input)
  const result = await until(() => api.getResult(handle), value => value.status === 'completed' && value.billingStatus === 'settled')
  if (result.status !== 'completed') throw new Error('not completed')
  const journal = await openReviewerTargetedJournal({ ...journalInput(workspacePath, input), readOnly: true })
  await until(() => journal.leaseStatus(), value => value === 'free')
  await unlink(join(workspacePath, `.beegame/workflow/foundation-reviewer/results/${result.result.resultId}/COMMITTED.json`))
  const before = await snapshot(workspacePath)
  expect((await api.getResult(handle)).status).toBe('needs_action')
  expect(await snapshot(workspacePath)).toEqual(before)
  await api.resume({ handle, requestId: 'republish' })
  expect(await until(() => api.getResult(handle), value => value.status === 'completed')).toEqual(result)
  expect(calls).toBe(1)
  expect(billing.recorded.size).toBe(1)
}), 35_000)
