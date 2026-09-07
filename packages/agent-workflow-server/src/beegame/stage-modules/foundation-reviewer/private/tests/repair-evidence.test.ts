import { expect, test } from 'bun:test'
import { reviewerRepairEvidenceKeys } from '../repair-evidence'
import { completedReviewFixture } from '../test-fixtures/review-fixture'
import { summarizeReviewer } from '../review-summary'
import type { AuditIssue } from '../domain/foundation-issue-registry'

function fixture() {
  return completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{
      problem: 'Action feedback conflict', expected: 'actions have readable feedback', actual: 'feedback is missing',
      sourceSectionKey: 'GDD#player_actions',
      remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] },
    }] } : { status: 'completed', outcome: 'PASS' } })
}

test('repair handoff includes the untouched contract dependency without exporting unrelated facts', () => {
  const input = fixture()
  const result = summarizeReviewer(input.documents, input.state)
  expect(result.issues).toHaveLength(1)
  const entry = result.issues[0]!
  expect(reviewerRepairEvidenceKeys(entry.issue)).toEqual(['game.mechanics', 'technical.supported_actions'])
  expect(entry.facts.map(fact => fact.key).sort()).toEqual(['game.mechanics', 'technical.supported_actions'])
  expect(entry.issue.remediation).toEqual({ kind: 'patch', scope: 'section', documentPath: 'docs/GDD.md', sectionIds: ['player_actions'] })
  expect(entry.sections.map(section => section.path)).toEqual(['docs/GDD.md'])
})

test('evidence selection uses allowed repairs, not only the original issue location', () => {
  const input = fixture()
  const issue = summarizeReviewer(input.documents, input.state).issues[0]!.issue as AuditIssue
  issue.remediation = { kind: 'patch', scope: 'section', documentPath: 'docs/UI_UX_SPEC.md', sectionIds: ['hud'] }
  expect(reviewerRepairEvidenceKeys(issue)).toEqual(['game.mechanics', 'game.resources', 'ui.displayed_resources'])
  // The original source is context only: it does not expand the affected contract scope.
  expect(reviewerRepairEvidenceKeys(issue)).not.toContain('technical.supported_actions')
})
