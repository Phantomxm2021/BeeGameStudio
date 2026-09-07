import { expect, test } from 'bun:test'
import { firstCandidateFixture, candidateFixtureFromReview } from '../test-fixtures/candidate-fixture'
import { completedReviewFixture } from '../test-fixtures/review-fixture'
import { buildReviewerTargetedResult } from '../targeted-publication'
import { parseReviewerSourceResult } from '../review-handoff'
import { prepareReviewerFirstCandidate, prepareReviewerRetryCandidate } from '../candidate-handoff'
import { validateReviewerTargetedFacts } from '../targeted-preparation'
import { verifyReviewerCandidateChanges } from '../candidate-changes'
import { bindReviewDocuments } from '../prepare-review'
import { reviewerDigest } from '../review-summary'

const binding = (result: { ownerId: string; projectId: string; resultId: string }) => ({
  ownerId: result.ownerId, projectId: result.projectId, resultId: result.resultId, resultDigest: reviewerDigest(result) })
function rehash<T extends { resultId: string }>(value: T): T {
  const { resultId: _, ...body } = value; value.resultId = reviewerDigest(body); return value
}
function retryFixture() {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [
      { problem: 'feedback', expected: 'readable feedback', actual: 'missing', sourceSectionKey: 'GDD#player_actions',
        remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } },
      { problem: 'navigation feedback', expected: 'navigation feedback', actual: 'missing', sourceSectionKey: 'UI#input',
        remediation: { kind: 'patch', sectionKeys: ['UI#input'] } },
    ] } : { status: 'completed', outcome: 'PASS' } })
  const first = candidateFixtureFromReview(review, review.documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md'
    ? doc.content.replace('game.mechanics:', 'Readable feedback added.\n\ngame.mechanics:')
    : doc.path === 'docs/UI_UX_SPEC.md' ? doc.content.replace('ui.supported_actions:', 'Navigation note added.\n\nui.supported_actions:') : doc.content })))
  const validation = validateReviewerTargetedFacts(first.prepared, [])
  const semantic = validation.semantic.map(({ issue, packet }) => ({ issueId: issue.id,
    output: issue.remediation.documentPath === 'docs/GDD.md' ? { status: 'PASS' } : { status: 'FAIL', diagnostic: {
      observedActual: 'navigation feedback is still missing', failureReasonCode: 'expected_not_met',
      evidence: packet.sections.map(({ ref }) => ({ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest })) } } }))
  const previousRecheckResult = buildReviewerTargetedResult({ requestId: 'recheck-one', candidate: first.prepared, facts: [], semantic })
  const documents = first.prepared.documents.map(doc => ({ ...doc, content: doc.path === 'docs/UI_UX_SPEC.md'
    ? doc.content.replace('Navigation note added.', 'Navigation feedback implemented.') : doc.content }))
  const snapshot = bindReviewDocuments(documents)
  const previous = { candidateId: first.input.candidateResult.candidateId, candidateResultId: first.input.candidateResult.resultId,
    candidateResultDigest: reviewerDigest(first.input.candidateResult), recheckResultId: previousRecheckResult.resultId, recheckResultDigest: reviewerDigest(previousRecheckResult) }
  const candidateResult = rehash({ ...first.input.candidateResult, requestId: 'retry', candidateId: 'candidate-two', previous,
    documents: snapshot.documents.map(doc => ({ ...doc, byteLength: Buffer.byteLength(doc.content) })), documentSetDigest: snapshot.digest,
    changes: verifyReviewerCandidateChanges({ baseDocuments: first.prepared.baseDocuments, candidateDocuments: documents, issues: first.prepared.issues }) })
  return { ...first.input, candidateResult, candidateBinding: binding(candidateResult),
    previousCandidateResult: first.input.candidateResult, previousCandidateBinding: first.input.candidateBinding,
    previousRecheckResult, previousRecheckBinding: binding(previousRecheckResult) }
}

