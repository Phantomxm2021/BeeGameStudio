import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, readdir, unlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { applyReviewerTargetedEvent, initialReviewerTargetedState } from '../targeted-state'
import { buildReviewerTargetedResultFromState, publishReviewerTargetedResult } from '../targeted-publication'
import { readReviewerPublishedResult } from '../review-publication'

function completed() {
  const { prepared: candidate } = firstCandidateFixture()
  const at = '2026-09-06T00:00:00.000Z'
  const evidence = { path: '.beegame/workflow/foundation-reviewer/state/test/events/00000002.json', digest: 'a'.repeat(64), runId: 'test' }
  let state = initialReviewerTargetedState(candidate)
  state = applyReviewerTargetedEvent(state, candidate, { kind: 'validate' }, at, evidence)
  state = applyReviewerTargetedEvent(state, candidate, { kind: 'claim', taskId: 'targeted-semantic-0', dispatchId: 'dispatch' }, at, evidence)
  state = applyReviewerTargetedEvent(state, candidate, { kind: 'accept', taskId: 'targeted-semantic-0', dispatchId: 'dispatch',
    output: { status: 'PASS' }, usage: { input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 } }, at, evidence)
  return { candidate, state, requestId: 'targeted-publication' }
}

test('targeted publication requires complete replayed acceptance and consistent derived summary', () => {
  const input = completed()
  expect(buildReviewerTargetedResultFromState(input).recheck!.decision).toBe('round_complete')
  const missing = structuredClone(input)
  delete missing.state.semanticTasks[0]!.receiptDigest
  expect(() => buildReviewerTargetedResultFromState(missing)).toThrow('acceptance receipts')
  const incomplete = { ...input, state: initialReviewerTargetedState(input.candidate) }
  expect(() => buildReviewerTargetedResultFromState(incomplete)).toThrow('completed owner evidence')
  const changed = structuredClone(input)
  changed.state.summary = { kind: 'passed' }
  expect(() => buildReviewerTargetedResultFromState(changed)).toThrow('summary disagrees')
  changed.state.inputDigest = 'f'.repeat(64)
  expect(() => buildReviewerTargetedResultFromState(changed)).toThrow('state binding')
})

test('targeted durable output captures input and resumes a missing marker without canonical writes', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'targeted-publication-')))
  try {
    const input = completed()
    const expected = buildReviewerTargetedResultFromState(input)
    const pending = publishReviewerTargetedResult({ ...input, workspacePath })
    input.candidate.documents[0]!.content = 'caller changed after submission'
    const first = await pending
    expect(first.result).toEqual(expected)
    expect(await readReviewerPublishedResult(workspacePath, expected)).toEqual(expected)
    expect(await readdir(workspacePath)).toEqual(['.beegame'])
    const bytes = await readFile(join(workspacePath, first.artifactPath), 'utf8')
    await unlink(join(workspacePath, first.commitPath))
    expect(await readReviewerPublishedResult(workspacePath, expected)).toBeUndefined()
    expect(await publishReviewerTargetedResult({ ...completed(), workspacePath })).toEqual(first)
    expect(await readFile(join(workspacePath, first.artifactPath), 'utf8')).toBe(bytes)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
