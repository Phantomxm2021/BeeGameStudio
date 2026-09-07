import { expect, test } from 'bun:test'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { prepareReviewerFirstCandidate } from '../../../foundation-reviewer/private/candidate-handoff'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { bindRevisionDocuments } from '../document-snapshot'
import { revisionDigest } from '../json-digest'
import { buildRevisionInitialCandidate } from '../initial-candidate'
import { parseRevisionCandidateResult } from '../candidate-result'

const identity = { ownerId: 'revision-owner', projectId: 'revision-project', requestId: 'review' }
const subject = { kind: 'initial' as const, sourceResultId: 'author-result', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }

function sourceWithSemanticIssue() {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback conflict', expected: 'readable feedback', actual: 'missing feedback',
      sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  return buildReviewerPublishedResult({ identity, subject, ...review })
}

function sourceWithFormatIssue() {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete'
  return buildReviewerPublishedResult({ identity, subject, documents, state: initialReviewerFactState(documents) })
}

function binding(value: { ownerId: string; projectId: string; resultId: string }) {
  return { ownerId: value.ownerId, projectId: value.projectId, resultId: value.resultId, resultDigest: revisionDigest(value) }
}

function changedSemanticDocuments() {
  return sourceWithSemanticIssue().documents.map(document => ({ path: document.path, content: document.path === 'docs/GDD.md'
    ? document.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]')
    : document.content }))
}

function candidateInput(source: ReturnType<typeof sourceWithSemanticIssue>, candidateDocuments = changedSemanticDocuments(), unresolvedIssues = []) {
  return { sourceResult: source, sourceBinding: binding(source), requestId: 'repair-request', candidateDocuments, unresolvedIssues }
}

