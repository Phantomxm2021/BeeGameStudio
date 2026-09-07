import { expect, test } from 'bun:test'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { applyReviewerTargetedEvent, initialReviewerTargetedState } from '../targeted-state'

const zero = { input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }
const ten = { ...zero, input_tokens: 7, completion_tokens: 3, total_tokens: 10 }
const evidence = { path: '.beegame/workflow/foundation-reviewer/state/test/receipt.json', digest: 'a'.repeat(64), runId: 'targeted-test' }
function at(n: number) { return new Date(1_700_000_000_000 + n * 100).toISOString() }

test('lifecycle errors require explicit continuation and cannot clear unowned running claims', () => {
  const { prepared } = firstCandidateFixture()
  let state = initialReviewerTargetedState(prepared)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'lifecycle_failure', code: 'execution_failed' }, at(1), evidence)
  expect(() => applyReviewerTargetedEvent(state, prepared, { kind: 'validate' }, at(2), evidence)).toThrow('explicit continuation')
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'stop' }, at(3), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'lifecycle_resume' }, at(4), evidence)
  expect(state.phase).toBe('deterministic_validation')
  expect(state.control?.failure).toBeUndefined()
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'validate' }, at(5), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-semantic-0', dispatchId: 'unowned' }, at(6), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'lifecycle_failure', code: 'execution_failed' }, at(7), evidence)
  expect(() => applyReviewerTargetedEvent(state, prepared, { kind: 'lifecycle_resume' }, at(8), evidence)).toThrow('native cleanup')
})

test('targeted reducer explicitly crosses deterministic validation before semantic work', () => {
  const { prepared } = firstCandidateFixture()
  let state = initialReviewerTargetedState(prepared)
  expect(state.factTasks).toHaveLength(0)
  expect(state.phase).toBe('deterministic_validation')
  expect(() => applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-semantic-0', dispatchId: 'd' }, at(1), evidence)).toThrow()
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'validate' }, at(1), evidence)
  expect(state.phase).toBe('semantic_review')
  expect(state.semanticTasks[0]!.taskId).toBe('targeted-semantic-0')
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-semantic-0', dispatchId: 'semantic-d' }, at(2), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'accept', taskId: 'targeted-semantic-0', dispatchId: 'semantic-d', output: { status: 'PASS' }, usage: ten }, at(3), evidence)
  expect(state.phase).toBe('targeted_staged')
  expect(state.summary).toBeDefined()
})

test('targeted fact failures and process loss remain retryable without an attempt cap', () => {
  const { prepared } = firstCandidateFixture(false)
  let state = initialReviewerTargetedState(prepared)
  expect(state.factTasks[0]!.taskId).toBe('targeted-fact-0')
  for (let n = 1; n <= 3; n++) {
    state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-fact-0', dispatchId: `fact-${n}` }, at(n), evidence)
    if (n < 3) state = applyReviewerTargetedEvent(state, prepared, { kind: 'fail', taskId: 'targeted-fact-0', dispatchId: `fact-${n}`, usage: ten, reason: 'native process failed' }, at(n + 10), evidence)
  }
  expect(state.factTasks[0]!.attempt).toBe(3)
  expect(() => applyReviewerTargetedEvent(state, prepared, { kind: 'recover_lost', dispatchIds: ['fact-3'] } as never, at(20), evidence)).toThrow()
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'recover_lost', dispatchIds: ['fact-3'], cleanup: {
    path: '.beegame/workflow/foundation-reviewer/state/targeted-test/cleanup.json', digest: 'b'.repeat(64), runId: 'targeted-test', dispatchIds: ['fact-3'],
  } }, at(20), evidence)
  expect(state.factTasks[0]!.status).toBe('retryable')
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-fact-0', dispatchId: 'fact-4' }, at(20.5), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'stop' }, at(21), evidence)
  expect(state.factTasks[0]!.attempt).toBe(3)
  expect(() => applyReviewerTargetedEvent(state, prepared, { kind: 'accept', taskId: 'targeted-fact-0', dispatchId: 'fact-4', output: { status: 'completed', results: [] }, usage: ten }, at(22), evidence)).toThrow()
})

test('missing targeted model configuration blocks without dispatch and resume reopens it', () => {
  const { prepared } = firstCandidateFixture(false)
  let state = initialReviewerTargetedState(prepared)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'configuration_unavailable' }, at(1), evidence)
  expect(state.phase).toBe('needs_action')
  expect(state.factTasks[0]!.attempt).toBe(0)
  expect(state.factTasks[0]!.dispatch).toBeUndefined()
  const forged = structuredClone(state)
  forged.factTasks[0]!.attempt = 1
  expect(() => applyReviewerTargetedEvent(forged, prepared, { kind: 'resume' }, at(1.5), evidence)).toThrow('requires action')
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'resume' }, at(2), evidence)
  expect(state.phase).toBe('extracting_facts')
  expect(state.factTasks[0]!.status).toBe('pending')
})

test('targeted usage ledger treats prototype-looking dispatch IDs as ordinary own keys', () => {
  const { prepared } = firstCandidateFixture(false)
  let state = initialReviewerTargetedState(prepared)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-fact-0', dispatchId: '__proto__' }, at(1), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'usage', taskId: 'targeted-fact-0', dispatchId: '__proto__', usage: ten }, at(2), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'fail', taskId: 'targeted-fact-0', dispatchId: '__proto__', usage: ten, reason: 'invalid worker output' }, at(3), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-fact-0', dispatchId: 'constructor' }, at(4), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'usage', taskId: 'targeted-fact-0', dispatchId: 'constructor', usage: ten }, at(5), evidence)
  expect(Object.hasOwn(state.usageByDispatch, '__proto__')).toBe(true)
  expect(Object.hasOwn(state.usageByDispatch, 'constructor')).toBe(true)
  expect(state.usageByDispatch['__proto__']).toEqual(ten)
  expect(state.aggregateUsage.total_tokens).toBe(20)
})
