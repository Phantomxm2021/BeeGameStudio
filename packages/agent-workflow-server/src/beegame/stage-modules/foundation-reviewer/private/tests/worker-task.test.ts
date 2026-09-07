import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { FOUNDATION_SEMANTIC_CHECKS } from '../domain/foundation-semantic-audit'
import { createFactWorkerTask, createSemanticWorkerTask, ReviewWorkerIncompleteError, REVIEW_WORKER_OUTPUT_MAX_BYTES } from '../worker-task'
import { prepareFoundationReview } from '../prepare-review'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

function documents() {
  return CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) }))
}
function factFixture() {
  const docs = documents()
  const prepared = prepareFoundationReview(docs)
  if (prepared.kind !== 'facts_pending') throw new Error('fixture malformed')
  const task = createFactWorkerTask(docs, 0)
  const packet = prepared.factPackets[0]!
  const output = { status: 'completed', results: packet.keys.map(key => ({ key, status: 'absent' })) }
  return { docs, task, packet, output }
}
function semanticInput() {
  const docs = documents()
  const prepared = prepareFoundationReview(docs)
  if (prepared.kind !== 'facts_pending') throw new Error('fixture malformed')
  const bodies = new Map(docs.map(item => [item.path, item.content]))
  const sectionBytes = new Map(prepared.sectionIndex.map(ref => [
    `${ref.documentPath}#${ref.sectionId}`,
    bodies.get(ref.documentPath)!.split('\n').slice(ref.startLine - 1, ref.endLine).join('\n'),
  ]))
  return { revision: prepared.snapshot.digest, checkId: FOUNDATION_SEMANTIC_CHECKS[0]!.checkId,
    sectionIndex: prepared.sectionIndex, sectionBytes, factStore: prepared.extraction.facts,
    deterministicIssuePrefix: [], deterministicReviewDigest: createHash('sha256').update('[]').digest('hex') }
}

test('fact output schema is packet bounded and model prompt omits durable identities', () => {
  const { task, packet } = factFixture()
  expect(task.schema.properties.results.minItems).toBe(packet.keys.length)
  expect(task.schema.properties.results.maxItems).toBe(packet.keys.length)
  expect(task.prompt).toContain('Do not read project files')
  expect(task.prompt).not.toContain(packet.packetDigest)
  expect(task.prompt).not.toContain(packet.revision)
  const contract = JSON.parse(task.prompt.split('Model packet contract: ')[1]!)
  expect(Object.keys(contract.packet).sort()).toEqual(['keys', 'sections'])
  expect(Object.keys(contract.packet.sections[0]).sort()).toEqual(['content', 'documentPath', 'heading', 'sectionId'])
})

test('fact tasks copy input and reconstruct immutable evidence from owner sections', () => {
  const { task, docs, output, packet } = factFixture()
  docs[0]!.content = 'changed outside task'
  const uncertain = { ...output, results: packet.keys.map(key => ({ key, status: 'uncertain', reason: 'not stated' })) }
  const admitted = task.admit(uncertain)
  expect(admitted.facts).toEqual([])
  expect(admitted.receipts).toHaveLength(packet.keys.length)
  expect(admitted.receipts[0]!.evidence?.digest).toMatch(/^[a-f0-9]{64}$/)
  expect(task.admit(output).receipts).toHaveLength(packet.keys.length)
})

test('fact admission rejects forged authority, omitted keys, duplicates, extras and malformed output', () => {
  const { task, output } = factFixture()
  for (const value of [
    { ...output, runId: 'model-invented' },
    { ...output, results: output.results.slice(1) },
    { ...output, results: [...output.results, output.results[0]] },
    { ...output, results: output.results.map(item => ({ ...item, evidence: {} })) },
    { ...output, results: output.results.map(item => ({ ...item, key: 'unknown.key' })) },
    undefined, '# not JSON', { status: 'completed', results: [] },
  ]) expect(() => task.admit(value)).toThrow()
})

test('non-completed status cannot produce accepted fact evidence', () => {
  const { task, output } = factFixture()
  for (const status of ['failed', 'blocked'])
    expect(() => task.admit({ ...output, status })).toThrow(ReviewWorkerIncompleteError)
  expect(() => task.admit({ ...output, note: 'x'.repeat(REVIEW_WORKER_OUTPUT_MAX_BYTES) })).toThrow('infrastructure boundary')
})

test('semantic source and strong confirmation share packet identity but not source outcome', () => {
  const input = semanticInput()
  const source = createSemanticWorkerTask(input)
  const confirmation = createSemanticWorkerTask(input, 'confirmation')
  expect(source.packetDigest).toBe(confirmation.packetDigest)
  expect(confirmation.prompt).toContain('Do not inherit or preserve the source outcome')
  expect(source.prompt).not.toContain(source.packetDigest)
  expect(source.admit({ status: 'completed', outcome: 'UNDECIDABLE', reason: 'unclear' }).outcome).toBe('UNDECIDABLE')
  expect(confirmation.admit({ status: 'completed', outcome: 'PASS' }).outcome).toBe('PASS')
  input.sectionBytes.clear()
  expect(source.admit({ status: 'completed', outcome: 'PASS' }).packetIdentity).toBe(source.packetDigest)
})

test('semantic admission rejects model identities, invalid terminal unions and out-of-packet repair', () => {
  const task = createSemanticWorkerTask(semanticInput())
  for (const value of [
    { status: 'completed', outcome: 'PASS', packetIdentity: task.packetDigest },
    { status: 'completed', outcome: 'PASS', reason: 'extra explanation' },
    { status: 'completed', outcome: 'ISSUES', issues: [] },
    { status: 'completed', outcome: 'UNDECIDABLE' },
    { status: 'failed', outcome: 'PASS' },
    { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'p', expected: 'e', actual: 'a', sourceSectionKey: 'docs/GDD.md#unknown', remediation: { kind: 'patch', sectionKeys: ['docs/GDD.md#unknown'] } }] },
  ]) expect(() => task.admit(value)).toThrow()
})

test('semantic task creation rejects stale section bytes and caller-defined checks', () => {
  const input = semanticInput()
  expect(() => createSemanticWorkerTask({ ...input, checkId: 'caller.check' })).toThrow()
  for (const key of input.sectionBytes.keys()) input.sectionBytes.set(key, 'tampered')
  expect(() => createSemanticWorkerTask(input)).toThrow()
  expect(() => createFactWorkerTask(documents(), -1)).toThrow()
})
