import { expect, test } from 'bun:test'
import { initialReviewerFactState } from '../fact-state'
import { applyReviewerJournalEvent, type ReviewerJournalEvent, type ReviewerJournalState } from '../review-state'
import { prepareFoundationReview } from '../prepare-review'
import { prepareReviewerSemanticInput } from '../semantic-input'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from '../domain/foundation-semantic-audit'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

const zero = { input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }
const ten = { ...zero, input_tokens: 7, completion_tokens: 3, total_tokens: 10 }
const pass = { status: 'completed', outcome: 'PASS' }
const undecidable = { status: 'completed', outcome: 'UNDECIDABLE', reason: 'insufficient evidence' }
function fixture() {
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) }))
  const prepared = prepareFoundationReview(documents)
  if (prepared.kind !== 'facts_pending') throw new Error('invalid fixture')
  let state: ReviewerJournalState = initialReviewerFactState(documents)
  let tick = 0
  const apply = (event: ReviewerJournalEvent) => {
    state = applyReviewerJournalEvent(state, documents, event, new Date(1_700_000_000_000 + tick++ * 100).toISOString(),
      { path: `.beegame/workflow/foundation-reviewer/state/test/events/${tick}.json`, digest: 'a'.repeat(64), runId: 'test' })
    return state
  }
  const seed = () => {
    for (const [index, packet] of prepared.factPackets.entries()) {
      apply({ kind: 'claim', taskId: `fact-${index}`, dispatchId: `fact-d${index}` })
      apply({ kind: 'accept', taskId: `fact-${index}`, dispatchId: `fact-d${index}`, usage: ten,
        output: { status: 'completed', results: packet.keys.map(key => ({ key, status: 'absent' })) } })
    }
    return apply({ kind: 'begin_semantic' })
  }
  const claim = (taskId: string, dispatchId = taskId) => apply({ kind: 'semantic', command: { kind: 'claim', taskId, dispatchId } })
  const accept = (taskId: string, output: {} | null = pass, dispatchId = taskId) => apply({ kind: 'semantic', command: { kind: 'accept', taskId, dispatchId, output, usage: ten } })
  return { documents, apply, seed, claim, accept, read: () => state }
}

test('semantic seeding requires every admitted fact and owns all ten checks and deterministic prefix', () => {
  const f = fixture()
  expect(() => f.apply({ kind: 'begin_semantic' })).toThrow('all bound fact receipts')
  const state = f.seed()
  expect(state.semantic!.collection.tasks).toHaveLength(10)
  expect(state.semantic!.collection.tasks.map(task => [task.checkId, task.modelTier])).toEqual(FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => [check.checkId, check.modelTier]))
  const input = prepareReviewerSemanticInput(f.documents, state)
  expect(input.issues.length).toBeGreaterThan(0)
  expect(input.packets.every(packet => packet.deterministicReviewDigest === input.deterministicReviewDigest)).toBe(true)
  expect(() => f.apply({ kind: 'begin_semantic' })).toThrow('already initialized')
  const tampered = structuredClone(state)
  tampered.collection.tasks[0]!.dispatch!.terminalResult!.results = []
  expect(() => prepareReviewerSemanticInput(f.documents, tampered)).toThrow()
})

test('all source checks and required strong confirmations must complete before semantic staging', () => {
  const f = fixture(); f.seed()
  const sources = f.read().semantic!.collection.tasks.slice()
  for (const task of sources) { f.claim(task.taskId); f.accept(task.taskId, task === sources[0] ? undecidable : pass) }
  const confirmations = f.read().semantic!.collection.tasks.filter(task => task.kind === 'confirmation')
  expect(confirmations).toHaveLength(FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.filter(check => check.severity === 'BLOCKER' || check.checkId === sources[0]!.checkId).length)
  expect(f.read().semantic!.phase).toBe('semantic_review')
  for (const task of confirmations) {
    expect(task.modelTier).toBe('strong')
    expect(task.packetDigest).toBe(sources.find(source => source.checkId === task.checkId)!.packetDigest)
    f.claim(task.taskId); f.accept(task.taskId)
  }
  expect(f.read().semantic!.phase).toBe('semantic_staged')
  expect(f.read().phase).toBe('facts_staged') // not an overall public passed result
  expect(f.read().semantic!.collection.aggregateUsage.total_tokens).toBe(100)
  expect(f.read().semantic!.collection.deepAggregateUsage!.total_tokens).toBe(confirmations.length * 10)
})

test('UNDECIDABLE non-BLOCKER schedules strong once; undecidable strong blocks retry', () => {
  const f = fixture(); f.seed()
  const check = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(item => item.severity !== 'BLOCKER')!
  const task = f.read().semantic!.collection.tasks.find(item => item.checkId === check.checkId)!
  f.claim(task.taskId); f.accept(task.taskId, undecidable)
  const confirmation = `${task.taskId}:confirmation`
  f.claim(confirmation); f.accept(confirmation, undecidable)
  expect(f.read().semantic!.phase).toBe('needs_action')
  expect(f.read().semantic!.collection.tasks.filter(item => item.kind === 'confirmation')).toHaveLength(1)
  expect(() => f.apply({ kind: 'resume' })).toThrow('requires action')
  f.apply({ kind: 'stop' })
  expect(() => f.apply({ kind: 'resume' })).toThrow('requires action')
})

