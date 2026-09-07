import { expect, test } from 'bun:test'
import { firstCandidateFixture } from '../test-fixtures/candidate-fixture'
import { prepareReviewerTargetedAudit, validateReviewerTargetedFacts } from '../targeted-preparation'
import { admitFoundationSemanticRecheckWorkerResult } from '../domain/foundation-patch-validation'
import { reviewFixtureDocuments } from '../test-fixtures/review-fixture'
import { initialReviewerFactState } from '../fact-state'
import { candidateFixtureFromReview } from '../test-fixtures/candidate-fixture'

test('verified candidate selects impacted facts and strong semantic rechecks, retaining discovered issues', () => {
  const { prepared } = firstCandidateFixture()
  const plan = prepareReviewerTargetedAudit(prepared)
  expect(plan.impact.factKeys).toEqual(['game.mechanics'])
  expect(plan.planned.packets).toEqual([])
  expect(plan.subject).toMatchObject({ kind: 'candidate', candidateId: 'candidate-one' })
  const validation = validateReviewerTargetedFacts(prepared, [])
  expect(validation.rebuilt.factStore).toHaveLength(2)
  expect(validation.semantic).toHaveLength(1)
  expect(validation.semantic[0]!.issue.id).toBe(prepared.issues[0]!.id)
  expect(validation.newImpactedIssues).toHaveLength(1)
  expect(validation.newImpactedIssues[0]!.remediation.documentPath).toBe('docs/TECHNICAL_DESIGN.md')
  const { issue, packet } = validation.semantic[0]!
  expect(admitFoundationSemanticRecheckWorkerResult(packet, { status: 'PASS' }, { taskId: 'reviewer-recheck', issue }).status).toBe('PASS')
})
test('missing targeted worker evidence cannot be replaced by an APPLIED repair claim', () => {
  const { prepared } = firstCandidateFixture(false)
  const plan = prepareReviewerTargetedAudit(prepared)
  expect(plan.planned.packets).toHaveLength(1)
  expect(plan.planned.packets[0]!.keys).toEqual(['game.mechanics'])
  expect(() => validateReviewerTargetedFacts(prepared, [])).toThrow()
})
test('targeted planning does not mutate accepted public inputs', () => {
  const { prepared } = firstCandidateFixture()
  const before = structuredClone(prepared)
  const plan = prepareReviewerTargetedAudit(prepared)
  plan.input.documents[0]!.content = 'mutated'
  plan.issues[0]!.actual = 'mutated'
  expect(prepared).toEqual(before)
})
test('localized format input cannot gain a false PASS from catalog-only targeted validation', () => {
  const candidateDocuments = reviewFixtureDocuments(true)
  const documents = structuredClone(candidateDocuments)
  const technical = documents.find(doc => doc.path === 'docs/TECHNICAL_DESIGN.md')!
  technical.content = technical.content.replace('| authority | complete |', '| authority | complete')
  const review = { documents, state: initialReviewerFactState(documents) }
  const { prepared } = candidateFixtureFromReview(review, candidateDocuments)
  expect(prepared.issues[0]!.remediation.scope).toBe('section')
  expect(() => prepareReviewerTargetedAudit(prepared)).toThrow('localized format')
})
