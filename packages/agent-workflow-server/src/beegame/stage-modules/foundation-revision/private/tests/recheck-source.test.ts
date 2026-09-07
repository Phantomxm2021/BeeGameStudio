import { expect, test } from 'bun:test'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { buildReviewerTargetedResult } from '../../../foundation-reviewer/private/targeted-publication'
import { buildReviewerFullFormatResult } from '../../../foundation-reviewer/private/full-format-publication'
import { prepareReviewerFirstCandidate, type ReviewerCandidateBinding } from '../../../foundation-reviewer/private/candidate-handoff'
import { firstCandidateFixture, candidateFixtureFromReview } from '../../../foundation-reviewer/private/test-fixtures/candidate-fixture'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { validateReviewerTargetedFacts } from '../../../foundation-reviewer/private/targeted-preparation'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { buildRevisionInitialCandidate } from '../initial-candidate'
import { parseRevisionCandidateResult } from '../candidate-result'
import { parseRevisionRecheckSource } from '../recheck-source'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'

function binding(value: { ownerId: string; projectId: string; resultId: string }): ReviewerCandidateBinding {
  return { ownerId: value.ownerId, projectId: value.projectId, resultId: value.resultId, resultDigest: revisionDigest(value) }
}
function resign<T extends { resultId: string }>(value: T): T {
  const { resultId: _, ...body } = value
  return { ...body, resultId: revisionDigest(body) } as T
}
function twoIssueTargetedResult(allPass = false) {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [
      { problem: 'feedback', expected: 'readable feedback', actual: 'missing', sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } },
      { problem: 'navigation feedback', expected: 'navigation feedback', actual: 'missing', sourceSectionKey: 'UI#input', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['UI#input'] } },
    ] } : { status: 'completed', outcome: 'PASS' } })
  const docs = review.documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md'
    ? doc.content.replace('game.mechanics:', 'Readable feedback added.\n\ngame.mechanics:')
    : doc.path === 'docs/UI_UX_SPEC.md' ? doc.content.replace('ui.supported_actions:', 'Navigation note added.\n\nui.supported_actions:') : doc.content }))
  const first = candidateFixtureFromReview(review, docs)
  const semantic = validateReviewerTargetedFacts(first.prepared, []).semantic.map(({ issue, packet }) => ({ issueId: issue.id,
    output: allPass || issue.remediation.documentPath === 'docs/GDD.md' ? { status: 'PASS' as const } : { status: 'FAIL' as const, diagnostic: {
      observedActual: 'navigation feedback is still missing', failureReasonCode: 'expected_not_met' as const,
      evidence: packet.sections.map(({ ref }) => ({ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest })) } } }))
  return buildReviewerTargetedResult({ requestId: 'recheck', candidate: first.prepared, facts: [], semantic })
}
function formatSourceAndCandidate() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const source = buildReviewerPublishedResult({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) },
    documents, state: initialReviewerFactState(documents) })
  const candidate = buildRevisionInitialCandidate({ sourceResult: source, sourceBinding: binding(source), requestId: 'repair', candidateDocuments: reviewFixtureDocuments(), unresolvedIssues: [] })
  return { source, candidate: parseRevisionCandidateResult(JSON.parse(JSON.stringify(candidate)), binding(candidate)) }
}

test('accepts targeted retry evidence with two semantic verdicts and preserves a clone', () => {
  const result = twoIssueTargetedResult()
  const parsed = parseRevisionRecheckSource(JSON.parse(JSON.stringify(result)), binding(result))
  expect(revisionCanonicalJson(parsed)).toBe(revisionCanonicalJson(result))
  expect(parsed.kind).toBe('issues_found')
  expect(parsed.subject.kind).toBe('candidate')
  if (parsed.recheck.kind !== 'targeted') throw new Error('expected targeted recheck')
  expect(parsed.recheck.decision).toBe('retry_same_round')
  expect(parsed.recheck.issueVerdicts.filter(item => item.kind === 'semantic')).toHaveLength(2)
  const original = parsed.documents[0]!.content
  parsed.documents[0]!.content = 'mutated'
  expect(result.documents[0]!.content).toBe(original)
})

test('accepts a genuinely passed recheck and rejects replacement against the independent binding', () => {
  const result = twoIssueTargetedResult(true)
  expect(result.kind).toBe('passed')
  const accepted = binding(result)
  expect(parseRevisionRecheckSource(result, accepted).issues).toEqual([])
  const replacement = resign({ ...result, requestId: 'replacement' })
  expect(() => parseRevisionRecheckSource(replacement, accepted)).toThrow('binding')
  expect(() => parseRevisionRecheckSource(result, { ...accepted, ownerId: 'foreign' })).toThrow('binding')
  const hidden = { ...result }
  Object.defineProperty(hidden, 'checkpoint', { enumerable: false, value: {} })
  expect(() => parseRevisionRecheckSource(hidden, accepted)).toThrow()
})

test('accepts round-complete targeted output with newly discovered issues', () => {
  const first = firstCandidateFixture()
  const result = buildReviewerTargetedResult({ requestId: 'recheck-complete', candidate: first.prepared, facts: [],
    semantic: [{ issueId: first.prepared.issues[0]!.id, output: { status: 'PASS' } }] })
  const parsed = parseRevisionRecheckSource(JSON.parse(JSON.stringify(result)), binding(result))
  if (parsed.recheck.kind !== 'targeted') throw new Error('expected targeted recheck')
  expect(parsed.recheck.decision).toBe('round_complete')
  expect(parsed.issues.length).toBeGreaterThan(0)
})

test('accepts full-format recheck output and keeps the full-format route distinct', () => {
  const { source, candidate } = formatSourceAndCandidate()
  const prepared = prepareReviewerFirstCandidate({ sourceResult: source, sourceBinding: binding(source), candidateResult: candidate, candidateBinding: binding(candidate) })
  const complete = completedReviewFixture()
  const result = buildReviewerFullFormatResult({ requestId: 'full-recheck', candidate: prepared, state: complete.state })
  const parsed = parseRevisionRecheckSource(JSON.parse(JSON.stringify(result)), binding(result))
  expect(['passed', 'issues_found']).toContain(parsed.kind)
  expect(parsed.recheck).toMatchObject({ kind: 'full_format', nextRound: 1 })
})

test('rejects wrong subject, missing evidence, inconsistent kind, and rehashed byte/evidence changes', () => {
  const result = twoIssueTargetedResult()
  const cases = [
    resign({ ...result, subject: { ...result.subject, candidateId: 'wrong-candidate' } }),
    (() => { const { recheck: _, ...withoutRecheck } = result; return resign(withoutRecheck) })(),
    resign({ ...result, kind: 'passed' as const }),
    resign({ ...result, documents: result.documents.map((doc, index) => index ? doc : { ...doc, content: doc.content + '\nchanged' }) }),
  ]
  for (const value of cases) expect(() => parseRevisionRecheckSource(value, binding(value))).toThrow()
  const evidence = JSON.parse(JSON.stringify(result))
  const verdict = evidence.recheck.issueVerdicts.find((item: { status: string }) => item.status === 'FAIL')
  verdict.diagnostic.evidence[0].digest = 'f'.repeat(64)
  const changedEvidence = resign(evidence)
  expect(() => parseRevisionRecheckSource(changedEvidence, binding(changedEvidence))).toThrow(/section|evidence|stale/i)
})