function mutableCandidate(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

test('partial candidate accounts for every issue and preserves unresolved document bytes', () => {
  const documents = reviewFixtureDocuments()
  documents[0]!.content = '# incomplete first'
  documents[1]!.content = '# incomplete second'
  const source = buildReviewerPublishedResult({ identity, subject, documents, state: initialReviewerFactState(documents) })
  const deferred = source.issues.find(entry => entry.issue.remediation.documentPath === documents[1]!.path)!.issue.id
  const revised = reviewFixtureDocuments()
  revised[1]!.content = documents[1]!.content
  const candidate = buildRevisionInitialCandidate({ sourceResult: source, sourceBinding: binding(source), requestId: 'partial',
    candidateDocuments: revised, unresolvedIssues: [{ issueId: deferred, reason: 'needs clarification' }] })
  const captured = parseRevisionCandidateResult(candidate, binding(candidate))
  expect(captured.repairClaims).toHaveLength(1)
  expect(captured.unresolvedIssues).toEqual([{ issueId: deferred, reason: 'needs clarification' }])
  expect(captured.documents[1]!.content).toBe(documents[1]!.content)
  expect(prepareReviewerFirstCandidate({ sourceResult: source, sourceBinding: binding(source),
    candidateResult: captured, candidateBinding: binding(captured) }).unresolvedIssues.map(issue => issue.id)).toEqual([deferred])
})

test('builds a section candidate compatible with the Reviewer candidate oracle', () => {
  const source = sourceWithSemanticIssue()
  const candidate = buildRevisionInitialCandidate(candidateInput(source))
  const candidateResult = mutableCandidate(candidate)
  expect(parseRevisionCandidateResult(candidateResult, binding(candidateResult))).toEqual(candidateResult)
  const prepared = prepareReviewerFirstCandidate({ sourceResult: source, sourceBinding: binding(source), candidateResult, candidateBinding: binding(candidateResult) })
  expect(prepared.candidate).toEqual(candidateResult)
  expect(prepared.operations).toEqual([...candidateResult.changes])
  expect(candidate.repairClaims).toEqual(source.issues.map(entry => ({ issueId: entry.issue.id, status: 'APPLIED' as const })))
  expect(candidate.unresolvedIssues).toEqual([])
  expect(candidate).not.toHaveProperty('previous')
  expect(candidate.round).toBe(1)
  expect(Object.isFrozen(candidate)).toBe(true)
  expect(Object.isFrozen(candidate.documents)).toBe(true)
})

test('builds a document candidate through the complete-document helper and Reviewer oracle', () => {
  const source = sourceWithFormatIssue()
  const candidateDocuments = reviewFixtureDocuments()
  const candidate = buildRevisionInitialCandidate(candidateInput(source, candidateDocuments))
  const candidateResult = mutableCandidate(candidate)
  expect(parseRevisionCandidateResult(candidateResult, binding(candidateResult))).toEqual(candidateResult)
  const prepared = prepareReviewerFirstCandidate({ sourceResult: source, sourceBinding: binding(source), candidateResult, candidateBinding: binding(candidateResult) })
  expect(prepared.candidate).toEqual(candidateResult)
  expect(prepared.operations).toEqual([...candidateResult.changes])
  expect(candidate.changes[0]).toMatchObject({ scope: 'document', kind: 'REPLACE', documentPath: 'docs/GDD.md' })
})

test('rejects unauthorized changes, no progress, and deferred document repairs', () => {
  const source = sourceWithSemanticIssue()
  const unchanged = source.documents.map(({ path, content }) => ({ path, content }))
  expect(() => buildRevisionInitialCandidate(candidateInput(source, unchanged))).toThrow(/no (?:repair|section) progress/i)
  const unauthorized = changedSemanticDocuments()
  unauthorized[1]!.content += '\nunauthorized'
  expect(() => buildRevisionInitialCandidate(candidateInput(source, unauthorized))).toThrow(/unauthorized/i)

  const format = sourceWithFormatIssue()
  const formatInput = candidateInput(format, reviewFixtureDocuments())
  expect(() => buildRevisionInitialCandidate(formatInput)).not.toThrow()
  expect(() => buildRevisionInitialCandidate({ ...formatInput, candidateDocuments: format.documents.map(({ path, content }) => ({ path, content })), unresolvedIssues: [{ issueId: format.issues[0]!.issue.id, reason: 'defer' }] })).toThrow(/no (?:repair|section) progress/i)
})

test('rejects duplicate or foreign unresolved issues and bad source bindings', () => {
  const source = sourceWithSemanticIssue()
  const base = candidateInput(source)
  const issueId = source.issues[0]!.issue.id
  expect(() => buildRevisionInitialCandidate({ ...base, unresolvedIssues: [{ issueId, reason: 'later' }, { issueId, reason: 'again' }] })).toThrow(/duplicate|outside/i)
  expect(() => buildRevisionInitialCandidate({ ...base, unresolvedIssues: [{ issueId: 'foreign', reason: 'later' }] })).toThrow(/duplicate|outside/i)
  expect(() => buildRevisionInitialCandidate({ ...base, sourceBinding: { ...base.sourceBinding, ownerId: 'foreign' } })).toThrow(/binding/i)
})

test('copies strict inputs, rejects extras, and generates distinct random candidate IDs', () => {
  const source = sourceWithSemanticIssue()
  const documents = changedSemanticDocuments()
  const first = buildRevisionInitialCandidate(candidateInput(source, documents))
  documents[0]!.content = 'caller mutation'
  expect(first.documents[0]!.content).not.toBe('caller mutation')
  const second = buildRevisionInitialCandidate(candidateInput(source, changedSemanticDocuments()))
  expect(second.candidateId).not.toBe(first.candidateId)
  expect(first.resultId).not.toBe(second.resultId)
  expect(() => buildRevisionInitialCandidate({ ...candidateInput(source), candidateId: 'injected' } as never)).toThrow(/shape/i)
  expect(() => buildRevisionInitialCandidate({ ...candidateInput(source), unresolvedIssues: [{ issueId: source.issues[0]!.issue.id, reason: '' }] })).toThrow(/invalid/i)
  const snapshot = bindRevisionDocuments(changedSemanticDocuments())
  expect(first.documentSetDigest).toBe(snapshot.documentSetDigest)
})

test('initial candidate input rejects accessors and hidden state without evaluating them', () => {
  const source = sourceWithFormatIssue()
  const input = candidateInput(source, reviewFixtureDocuments())
  let called = false
  Object.defineProperty(input, 'sourceResult', { enumerable: true, get() { called = true; return source } })
  expect(() => buildRevisionInitialCandidate(input)).toThrow()
  expect(called).toBe(false)
  const hidden = candidateInput(source, reviewFixtureDocuments())
  Object.defineProperty(hidden, 'workerState', { enumerable: false, value: {} })
  expect(() => buildRevisionInitialCandidate(hidden)).toThrow()
})
