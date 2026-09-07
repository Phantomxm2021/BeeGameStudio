import { expect, test } from 'bun:test'
import { buildRevisionRetryCandidate } from '../followup-candidate'
import { revisionDigest } from '../json-digest'
import { firstCandidateFixture } from '../../../foundation-reviewer/private/test-fixtures/candidate-fixture'
import { buildReviewerTargetedResult } from '../../../foundation-reviewer/private/targeted-publication'
import { prepareReviewerRetryCandidate } from '../../../foundation-reviewer/private/candidate-handoff'
import { validateReviewerTargetedFacts, type ReviewerPreparedCandidate } from '../../../foundation-reviewer/private/targeted-preparation'

const binding = (value: { ownerId: string; projectId: string; resultId: string }) => ({
  ownerId: value.ownerId, projectId: value.projectId, resultId: value.resultId, resultDigest: revisionDigest(value) })
function failedRecheck(candidate: ReviewerPreparedCandidate, requestId: string) {
  const semantic = validateReviewerTargetedFacts(candidate, []).semantic.map(({ issue, packet }) => ({ issueId: issue.id,
    output: { status: 'FAIL', diagnostic: { observedActual: 'feedback remains missing', failureReasonCode: 'actual_persists',
      evidence: packet.sections.map(({ ref }) => ({ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest })) } } }))
  return buildReviewerTargetedResult({ requestId, candidate, facts: [], semantic })
}

test('multiple same-round retries bind the exact predecessor and reject a late older recheck', () => {
  const first = firstCandidateFixture()
  const firstRecheck = failedRecheck(first.prepared, 'review-first')
  const secondDocuments = first.prepared.documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md'
    ? doc.content.replace('game.mechanics:', 'First retry feedback.\n\ngame.mechanics:') : doc.content }))
  const secondInput = { sourceResult: first.input.sourceResult, sourceBinding: first.input.sourceBinding,
    previousCandidateResult: first.input.candidateResult, previousCandidateBinding: first.input.candidateBinding,
    previousRecheckResult: firstRecheck, previousRecheckBinding: binding(firstRecheck), requestId: 'second', candidateDocuments: secondDocuments }
  const second = buildRevisionRetryCandidate(secondInput)
  const preparedSecond = prepareReviewerRetryCandidate({ ...secondInput, candidateResult: second, candidateBinding: binding(second) })
  const secondRecheck = failedRecheck(preparedSecond, 'review-second')
  const thirdInput = { ...secondInput, previousCandidateResult: second, previousCandidateBinding: binding(second),
    previousRecheckResult: secondRecheck, previousRecheckBinding: binding(secondRecheck), requestId: 'third',
    candidateDocuments: secondDocuments.map(doc => ({ ...doc, content: doc.content.replace('First retry feedback.', 'Second retry feedback.') })) }
  const third = buildRevisionRetryCandidate(thirdInput)
  expect(third.round).toBe(1)
  expect(third.previous).toEqual({ candidateId: second.candidateId, candidateResultId: second.resultId, candidateResultDigest: revisionDigest(second),
    recheckResultId: secondRecheck.resultId, recheckResultDigest: revisionDigest(secondRecheck) })
  expect(third.candidateId).not.toBe(second.candidateId)
  expect(prepareReviewerRetryCandidate({ ...thirdInput, candidateResult: third, candidateBinding: binding(third) }).candidate.resultId).toBe(third.resultId)
  expect(() => buildRevisionRetryCandidate({ ...thirdInput, previousRecheckResult: firstRecheck, previousRecheckBinding: binding(firstRecheck) })).toThrow('authority')

  if (secondRecheck.subject.kind !== 'candidate') throw new Error('expected candidate subject')
  const forged = { ...secondRecheck, subject: { ...secondRecheck.subject, previousCandidateId: 'wrong-previous' } }
  forged.inputDigest = revisionDigest({ ownerId: forged.ownerId, projectId: forged.projectId,
    subject: forged.subject, documentSetDigest: forged.documentSetDigest })
  const { resultId: _, ...body } = forged
  forged.resultId = revisionDigest(body)
  expect(() => buildRevisionRetryCandidate({ ...thirdInput, previousRecheckResult: forged, previousRecheckBinding: binding(forged) })).toThrow('subject authority')
})
