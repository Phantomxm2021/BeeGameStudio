import { expect, test } from 'bun:test'
import { prepareReviewerFirstCandidate, parseReviewerCandidateResult } from '../candidate-handoff'
import { verifyReviewerCandidateChanges } from '../candidate-changes'
import { buildReviewerPublishedResult } from '../review-publication'
import { bindReviewDocuments } from '../prepare-review'
import { reviewerDigest } from '../review-summary'
import { completedReviewFixture } from '../test-fixtures/review-fixture'

const binding = (value: { ownerId: string; projectId: string; resultId: string }) => ({
  ownerId: value.ownerId, projectId: value.projectId, resultId: value.resultId, resultDigest: reviewerDigest(value) })
function rehash<T extends { resultId: string }>(value: T): T {
  const { resultId: _, ...body } = value
  value.resultId = reviewerDigest(body)
  return value
}
function fixture() {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback', expected: 'readable feedback', actual: 'missing',
      sourceSectionKey: 'GDD#player_actions', remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  const sourceResult = buildReviewerPublishedResult({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }, ...review })
  const documents = review.documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md'
    ? doc.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]') : doc.content }))
  const snapshot = bindReviewDocuments(documents)
  const candidateResult = rehash({ protocolVersion: 1 as const, producer: 'foundation-revision' as const, kind: 'candidate_ready' as const,
    ownerId: 'owner', projectId: 'project', requestId: 'repair', resultId: '', candidateId: 'candidate-one', round: 1,
    baseDocumentSetDigest: sourceResult.documentSetDigest, sourceReviewResultId: sourceResult.resultId, sourceReviewResultDigest: reviewerDigest(sourceResult),
    documentSetDigest: snapshot.digest, documents: snapshot.documents.map(doc => ({ ...doc, byteLength: Buffer.byteLength(doc.content) })),
    changes: verifyReviewerCandidateChanges({ baseDocuments: review.documents, candidateDocuments: documents, issues: sourceResult.issues.map(entry => entry.issue) }),
    repairClaims: sourceResult.issues.map(entry => ({ issueId: entry.issue.id, status: 'APPLIED' as const })), unresolvedIssues: [] })
  return { sourceResult, sourceBinding: binding(sourceResult), candidateResult, candidateBinding: binding(candidateResult) }
}

test('candidate public bytes are independently bound but APPLIED never means review PASS', () => {
  const input = fixture()
  const prepared = prepareReviewerFirstCandidate(input)
  expect(prepared.issues).toHaveLength(1)
  expect(prepared.operations).toEqual(input.candidateResult.changes)
  expect(prepared).not.toHaveProperty('passed')
  prepared.documents[0]!.content = 'mutated'
  expect(input.candidateResult.documents[0]!.content).not.toBe('mutated')
})
test('accepted source and candidate bindings reject stale or substituted results', () => {
  const input = fixture()
  input.candidateResult.documents[0]!.content += '\nchanged'
  expect(() => prepareReviewerFirstCandidate(input)).toThrow('binding')
  const another = fixture()
  another.candidateResult.sourceReviewResultId = 'f'.repeat(64)
  rehash(another.candidateResult); another.candidateBinding = binding(another.candidateResult)
  expect(() => prepareReviewerFirstCandidate(another)).toThrow('authority')
})
test('rehashing altered manifests, declarations or claim IDs cannot replace byte/scope verification', () => {
  for (const mutate of [
    (input: ReturnType<typeof fixture>) => { input.candidateResult.documents[0]!.byteLength++ },
    (input: ReturnType<typeof fixture>) => { input.candidateResult.changes[0]!.afterDigest = 'f'.repeat(64) },
    (input: ReturnType<typeof fixture>) => { input.candidateResult.repairClaims[0]!.issueId = 'invented' },
    (input: ReturnType<typeof fixture>) => { input.candidateResult.repairClaims.push(input.candidateResult.repairClaims[0]!) },
  ]) {
    const input = fixture(); mutate(input)
    rehash(input.candidateResult); input.candidateBinding = binding(input.candidateResult)
    expect(() => prepareReviewerFirstCandidate(input)).toThrow()
  }
})
test('retry data requires its own accepted previous recheck, not the first-candidate route', () => {
  const input = fixture()
  const candidateResult = rehash({ ...input.candidateResult, previous: { candidateId: 'earlier', candidateResultId: 'a'.repeat(64),
    candidateResultDigest: 'b'.repeat(64), recheckResultId: 'c'.repeat(64), recheckResultDigest: 'd'.repeat(64) } })
  expect(() => prepareReviewerFirstCandidate({ ...input, candidateResult, candidateBinding: binding(candidateResult) })).toThrow('previous public recheck')
})
test('candidate output cannot smuggle a review verdict or private scheduling state', () => {
  const input = fixture()
  for (const extra of [{ passed: true }, { frozenTaskIds: [] }, { resultingIssues: [] }]) {
    const candidate = rehash({ ...input.candidateResult, ...extra })
    expect(() => parseReviewerCandidateResult(candidate, binding(candidate))).toThrow()
  }
})
test('first candidate cannot invent a later round', () => {
  const input = fixture()
  input.candidateResult.round = 2
  rehash(input.candidateResult); input.candidateBinding = binding(input.candidateResult)
  expect(() => prepareReviewerFirstCandidate(input)).toThrow('round one')
})
