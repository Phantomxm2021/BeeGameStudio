import { expect, test } from 'bun:test'
import { buildRevisionInitialCandidate } from '../initial-candidate'
import { buildRevisionNextRoundCandidate, buildRevisionRetryCandidate } from '../followup-candidate'
import { parseRevisionCandidateResult } from '../candidate-result'
import { revisionDigest } from '../json-digest'
import { prepareRevisionRequest } from '../request-preparation'
import { bindReviewDocuments } from '../../../foundation-reviewer/private/prepare-review'
import { prepareReviewerFirstCandidate, prepareReviewerRetryCandidate } from '../../../foundation-reviewer/private/candidate-handoff'
import { buildReviewerFullFormatResult } from '../../../foundation-reviewer/private/full-format-publication'
import { buildReviewerTargetedResult } from '../../../foundation-reviewer/private/targeted-publication'
import { prepareReviewerTargetedAudit, validateReviewerTargetedFacts } from '../../../foundation-reviewer/private/targeted-preparation'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { firstCandidateFixture, candidateFixtureFromReview } from '../../../foundation-reviewer/private/test-fixtures/candidate-fixture'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

function binding(value: { ownerId: string; projectId: string; resultId: string }) {
  return { ownerId: value.ownerId, projectId: value.projectId, resultId: value.resultId, resultDigest: revisionDigest(value) }
}

function twoIssueFixture() {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [
      { problem: 'feedback', expected: 'readable feedback', actual: 'missing', sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } },
      { problem: 'navigation feedback', expected: 'navigation feedback', actual: 'missing', sourceSectionKey: 'UI#input', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['UI#input'] } },
    ] } : { status: 'completed', outcome: 'PASS' } })
  const documents = review.documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md'
    ? doc.content.replace('game.mechanics:', 'Readable feedback added.\n\ngame.mechanics:')
    : doc.path === 'docs/UI_UX_SPEC.md' ? doc.content.replace('ui.supported_actions:', 'Navigation note added.\n\nui.supported_actions:') : doc.content }))
  const first = candidateFixtureFromReview(review, documents)
  const validation = validateReviewerTargetedFacts(first.prepared, [])
  const semantic = validation.semantic.map(({ issue, packet }) => ({ issueId: issue.id,
    output: issue.remediation.documentPath === 'docs/GDD.md' ? { status: 'PASS' as const } : { status: 'FAIL' as const, diagnostic: {
      observedActual: 'navigation feedback is still missing', failureReasonCode: 'expected_not_met' as const,
      evidence: packet.sections.map(({ ref }) => ({ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest })) } } }))
  const recheck = buildReviewerTargetedResult({ requestId: 'recheck-one', candidate: first.prepared, facts: [], semantic })
  const retryDocuments = first.prepared.documents.map(doc => ({ ...doc, content: doc.path === 'docs/UI_UX_SPEC.md'
    ? doc.content.replace('Navigation note added.', 'Navigation feedback implemented.') : doc.content }))
  return { first, recheck, retryDocuments }
}

function candidateBinding(candidate: { ownerId: string; projectId: string; resultId: string }) {
  return binding(candidate)
}

test('builds a same-round retry from accepted Reviewer evidence and retains PASS bytes', () => {
  const { first, recheck, retryDocuments } = twoIssueFixture()
  const plan = prepareRevisionRequest({ kind: 'retry_same_round', ownerId: recheck.ownerId, projectId: recheck.projectId,
    requestId: 'retry-two', sourceResult: first.input.sourceResult, sourceBinding: binding(first.input.sourceResult),
    previousCandidateResult: first.input.candidateResult, previousCandidateBinding: binding(first.input.candidateResult),
    previousRecheckResult: recheck, previousRecheckBinding: binding(recheck) })
  expect(plan.retainedDocumentPaths).toEqual(['docs/GDD.md'])
  expect(plan.batches.map(batch => batch.documentPath)).toEqual(['docs/UI_UX_SPEC.md'])
  expect(plan.staging.documents.find(doc => doc.path === 'docs/UI_UX_SPEC.md')!.content)
    .toBe(first.input.sourceResult.documents.find(doc => doc.path === 'docs/UI_UX_SPEC.md')!.content)
  expect(plan.staging.documents[0]!.content).toBe(first.input.candidateResult.documents[0]!.content)
  const retry = buildRevisionRetryCandidate({
    sourceResult: first.input.sourceResult, sourceBinding: binding(first.input.sourceResult),
    previousCandidateResult: first.input.candidateResult, previousCandidateBinding: binding(first.input.candidateResult),
    previousRecheckResult: recheck, previousRecheckBinding: binding(recheck), requestId: 'retry-two',
    candidateDocuments: retryDocuments,
  })
  expect(retry.candidateId).not.toBe(first.input.candidateResult.candidateId)
  expect(retry.round).toBe(1)
  expect(retry.previous).toEqual({
    candidateId: first.input.candidateResult.candidateId,
    candidateResultId: first.input.candidateResult.resultId,
    candidateResultDigest: revisionDigest(first.input.candidateResult),
    recheckResultId: recheck.resultId,
    recheckResultDigest: revisionDigest(recheck),
  })
  expect(retry.documents.find(doc => doc.path === 'docs/GDD.md')!.content)
    .toBe(first.input.candidateResult.documents.find(doc => doc.path === 'docs/GDD.md')!.content)
  const prepared = prepareReviewerRetryCandidate({
    sourceResult: first.input.sourceResult, sourceBinding: binding(first.input.sourceResult),
    candidateResult: retry, candidateBinding: candidateBinding(retry),
    previousCandidateResult: first.input.candidateResult, previousCandidateBinding: binding(first.input.candidateResult),
    previousRecheckResult: recheck, previousRecheckBinding: binding(recheck),
  })
  expect(prepared.candidate.round).toBe(1)
  expect(prepared.documents.find(doc => doc.path === 'docs/GDD.md')!.content)
    .toBe(first.input.candidateResult.documents.find(doc => doc.path === 'docs/GDD.md')!.content)
  expect(prepared.documents.find(doc => doc.path === 'docs/UI_UX_SPEC.md')!.content)
    .toContain('Navigation feedback implemented.')
})

