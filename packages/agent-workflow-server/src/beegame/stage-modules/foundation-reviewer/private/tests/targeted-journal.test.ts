import { expect, test } from 'bun:test'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { ReviewJournalConflictError } from '../journal-storage'
import { openReviewerTargetedJournal } from '../targeted-journal'

const identity = { ownerId: 'owner', projectId: 'project', requestId: 'review' }
const candidate = () => ({ kind: 'first' as const, ...firstCandidateFixture(false).input })
const claim = { kind: 'claim' as const, taskId: 'targeted-fact-0', dispatchId: 'targeted-dispatch' }
async function fixture(run: (workspacePath: string) => Promise<void>) {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-targeted-journal-')))
  try { await run(workspacePath) } finally { await rm(workspacePath, { recursive: true, force: true }) }
}

test('targeted journal captures trusted candidate authority, replays, and keeps read-only reads side-effect free', async () => fixture(async workspacePath => {
  const input = candidate()
  const journal = await openReviewerTargetedJournal({ workspacePath, identity, candidate: input })
  const state = await journal.append('claim', claim)
  expect(state.factTasks[0]!.status).toBe('running')
  const root = join(workspacePath, '.beegame/workflow/foundation-reviewer/state', journal.runId)
  const before = await readdir(join(root, 'events'))
  const reopened = await openReviewerTargetedJournal({ workspacePath, identity, candidate: input })
  expect(await reopened.read()).toEqual(state)
  const readOnly = await openReviewerTargetedJournal({ workspacePath, identity, candidate: input, readOnly: true })
  expect(await readOnly.read()).toEqual(state)
  await expect(readOnly.append('forbidden', claim)).rejects.toThrow('read-only')
  expect(await readdir(join(root, 'events'))).toEqual(before)
}))

test('targeted journal rejects candidate byte tampering before opening the existing journal', async () => fixture(async workspacePath => {
  const input = candidate()
  const journal = await openReviewerTargetedJournal({ workspacePath, identity, candidate: input })
  const tampered = structuredClone(input)
  tampered.candidateResult.documents[0]!.content += '\nforged'
  await expect(openReviewerTargetedJournal({ workspacePath, identity, candidate: tampered })).rejects.toThrow()
  expect(await journal.read()).toEqual(await openReviewerTargetedJournal({ workspacePath, identity, candidate: input }).then(next => next.read()))
}))

test('targeted journal binds every Reviewer request identity and rejects foreign owners', async () => fixture(async workspacePath => {
  const input = candidate()
  const first = await openReviewerTargetedJournal({ workspacePath, identity, candidate: input })
  const otherRequest = await openReviewerTargetedJournal({ workspacePath, identity: { ...identity, requestId: 'another-review' }, candidate: input })
  expect(otherRequest.runId).not.toBe(first.runId)
  await expect(openReviewerTargetedJournal({ workspacePath, identity: { ...identity, ownerId: 'foreign-owner' }, candidate: input })).rejects.toThrow('identity')
}))

test('targeted journal provides command CAS and idempotency for the same immutable event', async () => fixture(async workspacePath => {
  const input = candidate()
  const first = await openReviewerTargetedJournal({ workspacePath, identity, candidate: input })
  const second = await openReviewerTargetedJournal({ workspacePath, identity, candidate: input })
  await first.append('same-command', claim)
  expect((await second.append('same-command', claim)).factTasks[0]!.status).toBe('running')
  await expect(second.append('same-command', { ...claim, dispatchId: 'different' })).rejects.toBeInstanceOf(ReviewJournalConflictError)
}))

test('recover_lost rejects even self-declared cleanup while native cleanup is unavailable', async () => fixture(async workspacePath => {
  const input = candidate()
  const journal = await openReviewerTargetedJournal({ workspacePath, identity, candidate: input })
  await journal.append('claim', claim)
  const cleanup = { path: `.beegame/workflow/foundation-reviewer/state/${journal.runId}/cleanup/dispatch.json`, digest: 'b'.repeat(64), runId: journal.runId, dispatchIds: ['targeted-dispatch'] }
  await expect(journal.append('missing-cleanup', { kind: 'recover_lost', dispatchIds: ['targeted-dispatch'] } as never)).rejects.toThrow()
  await expect(journal.append('forged-cleanup', { kind: 'recover_lost', dispatchIds: ['targeted-dispatch'], cleanup })).rejects.toThrow('cleanup implementation unavailable')
  await expect(journal.append('arbitrary-file', { kind: 'recover_lost', dispatchIds: ['targeted-dispatch'], cleanup: { ...cleanup, path: 'arbitrary.json' } })).rejects.toThrow('cleanup implementation unavailable')
  expect((await journal.read()).factTasks[0]!.status).toBe('running')
}))

test('prototype-looking dispatch IDs retain independent usage snapshots in durable replay', async () => fixture(async workspacePath => {
  const input = candidate()
  const journal = await openReviewerTargetedJournal({ workspacePath, identity, candidate: input })
  await journal.append('claim-proto', { ...claim, dispatchId: '__proto__' })
  await journal.append('usage-proto', { kind: 'usage', taskId: claim.taskId, dispatchId: '__proto__', usage: { input_tokens: 1, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 1 } })
  const state = await journal.append('fail-proto', { kind: 'fail', taskId: claim.taskId, dispatchId: '__proto__', usage: { input_tokens: 1, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 1 }, reason: 'test' })
  await journal.append('claim-constructor', { ...claim, dispatchId: 'constructor' })
  const next = await journal.append('usage-constructor', { kind: 'usage', taskId: claim.taskId, dispatchId: 'constructor', usage: { input_tokens: 2, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 2 } })
  expect(Object.hasOwn(next.usageByDispatch, '__proto__')).toBe(true)
  expect(Object.hasOwn(next.usageByDispatch, 'constructor')).toBe(true)
  expect(next.aggregateUsage.total_tokens).toBe(3)
  expect((await (await openReviewerTargetedJournal({ workspacePath, identity, candidate: input })).read()).aggregateUsage.total_tokens).toBe(3)
  expect(state.aggregateUsage.total_tokens).toBe(1)
}))
