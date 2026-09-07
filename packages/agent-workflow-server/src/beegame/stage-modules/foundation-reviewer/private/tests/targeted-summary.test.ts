import { expect, test } from 'bun:test'
import { candidateFixtureFromReview, firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { completedReviewFixture, reviewFixtureDocuments } from '../test-fixtures/review-fixture'
import { summarizeReviewerTargeted } from '../targeted-summary'
import { validateReviewerTargetedFacts } from '../targeted-preparation'

test('semantic PASS closes its original issue but preserves newly discovered deterministic authority', () => {
  const { prepared } = firstCandidateFixture()
  const summary = summarizeReviewerTargeted(prepared, [], [{ issueId: prepared.issues[0]!.id, output: { status: 'PASS' } }])
  expect(summary.decision).toBe('round_complete')
  expect(summary.kind).toBe('issues_found')
  expect(summary.issueVerdicts).toEqual([{ issueId: prepared.issues[0]!.id, status: 'PASS', kind: 'semantic' }])
  expect(summary.documentVerdicts[0]!.status).toBe('PASS')
  expect(summary.issues).toHaveLength(1)
  expect(summary.issues[0]!.issue.remediation.documentPath).toBe('docs/TECHNICAL_DESIGN.md')
  expect(summary.issues[0]!.facts.map(fact => fact.key)).toEqual(['game.mechanics', 'technical.supported_actions'])
})
test('semantic FAIL preserves issue identity and reports same-round repair without publishing new discoveries', () => {
  const { prepared } = firstCandidateFixture()
  const ref = validateReviewerTargetedFacts(prepared, []).semantic[0]!.packet.sections[0]!.ref
  const summary = summarizeReviewerTargeted(prepared, [], [{ issueId: prepared.issues[0]!.id,
    output: { status: 'FAIL', diagnostic: { observedActual: 'feedback remains missing', failureReasonCode: 'actual_persists',
      evidence: [{ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest }] } } }])
  expect(summary.decision).toBe('retry_same_round')
  expect(summary.documentVerdicts[0]!.retryIssueIds).toEqual([prepared.issues[0]!.id])
  expect(summary.issueVerdicts[0]!.diagnostic?.unmetExpected).toBe(prepared.issues[0]!.expected)
  expect(summary.issues.map(entry => entry.issue.id)).toEqual([prepared.issues[0]!.id])
  expect(summary.issues[0]!.issue.source.digest).toBe(ref.digest)
})
test('deterministic FAIL defers unrun semantic checks instead of claiming retained documents passed', () => {
  const documents = reviewFixtureDocuments(true)
  documents[0]!.content = documents[0]!.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]')
  const review = completedReviewFixture({ documents, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback', expected: 'readable feedback', actual: 'missing',
      sourceSectionKey: 'GDD#player_actions', remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  const changed = documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md'
    ? doc.content.replace('game.mechanics:', 'More readable feedback.\n\ngame.mechanics:')
    : doc.path === 'docs/TECHNICAL_DESIGN.md' ? doc.content.replace('technical.supported_actions:',
      'Documentation updated without adding the required action.\n\ntechnical.supported_actions:') : doc.content }))
  const { prepared } = candidateFixtureFromReview(review, changed)
  const summary = summarizeReviewerTargeted(prepared, [], [])
  expect(summary.decision).toBe('retry_same_round')
  expect(summary.documentVerdicts.find(doc => doc.documentPath === 'docs/GDD.md')!.status).toBe('DEFERRED')
  expect(summary.documentVerdicts.find(doc => doc.documentPath === 'docs/TECHNICAL_DESIGN.md')!.status).toBe('FAIL')
  expect(summary.issueVerdicts.some(issue => issue.kind === 'semantic' && issue.status === 'NOT_CHECKED')).toBe(true)
  expect(() => summarizeReviewerTargeted(prepared, [], [{ issueId: prepared.issues.find(issue => issue.type === 'semantic')!.id, output: { status: 'PASS' } }])).toThrow('deferred')
})
test('summary rejects missing, duplicate and foreign semantic replies', () => {
  const { prepared } = firstCandidateFixture()
  const reply = { issueId: prepared.issues[0]!.id, output: { status: 'PASS' } }
  expect(() => summarizeReviewerTargeted(prepared, [], [])).toThrow('coverage')
  expect(() => summarizeReviewerTargeted(prepared, [], [reply, reply])).toThrow('duplicate')
  expect(() => summarizeReviewerTargeted(prepared, [], [{ ...reply, issueId: 'foreign' }])).toThrow('coverage')
})
