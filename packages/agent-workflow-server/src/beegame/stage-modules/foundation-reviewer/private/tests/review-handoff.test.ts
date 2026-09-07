import { expect, test } from 'bun:test'
import { buildReviewerPublishedResult, reviewerInputDigest, type ReviewerPublishedResult } from '../review-publication'
import { parseReviewerSourceResult } from '../review-handoff'
import { reviewerDigest } from '../review-summary'
import { buildReviewerTargetedResult } from '../targeted-publication'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { completedReviewFixture, reviewFixtureDocuments } from '../test-fixtures/review-fixture'
import { initialReviewerFactState } from '../fact-state'

const identity = { ownerId: 'owner', projectId: 'project', requestId: 'source-review' }
const subject = { kind: 'initial' as const, sourceResultId: 'author-result', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }
const binding = (result: ReviewerPublishedResult) => ({ ownerId: result.ownerId, projectId: result.projectId, resultId: result.resultId, resultDigest: reviewerDigest(result) })
function fixture(normalizedFacts = true) {
  const review = completedReviewFixture({ normalizedFacts, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{
      problem: 'feedback conflict', expected: 'readable feedback', actual: 'missing feedback', sourceSectionKey: 'GDD#player_actions',
      remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] },
    }] } : { status: 'completed', outcome: 'PASS' } })
  return buildReviewerPublishedResult({ identity, subject, ...review })
}
function rebind(result: ReviewerPublishedResult) {
  result.issueRegistryDigest = reviewerDigest(result.issues.map(entry => entry.issue))
  const { resultId: _, ...body } = result
  result.resultId = reviewerDigest(body)
  return binding(result)
}

test('copied source results validate independently of private state and retain exact dependency evidence', () => {
  for (const normalized of [true, false]) {
    const result = fixture(normalized)
    const parsed = parseReviewerSourceResult(JSON.parse(JSON.stringify(result)), binding(result))
    expect(parsed).toEqual(result)
    parsed.issues[0]!.issue.actual = 'mutated copy'
    expect(parsed).not.toEqual(result)
  }
})
test('passed and format-only source results use the same independently readable boundary', () => {
  const passed = buildReviewerPublishedResult({ identity, subject, ...completedReviewFixture({ normalizedFacts: true }) })
  expect(parseReviewerSourceResult(passed, binding(passed)).kind).toBe('passed')
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const format = buildReviewerPublishedResult({ identity, subject, documents, state: initialReviewerFactState(documents) })
  expect(parseReviewerSourceResult(format, binding(format))).toEqual(format)
})
test('source binding rejects foreign identity, forged replacement, unknown fields and stale digests', () => {
  const result = fixture()
  const expected = binding(result)
  expect(() => parseReviewerSourceResult(result, { ...expected, ownerId: 'foreign' })).toThrow('binding')
  expect(() => parseReviewerSourceResult({ ...result, privateState: {} }, expected)).toThrow()
  result.issues[0]!.issue.actual = 'replacement'
  expect(() => parseReviewerSourceResult(result, expected)).toThrow('binding')
  rebind(result)
  expect(() => parseReviewerSourceResult(result, expected)).toThrow('binding')
})
test('localized format evidence remains readable alongside an unindexable document', () => {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const technical = documents.find(doc => doc.path === 'docs/TECHNICAL_DESIGN.md')!
  technical.content = technical.content.replace('| authority | complete |', '| authority | complete')
  const result = buildReviewerPublishedResult({ identity, subject, documents, state: initialReviewerFactState(documents) })
  expect(result.issues).toHaveLength(2)
  expect(result.issues.find(entry => entry.issue.source.documentPath === technical.path)!.issue.source).toHaveProperty('sectionId')
  expect(parseReviewerSourceResult(result, binding(result))).toEqual(result)
})
test('rehashing cannot make inconsistent source sections, facts, policy or pass claims admissible', () => {
  let result = fixture()
  result.issues[0]!.sections[0]!.content += 'changed'
  expect(() => parseReviewerSourceResult(result, rebind(result))).toThrow('slices')
  result = fixture()
  result.issues[0]!.facts[0]!.evidence.digest = 'f'.repeat(64)
  expect(() => parseReviewerSourceResult(result, rebind(result))).toThrow('fact evidence')
  result = fixture()
  result.policyDigest = 'f'.repeat(64)
  expect(() => parseReviewerSourceResult(result, rebind(result))).toThrow('policy')
  result = fixture()
  result.kind = 'passed'
  expect(() => parseReviewerSourceResult(result, rebind(result))).toThrow('registry')
})

test('source handoff keeps candidate resultId distinct from the full recheck candidate digest', () => {
  const { prepared } = firstCandidateFixture()
  const result = buildReviewerTargetedResult({ requestId: 'targeted-recheck', candidate: prepared, facts: [],
    semantic: [{ issueId: prepared.issues[0]!.id, output: { status: 'PASS' } }] })
  if (result.subject.kind !== 'candidate' || !result.recheck) throw new Error('targeted fixture is missing candidate authority')
  result.subject = { ...result.subject, candidateResultId: 'f'.repeat(64) }
  result.inputDigest = reviewerInputDigest({ ownerId: result.ownerId, projectId: result.projectId, subject: result.subject,
    documents: result.documents.map(({ path, content }) => ({ path, content })) })
  const { resultId: _, ...body } = result
  result.resultId = reviewerDigest(body)
  expect(parseReviewerSourceResult(result, binding(result))).toEqual(result)
})