test('rejects retained-byte changes, foreign predecessors, independent rechecks, and caller-owned fields', () => {
  const { first, recheck, retryDocuments } = twoIssueFixture()
  const base = {
    sourceResult: first.input.sourceResult, sourceBinding: binding(first.input.sourceResult),
    previousCandidateResult: first.input.candidateResult, previousCandidateBinding: binding(first.input.candidateResult),
    previousRecheckResult: recheck, previousRecheckBinding: binding(recheck), requestId: 'retry-invalid', candidateDocuments: retryDocuments,
  }
  const retainedChanged = retryDocuments.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md' ? `${doc.content}\nforeign` : doc.content }))
  expect(() => buildRevisionRetryCandidate({ ...base, candidateDocuments: retainedChanged })).toThrow(/retained|changed/i)

  const foreignCandidate = structuredClone(first.input.candidateResult)
  foreignCandidate.candidateId = 'foreign-candidate'
  const foreignCandidateBody = { ...foreignCandidate, resultId: '' }
  const { resultId: _foreignResultId, ...foreignBody } = foreignCandidateBody
  const foreignCandidateResult = { ...foreignBody, resultId: revisionDigest(foreignBody) }
  expect(() => buildRevisionRetryCandidate({ ...base, previousCandidateResult: foreignCandidateResult,
    previousCandidateBinding: binding(foreignCandidateResult) })).toThrow(/predecessor|candidate|source|authority/i)

  const independentRecheck = buildReviewerTargetedResult({ requestId: 'independent-recheck', candidate: first.prepared, facts: [],
    semantic: validateReviewerTargetedFacts(first.prepared, []).semantic.map(({ issue }) => ({ issueId: issue.id, output: { status: 'PASS' as const } })) })
  expect(() => buildRevisionRetryCandidate({ ...base, previousRecheckResult: independentRecheck,
    previousRecheckBinding: binding(independentRecheck) })).toThrow(/predecessor|recheck|authority/i)

  for (const field of ['candidateId', 'repairClaims', 'unresolvedIssues'] as const) {
    const injected = { ...base, [field]: field === 'candidateId' ? 'caller-owned' : [] }
    expect(() => buildRevisionRetryCandidate(injected as never)).toThrow()
  }
})

test('builds round two from a completed targeted recheck and reaches Reviewer PASS', () => {
  const { prepared } = firstCandidateFixture()
  const sourceResult = buildReviewerTargetedResult({ requestId: 'round-one', candidate: prepared, facts: [],
    semantic: [{ issueId: prepared.issues[0]!.id, output: { status: 'PASS' } }] })
  expect(sourceResult.kind).toBe('issues_found')
  const documents = sourceResult.documents.map(({ path, content }) => ({ path, content: path === 'docs/TECHNICAL_DESIGN.md'
    ? content.replace('technical.supported_actions: ["move","attack","dash"]', 'technical.supported_actions: ["move","attack","dash","parry"]') : content }))
  const next = buildRevisionNextRoundCandidate({ sourceResult, sourceBinding: binding(sourceResult), requestId: 'round-two', candidateDocuments: documents, unresolvedIssues: [] })
  expect(next.round).toBe(2)
  const plan = prepareRevisionRequest({ kind: 'next_round', ownerId: sourceResult.ownerId, projectId: sourceResult.projectId,
    requestId: 'round-two', sourceResult, sourceBinding: binding(sourceResult) })
  expect(plan.round).toBe(2)
  expect(plan.staging.documents).toEqual(sourceResult.documents)
  expect(plan.previous).toBeNull()
  expect(next.previous).toBeUndefined()
  const nextPrepared = prepareReviewerFirstCandidate({ sourceResult, sourceBinding: binding(sourceResult), candidateResult: next, candidateBinding: candidateBinding(next) })
  const final = buildReviewerTargetedResult({ requestId: 'round-two-review', candidate: nextPrepared, facts: [], semantic: [] })
  expect(final.kind).toBe('passed')
  expect(final.issues).toEqual([])
  expect(final.recheck?.kind).toBe('targeted')
})

