import { expect, test } from 'bun:test'
import { prepareRevisionRequest } from '../request-preparation'
import { constructRevisionCandidate } from '../candidate-construction'
import { parseRevisionCandidateResult } from '../candidate-result'
import { revisionDigest } from '../json-digest'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'

function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const source = buildSingleReviewFixture({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) },
    documents })
  const prepared = prepareRevisionRequest({ ownerId: source.ownerId, projectId: source.projectId,
    requestId: 'revise', sourceResult: source, sourceBinding: binding(source) })
  const candidate = constructRevisionCandidate(prepared, crypto.randomUUID(), { summary: 'Revised files', documents: reviewFixtureDocuments() })
  return structuredClone(candidate)
}
function binding(result: { ownerId: string; projectId: string; resultId: string }) {
  return { ownerId: result.ownerId, projectId: result.projectId, resultId: result.resultId, resultDigest: revisionDigest(result) }
}
function resign<T extends { resultId: string }>(value: T): T {
  const { resultId: _, ...body } = value
  return { ...body, resultId: revisionDigest(body) } as T
}

test('candidate schema recaptures owner-produced bytes and rejects an independently unaccepted replacement', () => {
  const candidate = fixture()
  const accepted = binding(candidate)
  const captured = parseRevisionCandidateResult(candidate, accepted)
  expect<unknown>(captured).toEqual(candidate)
  captured.documents[0]!.content = 'local mutation'
  expect(candidate.documents[0]!.content).not.toBe('local mutation')
  const changed = resign({ ...candidate, requestId: 'replacement' })
  expect(() => parseRevisionCandidateResult(changed, accepted)).toThrow('binding')
  expect(() => parseRevisionCandidateResult(candidate, { ...accepted, projectId: 'foreign' })).toThrow('binding')
})

test('candidate schema rejects forged byte descriptors, incomplete sets and old candidate fields', () => {
  const candidate = fixture()
  const invalid = [
    { ...candidate, documents: candidate.documents.map((doc, index) => index ? doc : { ...doc, byteLength: doc.byteLength + 1 }) },
    { ...candidate, documents: candidate.documents.slice(1) },
    { ...candidate, documents: candidate.documents.map(() => candidate.documents[0]) },
    { ...candidate, revisionSummary: '' },
    { ...candidate, repairClaims: [] },
    { ...candidate, unresolvedIssues: [] },
    { ...candidate, changes: [] },
    { ...candidate, issueAssessments: [] },
    { ...candidate, protocolVersion: 1 },
  ]
  for (const value of invalid) {
    const result = resign(value)
    expect(() => parseRevisionCandidateResult(result, binding(result))).toThrow()
  }
})

test('candidate parser refuses audit authority fields and never evaluates accessors', () => {
  const candidate = fixture()
  const extra = resign({ ...candidate, resultingIssueRegistry: [] })
  expect(() => parseRevisionCandidateResult(extra, binding(extra))).toThrow()
  let called = false
  const accessor = { ...candidate }
  Object.defineProperty(accessor, 'documents', { enumerable: true, get() { called = true; return candidate.documents } })
  expect(() => parseRevisionCandidateResult(accessor, binding(candidate))).toThrow()
  expect(called).toBe(false)
  const hidden = { ...candidate }
  Object.defineProperty(hidden, 'privateState', { enumerable: false, value: {} })
  expect(() => parseRevisionCandidateResult(hidden, binding(candidate))).toThrow()
})
