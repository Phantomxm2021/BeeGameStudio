import { expect, test } from 'bun:test'
import { buildRevisionInitialCandidate } from '../initial-candidate'
import { parseRevisionCandidateResult } from '../candidate-result'
import { revisionDigest } from '../json-digest'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

function fixture() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  const source = buildReviewerPublishedResult({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) },
    documents, state: initialReviewerFactState(documents) })
  const candidate = buildRevisionInitialCandidate({ sourceResult: source,
    sourceBinding: binding(source), requestId: 'revise', candidateDocuments: reviewFixtureDocuments(), unresolvedIssues: [] })
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

test('candidate schema rejects forged byte descriptors, claims, duplicate or mixed operations', () => {
  const candidate = fixture()
  const invalid = [
    { ...candidate, documents: candidate.documents.map((doc, index) => index ? doc : { ...doc, byteLength: doc.byteLength + 1 }) },
    { ...candidate, repairClaims: [...candidate.repairClaims, candidate.repairClaims[0]!] },
    { ...candidate, unresolvedIssues: [{ issueId: candidate.repairClaims[0]!.issueId, reason: 'unresolved' }] },
    { ...candidate, changes: [...candidate.changes, candidate.changes[0]!] },
    { ...candidate, changes: candidate.changes.map(change => ({ ...change, issueIds: ['foreign'] })) },
    { ...candidate, changes: candidate.changes.map(change => ({ ...change, issueIds: [...change.issueIds, change.issueIds[0]!] })) },
    { ...candidate, repairClaims: [...candidate.repairClaims, { issueId: 'uncovered', status: 'APPLIED' }] },
    { ...candidate, changes: [...candidate.changes, { scope: 'section', kind: 'INSERT', documentPath: candidate.documents[0]!.path,
      sectionId: 'player_actions', issueIds: [candidate.repairClaims[0]!.issueId], afterDigest: 'c'.repeat(64) }] },
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
