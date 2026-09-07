import { expect, test } from 'bun:test'
import { firstCandidateFixture, candidateFixtureFromReview } from '../test-fixtures/candidate-fixture'
import { completedReviewFixture } from '../test-fixtures/review-fixture'
import { buildReviewerTargetedResult } from '../targeted-publication'
import { prepareReviewerRetryCandidate } from '../candidate-handoff'
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
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4' ? { status: 'completed', outcome: 'ISSUES', issues: [
    { problem: 'feedback', expected: 'readable feedback', actual: 'missing', sourceSectionKey: 'GDD#player_actions', remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } },
    { problem: 'navigation feedback', expected: 'navigation feedback', actual: 'missing', sourceSectionKey: 'UI#input', remediation: { kind: 'patch', sectionKeys: ['UI#input'] } },
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
  const documents = first.prepared.documents.map(doc => ({ ...doc, content: doc.path === 'docs/UI_UX_SPEC.md' ? doc.content.replace('Navigation note added.', 'Navigation feedback implemented.') : doc.content }))
  const snapshot = bindReviewDocuments(documents)
  const previous = { candidateId: first.input.candidateResult.candidateId, candidateResultId: first.input.candidateResult.resultId,
    candidateResultDigest: reviewerDigest(first.input.candidateResult), recheckResultId: previousRecheckResult.resultId, recheckResultDigest: reviewerDigest(previousRecheckResult) }
  const candidateResult = rehash({ ...first.input.candidateResult, requestId: 'retry', candidateId: 'candidate-two', previous,
    documents: snapshot.documents.map(doc => ({ ...doc, byteLength: Buffer.byteLength(doc.content) })), documentSetDigest: snapshot.digest,
    changes: verifyReviewerCandidateChanges({ baseDocuments: first.prepared.baseDocuments, candidateDocuments: documents, issues: first.prepared.issues }) })
  return { ...first.input, candidateResult, candidateBinding: binding(candidateResult), previousCandidateResult: first.input.candidateResult,
    previousCandidateBinding: first.input.candidateBinding, previousRecheckResult, previousRecheckBinding: binding(previousRecheckResult) }
}

function rebindRecheck(input: ReturnType<typeof retryFixture>) {
  input.previousRecheckResult = rehash(input.previousRecheckResult)
  input.previousRecheckBinding = binding(input.previousRecheckResult)
  input.candidateResult.previous.recheckResultId = input.previousRecheckResult.resultId
  input.candidateResult.previous.recheckResultDigest = reviewerDigest(input.previousRecheckResult)
  input.candidateResult = rehash(input.candidateResult)
  input.candidateBinding = binding(input.candidateResult)
}

test('retry rejects rehashed document verdicts assigned to the wrong source remediation document', () => {
  const input = retryFixture()
  const verdict = input.previousRecheckResult.recheck!.documentVerdicts[0]!
  const other = input.previousRecheckResult.recheck!.documentVerdicts[1]!
  const path = verdict.documentPath
  const digest = verdict.documentDigest
  verdict.documentPath = other.documentPath
  verdict.documentDigest = other.documentDigest
  other.documentPath = path
  other.documentDigest = digest
  rebindRecheck(input)
  expect(() => prepareReviewerRetryCandidate(input)).toThrow('document authority')
})

test('retry rejects rehashed issue verdicts whose kind disagrees with the source issue type', () => {
  const input = retryFixture()
  const verdict = input.previousRecheckResult.recheck!.issueVerdicts.find(item => item.kind === 'semantic' && item.status === 'PASS')!
  verdict.kind = 'deterministic'
  rebindRecheck(input)
  expect(() => prepareReviewerRetryCandidate(input)).toThrow('issue kind')
})
