import { expect, test } from 'bun:test'
import { prepareRevisionRequest } from '../request-preparation'
import { revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const sourceResult = buildSingleReviewFixture({ documents,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  return { ownerId: 'owner', projectId: 'project', requestId: 'repair', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
}

test('initial request captures deterministic execution planning without candidate identity or side effects', () => {
  const input = fixture()
  const prepared = prepareRevisionRequest(input)
  expect(prepareRevisionRequest(input)).toEqual(prepared)
  expect(prepared.round).toBe(1)
  expect(prepared).not.toHaveProperty('previous')
  expect(prepared).not.toHaveProperty('batches')
  expect(prepared.source.documents).toEqual(input.sourceResult.documents)
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
  expect(() => prepareRevisionRequest({ ...input, kind: 'next_round' })).toThrow()
  expect(() => prepareRevisionRequest({ ...input, ownerId: 'foreign' })).toThrow('identity')
  expect(() => prepareRevisionRequest({ ...input, projectId: 'foreign' })).toThrow('identity')
  expect(() => prepareRevisionRequest({ ...input, sourceBinding: { ...input.sourceBinding, resultDigest: '0'.repeat(64) } })).toThrow('binding')
  expect(() => prepareRevisionRequest({ ...input, kind: 'retry_same_round' })).toThrow()
})
