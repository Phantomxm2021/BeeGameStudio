import { expect, test } from 'bun:test'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { applyReviewerTargetedEvent, initialReviewerTargetedState, type ReviewerTargetedState } from '../targeted-state'
import { reviewerUsageEventId } from '../usage-state'

const zero = { input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }
const ten = { input_tokens: 7, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 10 }
const runId = 'targeted-billing-run'
const ownerId = 'owner'
const evidence = { path: `.beegame/workflow/foundation-reviewer/state/${runId}/receipt.json`, digest: 'a'.repeat(64), runId, ownerId }
const at = (n: number) => new Date(1_700_000_000_000 + n * 100).toISOString()

function event(state: ReviewerTargetedState, command: Parameters<typeof applyReviewerTargetedEvent>[2], n: number, normalizedFacts = false) {
  const { prepared } = firstCandidateFixture(normalizedFacts)
  return applyReviewerTargetedEvent(state, prepared, command, at(n), evidence)
}

test('targeted sealing requires measured non-running dispatches and retains every retry', () => {
  const { prepared } = firstCandidateFixture(false)
  let state = initialReviewerTargetedState(prepared)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-fact-0', dispatchId: 'd1' }, at(1), evidence)
  expect(() => applyReviewerTargetedEvent(state, prepared, { kind: 'seal_usage' }, at(2), evidence)).toThrow('native cleanup')
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'usage', taskId: 'targeted-fact-0', dispatchId: 'd1', usage: ten }, at(2), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'fail', taskId: 'targeted-fact-0', dispatchId: 'd1', usage: ten, reason: 'retry' }, at(3), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-fact-0', dispatchId: 'd2' }, at(4), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'usage', taskId: 'targeted-fact-0', dispatchId: 'd2', usage: zero }, at(5), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'fail', taskId: 'targeted-fact-0', dispatchId: 'd2', usage: zero, reason: 'retry' }, at(6), evidence)
  state = event(state, { kind: 'seal_usage' }, 7)
  expect(state.billing?.sealed).toBe(true)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-fact-0', dispatchId: 'd3' }, at(8), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'usage', taskId: 'targeted-fact-0', dispatchId: 'd3', usage: ten }, at(9), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'fail', taskId: 'targeted-fact-0', dispatchId: 'd3', usage: ten, reason: 'retry' }, at(10), evidence)
  state = event(state, { kind: 'seal_usage' }, 11)
  expect(state.billing?.entries.map(entry => entry.dispatchId)).toEqual(['d1', 'd2', 'd3'])
  expect(event(state, { kind: 'seal_usage' }, 12)).toEqual(state)
  expect(() => event(state, { kind: 'billing_ack', dispatchId: 'unknown', receipt: {
    protocolVersion: 1, ownerId, eventId: 'wrong', idempotencyKey: 'wrong', pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot', usage: { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }, skipped: true, duplicate: false,
  } }, 9)).toThrow('no sealed usage')
})

test('targeted billing acknowledgement binds its reused event ID and freezes late snapshots', () => {
  const { prepared } = firstCandidateFixture()
  let state = initialReviewerTargetedState(prepared)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'validate' }, at(1), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'claim', taskId: 'targeted-semantic-0', dispatchId: 'd1' }, at(2), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'accept', taskId: 'targeted-semantic-0', dispatchId: 'd1', output: { status: 'PASS' }, usage: ten }, at(3), evidence)
  state = applyReviewerTargetedEvent(state, prepared, { kind: 'seal_usage' }, at(4), evidence)
  const billingUsage = { prompt_tokens: 7, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 10 }
  const eventId = reviewerUsageEventId(runId, 'd1', billingUsage)
  const receipt = { protocolVersion: 1 as const, ownerId, eventId, idempotencyKey: eventId, pricingVersion: 'weighted-v1' as const, usageSource: 'runtime_snapshot' as const, usage: billingUsage, duplicate: false, recorded: { eventId, duplicate: false, weightedTokensDelta: 1, creditsMicro: 1 }, debited: { eventId, duplicate: false, weightedTokensDelta: 1, creditsMicro: 1 } }
  state = event(state, { kind: 'billing_ack', dispatchId: 'd1', receipt }, 5, true)
  expect(state.billing?.entries[0]?.receipt).toEqual(receipt)
  expect(event(state, { kind: 'billing_ack', dispatchId: 'd1', receipt }, 6, true)).toEqual(state)
  expect(() => event(state, { kind: 'accept', taskId: 'targeted-semantic-0', dispatchId: 'd1', output: { status: 'PASS' }, usage: zero }, 7, true)).toThrow('sealed usage cannot change')
  expect(() => applyReviewerTargetedEvent(state, prepared, { kind: 'billing_ack', dispatchId: 'd1', receipt }, at(8), { ...evidence, ownerId: 'foreign' })).toThrow('owner mismatch')
})
