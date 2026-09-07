import { expect, test } from 'bun:test'
import { prepareRevisionRequest } from '../request-preparation'
import { revisionDigest } from '../json-digest'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildReviewerPublishedResult({ documents, state: initialReviewerFactState(documents),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  return { kind: 'initial', ownerId: 'owner', projectId: 'project', requestId: 'repair', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
}

function sectionRemediationFixture() {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback conflict', expected: 'readable feedback', actual: 'missing feedback',
      sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['UI#input'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  const sourceResult = buildReviewerPublishedResult({ documents: review.documents, state: review.state,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  return { kind: 'initial', ownerId: 'owner', projectId: 'project', requestId: 'repair-remediation-scope', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
}

test('initial request captures deterministic execution planning without candidate identity or side effects', () => {
  const input = fixture()
  const prepared = prepareRevisionRequest(input)
  expect(prepareRevisionRequest(input)).toEqual(prepared)
  expect(prepared.round).toBe(1)
  expect(prepared.previous).toBeNull()
  expect(prepared.batches).toEqual([{ scope: 'document', documentPath: 'docs/GDD.md', sectionIds: [], issueIds: prepared.repairIssueIds }])
  expect(prepared.dispatchIssueIds).toEqual(prepared.repairIssueIds)
  expect(prepared.staging.documents).toEqual(input.sourceResult.documents)
  expect(prepared.requestDigest).toBe(revisionDigest(input))
  expect(prepared).not.toHaveProperty('candidateId')
  input.sourceResult.documents[0]!.content = 'changed by caller'
  expect(prepared.source.documents[0]!.content).toBe('# incomplete')
  expect(prepared.request.sourceResult).not.toEqual(input.sourceResult)
})

test('rejects caller-owned execution authority, wrong phase, foreign owner and altered source binding', () => {
  const input = fixture()
  for (const extra of [{ round: 9 }, { candidateId: 'chosen' }, { batches: [] }, { retainedDocumentPaths: [] }, { unresolvedIssues: [] }])
    expect(() => prepareRevisionRequest({ ...input, ...extra })).toThrow()
  expect(() => prepareRevisionRequest({ ...input, kind: 'next_round' })).toThrow('phase')
  expect(() => prepareRevisionRequest({ ...input, ownerId: 'foreign' })).toThrow('owner/project')
  expect(() => prepareRevisionRequest({ ...input, projectId: 'foreign' })).toThrow('owner/project')
  expect(() => prepareRevisionRequest({ ...input, sourceBinding: { ...input.sourceBinding, resultDigest: '0'.repeat(64) } })).toThrow('binding')
  expect(() => prepareRevisionRequest({ ...input, kind: 'retry_same_round' })).toThrow()
})

test('rebuilds remediation section authority when public slices only contain source and target evidence', () => {
  const input = sectionRemediationFixture()
  const issue = input.sourceResult.issues.find(entry => entry.issue.remediation.scope === 'section')!
  expect(issue.issue.source).toMatchObject({ documentPath: 'docs/GDD.md', sectionId: 'player_actions' })
  expect(issue.sections.map(section => section.sectionId)).toEqual(['player_actions'])
  expect(issue.issue.remediation).toEqual({ kind: 'patch', scope: 'section', documentPath: 'docs/UI_UX_SPEC.md', sectionIds: ['input'] })

  const prepared = prepareRevisionRequest(input)
  expect(prepared.batches).toEqual([{ scope: 'section', documentPath: 'docs/UI_UX_SPEC.md', sectionIds: ['input'], issueIds: prepared.repairIssueIds }])
  expect(prepared.dispatchIssueIds).toEqual(prepared.repairIssueIds)
})
