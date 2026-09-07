import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { completedReviewFixture, reviewFixtureDocuments } from '../test-fixtures/review-fixture'
import { summarizeReviewer, reviewerDigest } from '../review-summary'
import { initialReviewerFactState } from '../fact-state'
import { prepareReviewerSemanticInput } from '../semantic-input'

test('all semantic PASS cannot suppress deterministic findings; exported evidence matches original bytes', () => {
  const fixture = completedReviewFixture()
  const result = summarizeReviewer(fixture.documents, fixture.state)
  expect(result.kind).toBe('issues_found')
  expect(result.issues.length).toBeGreaterThan(0)
  expect(result.issues.map(item => item.issue)).toEqual(prepareReviewerSemanticInput(fixture.documents, fixture.state).issues)
  for (const entry of result.issues) for (const section of entry.sections)
    expect(createHash('sha256').update(section.content).digest('hex')).toBe(section.digest)
  expect(result.issueRegistryDigest).toBe(reviewerDigest(result.issues.map(item => item.issue)))
})

test('complete normalized facts and ten semantic PASS produce passed without invented extra gates', () => {
  const fixture = completedReviewFixture({ normalizedFacts: true })
  expect(fixture.state.collection.tasks).toHaveLength(0)
  const result = summarizeReviewer(fixture.documents, fixture.state)
  expect(result.kind).toBe('passed')
  expect(result.issues).toEqual([])
  expect(summarizeReviewer(fixture.documents, fixture.state)).toEqual(result)
})

test('confirmed semantic conclusion replaces undecidable source and exports only issue evidence slices', () => {
  const fixture = completedReviewFixture({ normalizedFacts: true, output(taskId) {
    if (taskId === 'semantic-0') return { status: 'completed', outcome: 'UNDECIDABLE', reason: 'needs strong confirmation' }
    if (taskId === 'semantic-0:confirmation') return { status: 'completed', outcome: 'ISSUES', issues: [{
      problem: 'loop pacing conflict', expected: 'provide an actionable counter', actual: 'no counter is specified', sourceSectionKey: 'GDD#core_loop',
      remediation: { kind: 'patch', sectionKeys: ['GDD#core_loop'] },
    }] }
    return { status: 'completed', outcome: 'PASS' }
  } })
  const result = summarizeReviewer(fixture.documents, fixture.state)
  expect(result.kind).toBe('issues_found')
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]!.issue.type).toBe('semantic')
  expect(result.issues[0]!.issue.id).toStartWith('AUD-')
  expect(result.issues[0]!.facts.every(fact => fact.source.sectionId === 'core_loop')).toBe(true)
  result.issues[0]!.issue.expected = 'mutated public copy'
  expect(summarizeReviewer(fixture.documents, fixture.state).issues[0]!.issue.expected).toBe('provide an actionable counter')
})

test('format failures finalize without any worker but keep document-scoped repair authority', () => {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# Incomplete document\n'
  const state = initialReviewerFactState(documents)
  const result = summarizeReviewer(documents, state)
  expect(result.kind).toBe('issues_found')
  expect(result.issues[0]!.issue.reasonCode).toBe('DOCUMENT_FORMAT_INVALID')
  expect(result.issues[0]!.issue.remediation.scope).toBe('document')
  expect(result.issues[0]!.facts).toEqual([])
})

test('summary rejects incomplete or missing confirmations and input tampering', () => {
  const fixture = completedReviewFixture({ output: taskId => taskId === 'semantic-0'
    ? { status: 'completed', outcome: 'UNDECIDABLE', reason: 'needs confirmation' } : { status: 'completed', outcome: 'PASS' } })
  const state = structuredClone(fixture.state)
  state.semantic!.collection.tasks = state.semantic!.collection.tasks.filter(task => task.kind !== 'confirmation')
  expect(() => summarizeReviewer(fixture.documents, state)).toThrow('confirmation coverage')
  state.semantic!.collection.tasks[0]!.status = 'running'
  expect(() => summarizeReviewer(fixture.documents, state)).toThrow('every semantic')
  fixture.documents[0]!.content += '\nchanged'
  expect(() => summarizeReviewer(fixture.documents, fixture.state)).toThrow('input binding')
})
