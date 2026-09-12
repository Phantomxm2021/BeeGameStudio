import { expect, test } from 'bun:test'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'
import { parseSingleRevisionSource, type SingleRevisionSource } from '../single-review-source'
import { revisionDigest } from '../json-digest'
import { prepareRevisionRequest } from '../request-preparation'
import { constructRevisionCandidate } from '../candidate-construction'

function sourceFixture() {
  const documents = reviewFixtureDocuments(); documents[0]!.content = '# incomplete'
  return buildSingleReviewFixture({ documents, identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
}
const binding = (source: SingleRevisionSource) => ({ ownerId: source.ownerId, projectId: source.projectId,
  resultId: source.resultId, resultDigest: revisionDigest(source) })
const request = (source = sourceFixture()) => ({
  ownerId: source.ownerId, projectId: source.projectId, requestId: 'repair', sourceResult: source, sourceBinding: binding(source) })
function resign(source: SingleRevisionSource) {
  source.issues = source.issues.map(({ issue }) => { const { id: _, ...body } = issue; return { issue: { ...body, id: revisionDigest(body) } } })
  source.issueRegistryDigest = revisionDigest(source.issues.map(entry => entry.issue))
  source.evidenceDigest = revisionDigest({ audit: source.audit, issues: source.issues })
  const { resultId: _, ...body } = source; source.resultId = revisionDigest(body)
  return source
}
test('consumer admits an independent full-review source and rejects a replacement against the accepted binding', () => {
  const source = sourceFixture(), accepted = binding(source)
  const copy = parseSingleRevisionSource(source, accepted)
  copy.documents[0]!.content = 'caller mutation'
  expect(source.documents[0]!.content).toBe('# incomplete')
  source.requestId = 'replacement'; resign(source)
  expect(() => parseSingleRevisionSource(source, accepted)).toThrow('binding')
})

test('one request captures the full source without worker planning or proof ledgers', () => {
  const value = request(), before = structuredClone(value)
  const prepared = prepareRevisionRequest(value)
  expect(prepared.source).toEqual(value.sourceResult)
  expect(Object.keys(prepared).sort()).toEqual(['request', 'requestDigest', 'round', 'source'])
  expect(prepared.round).toBe(1)
  expect(value).toEqual(before)
  for (const field of ['kind', 'executionMode', 'batches', 'planningIssues'])
    expect(() => prepareRevisionRequest({ ...value, [field]: 'legacy' })).toThrow()
})
test('old policies and fields are rejected even when all outer digests are recomputed', () => {
  for (const mutate of [
    (source: any) => { source.audit.policy = 'single-agent-full-document-audit.v1' },
    (source: any) => { source.audit.validation = {} },
    (source: any) => { source.issues[0].issue.remediation = {} },
    (source: any) => { source.issues[0].issue.evidence = [] },
    (source: any) => { source.documents[0].content += 'tampered' },
  ]) {
    const source = sourceFixture(); mutate(source); resign(source)
    expect(() => parseSingleRevisionSource(source, binding(source))).toThrow()
  }
})
test('all eight documents may change; candidate is a bound snapshot plus summary', () => {
  const prepared = prepareRevisionRequest(request())
  const documents = reviewFixtureDocuments().map(doc => ({ ...doc, content: doc.content + '\nChanged' }))
  const candidate = constructRevisionCandidate(prepared, crypto.randomUUID(), { summary: 'Coordinated updates', documents })
  expect(candidate.protocolVersion).toBe(2)
  expect(candidate.revisionSummary).toBe('Coordinated updates')
  expect(candidate.documents.map(({ path, content }) => ({ path, content }))).toEqual(documents)
  expect(candidate).not.toHaveProperty('repairClaims')
  expect(candidate).not.toHaveProperty('changes')
  expect(candidate).not.toHaveProperty('unresolvedIssues')
  expect(prepared.source.documents[0]!.content).toBe('# incomplete')
  expect(() => constructRevisionCandidate(prepared, crypto.randomUUID(), { summary: '', documents })).toThrow()
  expect(() => constructRevisionCandidate(prepared, crypto.randomUUID(), { summary: 'Incomplete', documents: documents.slice(1) })).toThrow()
})