test('keeps full-format follow-up at round one and rejects invalid repair sources', () => {
  const malformedDocuments = reviewFixtureDocuments(true)
  malformedDocuments[0]!.content = '# incomplete'
  const initialSource = buildReviewerPublishedResult({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'initial' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) },
    documents: malformedDocuments, state: initialReviewerFactState(malformedDocuments) })
  const initialCandidate = buildRevisionInitialCandidate({ sourceResult: initialSource, sourceBinding: binding(initialSource), requestId: 'format-candidate',
    candidateDocuments: reviewFixtureDocuments(true), unresolvedIssues: [] })
  const initialPrepared = prepareReviewerFirstCandidate({ sourceResult: initialSource, sourceBinding: binding(initialSource), candidateResult: initialCandidate, candidateBinding: candidateBinding(initialCandidate) })
  const formatReview = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback', expected: 'readable feedback', actual: 'missing', sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  const formatSource = buildReviewerFullFormatResult({ requestId: 'format-review', candidate: initialPrepared, state: formatReview.state })
  expect(formatSource.kind).toBe('issues_found')
  expect(formatSource.issues.some(entry => entry.issue.type === 'semantic')).toBe(true)
  expect(formatSource.recheck?.kind).toBe('full_format')
  const fixed = formatSource.documents.map(({ path, content }) => ({ path, content: path === 'docs/GDD.md'
    ? content.replace('game.mechanics:', 'Readable feedback added.\n\ngame.mechanics:') : content }))
  const next = buildRevisionNextRoundCandidate({ sourceResult: formatSource, sourceBinding: binding(formatSource), requestId: 'format-next', candidateDocuments: fixed, unresolvedIssues: [] })
  expect(next.round).toBe(1)
  const plan = prepareRevisionRequest({ kind: 'next_round', ownerId: formatSource.ownerId, projectId: formatSource.projectId,
    requestId: 'format-next', sourceResult: formatSource, sourceBinding: binding(formatSource) })
  expect(plan.round).toBe(1)
  expect(plan.batches[0]!.scope).toBe('section')
  expect(next.previous).toBeUndefined()

  const { first, recheck } = twoIssueFixture()
  expect(() => prepareRevisionRequest({ kind: 'next_round', ownerId: recheck.ownerId, projectId: recheck.projectId,
    requestId: 'invalid-next', sourceResult: recheck, sourceBinding: binding(recheck) })).toThrow(/retry|round|source/i)
  expect(() => buildRevisionNextRoundCandidate({ sourceResult: first.input.sourceResult, sourceBinding: binding(first.input.sourceResult),
    requestId: 'invalid-initial', candidateDocuments: first.input.candidateResult.documents.map(({ path, content }) => ({ path, content })), unresolvedIssues: [] })).toThrow(/candidate recheck|source/i)
  expect(() => buildRevisionNextRoundCandidate({ sourceResult: recheck, sourceBinding: binding(recheck), requestId: 'invalid-retry',
    candidateDocuments: first.input.candidateResult.documents.map(({ path, content }) => ({ path, content })), unresolvedIssues: [] })).toThrow(/retry|round|source/i)

  const { prepared: firstPrepared } = firstCandidateFixture()
  const completed = buildReviewerTargetedResult({ requestId: 'completed-source', candidate: firstPrepared, facts: [],
    semantic: [{ issueId: firstPrepared.issues[0]!.id, output: { status: 'PASS' } }] })
  const corrected = completed.documents.map(({ path, content }) => ({ path, content: path === 'docs/TECHNICAL_DESIGN.md'
    ? content.replace('technical.supported_actions: ["move","attack","dash"]', 'technical.supported_actions: ["move","attack","dash","parry"]') : content }))
  const completedCandidate = buildRevisionNextRoundCandidate({ sourceResult: completed, sourceBinding: binding(completed), requestId: 'completed-next', candidateDocuments: corrected, unresolvedIssues: [] })
  const completedPrepared = prepareReviewerFirstCandidate({ sourceResult: completed, sourceBinding: binding(completed), candidateResult: completedCandidate, candidateBinding: candidateBinding(completedCandidate) })
  const passed = buildReviewerTargetedResult({ requestId: 'passed-source', candidate: completedPrepared, facts: [], semantic: [] })
  expect(passed.kind).toBe('passed')
  expect(() => buildRevisionNextRoundCandidate({ sourceResult: passed, sourceBinding: binding(passed), requestId: 'invalid-passed', candidateDocuments: corrected, unresolvedIssues: [] })).toThrow(/issues|source/i)
})