test('targeted public result is independently readable without private facts or tasks', () => {
  const { prepared } = firstCandidateFixture()
  const result = buildReviewerTargetedResult({ requestId: 'recheck', candidate: prepared, facts: [],
    semantic: [{ issueId: prepared.issues[0]!.id, output: { status: 'PASS' } }] })
  expect(parseReviewerSourceResult(JSON.parse(JSON.stringify(result)), binding(result))).toEqual(result)
  expect(result.recheck!.decision).toBe('round_complete')
  expect(JSON.stringify(result)).not.toContain('validatorTaskId')
  expect(JSON.stringify(result)).not.toContain('targeted-semantic-0')
})
test('same-round retry preserves PASS bytes and rechecks retained issues against the full current candidate', () => {
  const input = retryFixture()
  const prepared = prepareReviewerRetryCandidate(input)
  expect(prepared.candidate.round).toBe(1)
  expect(prepared.documents[0]!.content).toBe(input.previousCandidateResult.documents[0]!.content)
  expect(validateReviewerTargetedFacts(prepared, []).semantic).toHaveLength(2)
  expect(() => prepareReviewerFirstCandidate(input)).toThrow('previous public recheck')
  input.candidateResult.documents[0]!.content += '\nchanged retained bytes'
  const snapshot = bindReviewDocuments(input.candidateResult.documents.map(({ path, content }) => ({ path, content })))
  input.candidateResult.documentSetDigest = snapshot.digest
  input.candidateResult.documents = snapshot.documents.map(doc => ({ ...doc, byteLength: Buffer.byteLength(doc.content) }))
  rehash(input.candidateResult); input.candidateBinding = binding(input.candidateResult)
  expect(() => prepareReviewerRetryCandidate(input)).toThrow('retained document')
})
test('rehashing inconsistent public PASS/FAIL, digest or diagnostic metadata cannot authorize retry', () => {
  const input = retryFixture()
  const result = structuredClone(input.previousRecheckResult)
  result.recheck!.documentVerdicts.find(doc => doc.status === 'FAIL')!.status = 'PASS'
  rehash(result)
  expect(() => parseReviewerSourceResult(result, binding(result))).toThrow('retention')
  const changed = structuredClone(input.candidateResult)
  changed.previous.recheckResultDigest = 'f'.repeat(64); rehash(changed)
  expect(() => prepareReviewerRetryCandidate({ ...input, candidateResult: changed, candidateBinding: binding(changed) })).toThrow('predecessor')
})
test('new deterministic issues become the next round source and a corrected candidate can pass', () => {
  const { prepared } = firstCandidateFixture()
  const sourceResult = buildReviewerTargetedResult({ requestId: 'recheck-one', candidate: prepared, facts: [],
    semantic: [{ issueId: prepared.issues[0]!.id, output: { status: 'PASS' } }] })
  const documents = sourceResult.documents.map(({ path, content }) => ({ path, content: path === 'docs/TECHNICAL_DESIGN.md'
    ? content.replace('technical.supported_actions: ["move","attack","dash"]', 'technical.supported_actions: ["move","attack","dash","parry"]') : content }))
  const snapshot = bindReviewDocuments(documents)
  const candidateResult = rehash({ ...prepared.candidate, resultId: '', requestId: 'round-two', candidateId: 'round-two', round: 2,
    sourceReviewResultId: sourceResult.resultId, sourceReviewResultDigest: reviewerDigest(sourceResult), baseDocumentSetDigest: sourceResult.documentSetDigest,
    documentSetDigest: snapshot.digest, documents: snapshot.documents.map(doc => ({ ...doc, byteLength: Buffer.byteLength(doc.content) })),
    changes: verifyReviewerCandidateChanges({ baseDocuments: sourceResult.documents.map(({ path, content }) => ({ path, content })), candidateDocuments: documents,
      issues: sourceResult.issues.map(entry => entry.issue) }), repairClaims: sourceResult.issues.map(entry => ({ issueId: entry.issue.id, status: 'APPLIED' as const })) })
  const candidate = prepareReviewerFirstCandidate({ sourceResult, sourceBinding: binding(sourceResult), candidateResult, candidateBinding: binding(candidateResult) })
  const result = buildReviewerTargetedResult({ requestId: 'recheck-two', candidate, facts: [], semantic: [] })
  expect(result.kind).toBe('passed')
  expect(result.issues).toEqual([])
  expect(result.recheck!.round).toBe(2)
})