test('the frozen manifest permits ten PASS sources without inventing extra confirmations', () => {
  const f = fixture(); f.seed()
  expect(FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.filter(check => check.severity === 'BLOCKER')).toHaveLength(0)
  for (const task of f.read().semantic!.collection.tasks.slice()) { f.claim(task.taskId); f.accept(task.taskId) }
  expect(f.read().semantic!.collection.tasks).toHaveLength(10)
  expect(f.read().semantic!.phase).toBe('semantic_staged')
  expect(prepareReviewerSemanticInput(f.documents, f.read()).issues.length).toBeGreaterThan(0)
})

test('four slots are shared by semantic sources and confirmations; dispatch IDs cannot cross phases', () => {
  const f = fixture(); f.seed()
  expect(() => f.claim('semantic-0', 'fact-d0')).toThrow('already used')
  const blocker = f.read().semantic!.collection.tasks[0]!
  f.claim(blocker.taskId); f.accept(blocker.taskId, undecidable)
  f.claim(`${blocker.taskId}:confirmation`)
  const others = f.read().semantic!.collection.tasks.filter(task => task.status === 'pending')
  for (const task of others.slice(0, 3)) f.claim(task.taskId)
  expect(() => f.claim(others[3]!.taskId)).toThrow('concurrency')
})

test('source failure is capped at two and confirmation failure at one', () => {
  for (const deep of [false, true]) {
    const f = fixture(); f.seed()
    let taskId = 'semantic-0'
    if (deep) { f.claim(taskId); f.accept(taskId, undecidable); taskId += ':confirmation' }
    const cap = deep ? 1 : 2
    for (let attempt = 1; attempt <= cap; attempt++) {
      f.claim(taskId, `attempt-${attempt}`)
      f.apply({ kind: 'semantic', command: { kind: 'fail', taskId, dispatchId: `attempt-${attempt}`, usage: ten, reason: 'native_model_error' } })
    }
    expect(f.read().semantic!.phase).toBe('needs_action')
    expect(() => f.apply({ kind: 'resume' })).toThrow('requires action')
  }
})

test('stop refunds attempts, retains late usage, rejects late terminals and preserves completed sources', () => {
  const f = fixture(); f.seed(); f.claim('semantic-0'); f.accept('semantic-0', undecidable)
  const id = 'semantic-0:confirmation'
  f.claim(id, 'old')
  f.apply({ kind: 'stop' })
  expect(f.read().semantic!.collection.tasks.find(task => task.taskId === id)!.attempt).toBe(0)
  expect(() => f.accept(id, pass, 'old')).toThrow('running dispatch')
  f.apply({ kind: 'semantic', command: { kind: 'usage', taskId: id, dispatchId: 'old', usage: ten } })
  f.apply({ kind: 'resume' }); f.claim(id, 'new'); f.accept(id, pass, 'new')
  expect(f.read().semantic!.collection.deepAggregateUsage!.total_tokens).toBe(20)
  expect(f.read().semantic!.collection.tasks[0]!.status).toBe('completed')
  expect(() => f.apply({ kind: 'semantic', command: { kind: 'usage', taskId: id, dispatchId: 'old', usage: zero } })).toThrow('regressed')
})

test('missing tier is retryable only before first dispatch; process loss does not imply another attempt', () => {
  const f = fixture(); f.seed()
  f.apply({ kind: 'semantic', command: { kind: 'configuration_unavailable', taskId: 'semantic-0' } })
  expect(f.read().semantic!.phase).toBe('needs_action')
  f.apply({ kind: 'resume' }); f.claim('semantic-0')
  f.apply({ kind: 'semantic', command: { kind: 'recover_lost', dispatchIds: ['semantic-0'] } })
  expect(f.read().semantic!.collection.tasks[0]!.attempt).toBe(1)
  expect(() => f.apply({ kind: 'resume' })).toThrow('requires action')
})

test('forged result identities and inconsistent usage cannot change semantic evidence', () => {
  const f = fixture(); f.seed(); f.claim('semantic-0')
  const before = structuredClone(f.read())
  for (const output of [{ ...pass, checkId: 'forged' }, { ...pass, packetIdentity: 'a'.repeat(64) }, { status: 'completed', outcome: 'ISSUES', issues: [] }])
    expect(() => f.accept('semantic-0', output)).toThrow()
  expect(() => f.apply({ kind: 'semantic', command: { kind: 'usage', taskId: 'semantic-0', dispatchId: 'semantic-0', usage: { ...ten, total_tokens: 1 } } })).toThrow('inconsistent usage')
  expect(f.read()).toEqual(before)
})
