import { expect, test } from 'bun:test'
import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { reviewerDigest } from '../review-summary'
import { REVIEW_WORKER_OUTPUT_MAX_BYTES } from '../worker-task'
import { createReviewerNativeCompletionStore, type ReviewerNativeCompletionBinding, type ReviewerNativeCompletionLease } from '../native-completion-store'
import type { ReviewNativeCompletion } from '../native-worker'

const runId = 'a'.repeat(64)
const headerDigest = 'b'.repeat(64)
const leaseDigest = 'c'.repeat(64)
const binding: ReviewerNativeCompletionBinding = { taskId: 'fact-0', dispatchId: 'dispatch-0', revision: 'd'.repeat(64), packetDigest: 'e'.repeat(64) }
const observation: ReviewNativeCompletion<unknown> = {
  scope: 'direct-child', pid: 1234, exitCode: 0, signalCode: null, termination: 'none', stdoutDrained: true, usageObserved: true,
  usage: { prompt_tokens: 7, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 10 },
  outcome: { kind: 'accepted', value: { status: 'completed', results: [] } },
}

async function fixture(run: (workspacePath: string) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-native-completion-store-')))
  try { await run(workspacePath) } finally { await rm(workspacePath, { recursive: true, force: true }) }
}

function lease(workspacePath: string, overrides: Partial<ReviewerNativeCompletionLease> = {}): ReviewerNativeCompletionLease {
  const runRoot = join(resolve(workspacePath), '.beegame/workflow/foundation-reviewer/state', runId)
  return { runId, scope: reviewerDigest(runRoot), leaseDigest, async assertOwned() {}, ...overrides }
}

function completionPath(workspacePath: string, dispatchId = binding.dispatchId) {
  return join(resolve(workspacePath), '.beegame/workflow/foundation-reviewer/state', runId, 'native-completions', `${reviewerDigest(dispatchId)}.json`)
}

test('missing completion reads are side-effect free and return undefined', async () => fixture(async workspacePath => {
  const store = createReviewerNativeCompletionStore({ workspacePath, runId, headerDigest })
  expect(await readdir(workspacePath)).toEqual([])
  expect(await store.read(binding, leaseDigest)).toBeUndefined()
  expect(await readdir(workspacePath)).toEqual([])
}))

test('completion records are immutable and same-payload writes are idempotent', async () => fixture(async workspacePath => {
  const store = createReviewerNativeCompletionStore({ workspacePath, runId, headerDigest })
  const owner = lease(workspacePath)
  const first = await store.record(binding, observation, owner)
  expect(await store.read(binding, leaseDigest)).toEqual(observation)
  expect(await store.record(binding, observation, owner)).toEqual(first)
  await expect(store.record(binding, { ...observation, exitCode: 1 }, owner)).rejects.toThrow()
}))

test('foreign lease, header, run, and binding identities cannot read or write another completion', async () => fixture(async workspacePath => {
  const store = createReviewerNativeCompletionStore({ workspacePath, runId, headerDigest })
  await store.record(binding, observation, lease(workspacePath))
  await expect(store.record(binding, observation, lease(workspacePath, { runId: 'f'.repeat(64) }))).rejects.toThrow('binding')
  await expect(store.record(binding, observation, lease(workspacePath, { scope: 'f'.repeat(64) }))).rejects.toThrow('binding')
  await expect(store.read({ ...binding, taskId: 'fact-1' }, leaseDigest)).rejects.toThrow('binding')
  await expect(store.read({ ...binding, revision: 'f'.repeat(64) }, leaseDigest)).rejects.toThrow('binding')
  await expect(store.read({ ...binding, packetDigest: 'f'.repeat(64) }, leaseDigest)).rejects.toThrow('binding')
  await expect(store.read(binding, 'f'.repeat(64))).rejects.toThrow('binding')
  const foreignHeader = createReviewerNativeCompletionStore({ workspacePath, runId, headerDigest: 'f'.repeat(64) })
  await expect(foreignHeader.read(binding, leaseDigest)).rejects.toThrow('binding')
  const foreignRun = createReviewerNativeCompletionStore({ workspacePath, runId: 'f'.repeat(64), headerDigest })
  expect(await foreignRun.read(binding, leaseDigest)).toBeUndefined()
}))

test('tampered bytes, invalid observation data, and an oversized accepted value are rejected', async () => fixture(async workspacePath => {
  const store = createReviewerNativeCompletionStore({ workspacePath, runId, headerDigest })
  await store.record(binding, observation, lease(workspacePath))
  await writeFile(completionPath(workspacePath), '{"version":1}\n')
  await expect(store.read(binding, leaseDigest)).rejects.toThrow()

  const freshWorkspace = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-native-completion-value-')))
  try {
    const fresh = createReviewerNativeCompletionStore({ workspacePath: freshWorkspace, runId, headerDigest })
    await expect(fresh.record(binding, { ...observation, usage: { ...observation.usage, total_tokens: 9 } }, lease(freshWorkspace))).rejects.toThrow()
    await expect(fresh.record(binding, { ...observation, outcome: { kind: 'accepted', value: 'x'.repeat(REVIEW_WORKER_OUTPUT_MAX_BYTES + 1) } }, lease(freshWorkspace))).rejects.toThrow()
  } finally { await rm(freshWorkspace, { recursive: true, force: true }) }
}))

test('a failed ownership assertion creates no completion directories or files', async () => fixture(async workspacePath => {
  let assertions = 0
  const owner = lease(workspacePath, { async assertOwned() { assertions++; throw new Error('lease lost') } })
  const store = createReviewerNativeCompletionStore({ workspacePath, runId, headerDigest })
  await expect(store.record(binding, observation, owner)).rejects.toThrow('lease lost')
  expect(assertions).toBe(1)
  expect(await readdir(workspacePath)).toEqual([])
}))

// Synthetic observations exercise only this store's persistence contract; native close causality is covered by native-worker hook tests.
test('unknown usage remains explicitly unobserved instead of being inferred as zero', async () => fixture(async workspacePath => {
  const store = createReviewerNativeCompletionStore({ workspacePath, runId, headerDigest })
  const unknown: ReviewNativeCompletion<unknown> = { ...observation, usageObserved: false,
    usage: { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 },
    outcome: { kind: 'failed', code: 'process_exit' } }
  await store.record(binding, unknown, lease(workspacePath))
  expect((await store.read(binding, leaseDigest))?.usageObserved).toBe(false)
  expect((await store.read(binding, leaseDigest))?.outcome).toEqual({ kind: 'failed', code: 'process_exit' })
}))

test('shared JSON values are valid but sparse and cyclic payloads cannot publish unreadable records', async () => fixture(async workspacePath => {
  const store = createReviewerNativeCompletionStore({ workspacePath, runId, headerDigest })
  const shared = { status: 'completed' }
  const value = { first: shared, second: shared }
  await store.record(binding, { ...observation, outcome: { kind: 'accepted', value } }, lease(workspacePath))
  expect((await store.read(binding, leaseDigest))?.outcome).toEqual({ kind: 'accepted', value })
  await expect(store.record({ ...binding, dispatchId: 'sparse' }, { ...observation,
    outcome: { kind: 'accepted', value: new Array(2) } }, lease(workspacePath))).rejects.toThrow()
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic
  await expect(store.record({ ...binding, dispatchId: 'cyclic' }, { ...observation,
    outcome: { kind: 'accepted', value: cyclic } }, lease(workspacePath))).rejects.toThrow()
}))
