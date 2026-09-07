import { expect, test } from 'bun:test'
import { buildReviewerFullFormatResult } from '../../../foundation-reviewer/private/full-format-publication'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { buildReviewerTargetedResult } from '../../../foundation-reviewer/private/targeted-publication'
import { prepareReviewerFirstCandidate } from '../../../foundation-reviewer/private/candidate-handoff'
import { candidateFixtureFromReview, firstCandidateFixture } from '../../../foundation-reviewer/private/test-fixtures/candidate-fixture'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { validateReviewerTargetedFacts } from '../../../foundation-reviewer/private/targeted-preparation'
import { buildRevisionInitialCandidate } from '../initial-candidate'
import { parseRevisionCandidateResult, type RevisionCandidateResult } from '../candidate-result'
import { parseRevisionRepairSource, prepareRevisionRetryAuthority, revisionRepairRound, verifyRevisionCandidateAuthority } from '../candidate-authority'
import { parseRevisionRecheckSource } from '../recheck-source'
import { revisionDigest } from '../json-digest'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'

const binding = (value: { ownerId: string; projectId: string; resultId: string }) => ({
  ownerId: value.ownerId, projectId: value.projectId, resultId: value.resultId, resultDigest: revisionDigest(value),
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function rehash<T extends { resultId: string }>(value: T): T {
  const copied = clone(value)
  const { resultId: _ignored, ...body } = copied
  return { ...body, resultId: revisionDigest(body) } as T
}

function twoIssueFixture() {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4' ? {
    status: 'completed', outcome: 'ISSUES', issues: [
      { problem: 'feedback', expected: 'readable feedback', actual: 'missing', sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [],
        remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } },
      { problem: 'navigation feedback', expected: 'navigation feedback', actual: 'missing', sourceSectionKey: 'UI#input', supportingSectionKeys: [],
        remediation: { kind: 'patch', sectionKeys: ['UI#input'] } },
    ],
  } : { status: 'completed', outcome: 'PASS' } })
  const source = buildReviewerPublishedResult({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }, ...review })
  const documents = source.documents.map(document => ({ path: document.path, content: document.path === 'docs/GDD.md'
    ? document.content.replace('game.mechanics:', 'Readable feedback added.\n\ngame.mechanics:')
    : document.path === 'docs/UI_UX_SPEC.md' ? document.content.replace('ui.supported_actions:', 'Navigation note added.\n\nui.supported_actions:')
      : document.content }))
  const candidate = buildRevisionInitialCandidate({ sourceResult: source, sourceBinding: binding(source), requestId: 'repair',
    candidateDocuments: documents, unresolvedIssues: [] })
  const candidateParsed = parseRevisionCandidateResult(clone(candidate), binding(candidate))
  const prepared = prepareReviewerFirstCandidate({ sourceResult: source, sourceBinding: binding(source), candidateResult: candidateParsed,
    candidateBinding: binding(candidateParsed) })
  const validation = validateReviewerTargetedFacts(prepared, [])
  const semantic = validation.semantic.map(({ issue, packet }) => issue.remediation.documentPath === 'docs/GDD.md'
    ? { issueId: issue.id, output: { status: 'PASS' as const } }
    : { issueId: issue.id, output: { status: 'FAIL' as const, diagnostic: {
      observedActual: 'navigation feedback is still missing', failureReasonCode: 'expected_not_met' as const,
      evidence: packet.sections.map(({ ref }) => ({ documentPath: ref.documentPath, sectionId: ref.sectionId, digest: ref.digest })),
    } } })
  const recheckResult = buildReviewerTargetedResult({ requestId: 'recheck', candidate: prepared, facts: [], semantic })
  const recheck = parseRevisionRecheckSource(clone(recheckResult), binding(recheckResult))
  return { source, candidate: candidateParsed, recheck, recheckResult }
}

function fullFormatSource() {
  const malformed = reviewFixtureDocuments(true)
  malformed[0]!.content = '# incomplete\n'
  const repaired = reviewFixtureDocuments(true)
  const first = candidateFixtureFromReview({ documents: malformed, state: initialReviewerFactState(malformed) }, repaired)
  const state = completedReviewFixture({ documents: first.prepared.documents, output: taskId => taskId === 'semantic-4' ? {
    status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback', expected: 'readable feedback', actual: 'missing',
      sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: [], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }],
  } : { status: 'completed', outcome: 'PASS' } }).state
  return buildReviewerFullFormatResult({ requestId: 'full-format', candidate: first.prepared, state })
}

test('repair source admits initial/full-format/round-complete sources and derives safe rounds', () => {
  const fixture = twoIssueFixture()
  const initial = parseRevisionRepairSource(fixture.source, binding(fixture.source))
  expect(revisionRepairRound(initial)).toBe(1)

  const full = fullFormatSource()
  expect(full.kind).toBe('issues_found')
  expect(full.recheck?.kind).toBe('full_format')
  const fullSource = parseRevisionRepairSource(full, binding(full))
  expect(revisionRepairRound(fullSource)).toBe(1)

  const first = firstCandidateFixture()
  const validation = validateReviewerTargetedFacts(first.prepared, [])
  const roundComplete = buildReviewerTargetedResult({ requestId: 'round-complete', candidate: first.prepared, facts: [],
    semantic: validation.semantic.map(({ issue }) => ({ issueId: issue.id, output: { status: 'PASS' as const } })) })
  expect(roundComplete.kind).toBe('issues_found')
  const completedSource = parseRevisionRepairSource(roundComplete, binding(roundComplete))
  if (!('recheck' in completedSource) || completedSource.recheck.kind !== 'targeted') throw new Error('expected targeted recheck')
  expect(completedSource.recheck.decision).toBe('round_complete')
  expect(revisionRepairRound(completedSource)).toBe(completedSource.recheck.round + 1)

  const overflow = rehash({ ...clone(roundComplete), recheck: { ...roundComplete.recheck!, round: Number.MAX_SAFE_INTEGER } })
  expect(() => parseRevisionRepairSource(overflow, binding(overflow))).toThrow(/safe/i)
  expect(() => parseRevisionRepairSource({ ...roundComplete, kind: 'passed' }, binding(roundComplete))).toThrow(/issues/i)
  expect(() => revisionRepairRound(fixture.recheck)).toThrow(/new repair base/i)
})

test('complete candidate source authority is accepted, while rehashed operation and round forgeries are rejected', () => {
  const fixture = twoIssueFixture()
  const source = parseRevisionRepairSource(fixture.source, binding(fixture.source))
  expect(verifyRevisionCandidateAuthority(source, fixture.candidate).repairIssueIds).toHaveLength(2)

  const forged = rehash({ ...clone(fixture.candidate), changes: fixture.candidate.changes.map(change => ({ ...change,
    ...(change.scope === 'section' ? { afterDigest: 'f'.repeat(64) } : { afterDigest: 'f'.repeat(64) }) })) }) as RevisionCandidateResult
  expect(() => verifyRevisionCandidateAuthority(source, parseRevisionCandidateResult(forged, binding(forged)))).toThrow(/declared changes/i)

  const wrongRound = rehash({ ...clone(fixture.candidate), round: 2 }) as RevisionCandidateResult
  expect(() => verifyRevisionCandidateAuthority(source, parseRevisionCandidateResult(wrongRound, binding(wrongRound)))).toThrow(/source authority/i)
})

test('retry authority binds predecessor, recheck subject, and retention to the original source', () => {
  const fixture = twoIssueFixture()
  const sourceBinding = binding(fixture.source)
  const candidateBinding = binding(fixture.candidate)
  const input = { sourceResult: fixture.source, sourceBinding, previousCandidateResult: fixture.candidate,
    previousCandidateBinding: candidateBinding, previousRecheckResult: fixture.recheckResult,
    previousRecheckBinding: binding(fixture.recheckResult) }
  const authority = prepareRevisionRetryAuthority(input)
  expect(authority.round).toBe(1)
  expect(authority.repairIssueIds).toEqual(fixture.source.issues.map(entry => entry.issue.id).sort())
  expect(authority.retainedDocumentPaths).toEqual(['docs/GDD.md'])
  expect(authority.previous).toEqual({ candidateId: fixture.candidate.candidateId, candidateResultId: fixture.candidate.resultId,
    candidateResultDigest: revisionDigest(fixture.candidate), recheckResultId: fixture.recheck.resultId,
    recheckResultDigest: revisionDigest(fixture.recheck) })

  const operationForgery = rehash({ ...clone(fixture.candidate), changes: fixture.candidate.changes.map(change => ({ ...change,
    ...(change.scope === 'section' ? { afterDigest: 'e'.repeat(64) } : { afterDigest: 'e'.repeat(64) }) })) }) as RevisionCandidateResult
  expect(() => prepareRevisionRetryAuthority({ ...input, previousCandidateResult: operationForgery,
    previousCandidateBinding: binding(operationForgery) })).toThrow(/declared changes/i)

  const wrongRecheckBinding = rehash({ ...clone(fixture.recheckResult), requestId: 'independent-recheck' })
  expect(() => prepareRevisionRetryAuthority({ ...input, previousRecheckResult: wrongRecheckBinding })).toThrow(/binding/i)

  const wrongDigest = rehash({ ...clone(fixture.recheckResult), recheck: { ...fixture.recheckResult.recheck!, candidateResultDigest: 'f'.repeat(64) } })
  expect(() => prepareRevisionRetryAuthority({ ...input, previousRecheckResult: wrongDigest,
    previousRecheckBinding: binding(wrongDigest) })).toThrow(/predecessor|subject/i)

  let wrongSubject = rehash({ ...clone(fixture.recheckResult), subject: { ...fixture.recheckResult.subject,
    candidateId: 'other-candidate' } })
  wrongSubject.inputDigest = revisionDigest({ ownerId: wrongSubject.ownerId, projectId: wrongSubject.projectId,
    subject: wrongSubject.subject, documentSetDigest: wrongSubject.documentSetDigest })
  wrongSubject = rehash(wrongSubject)
  expect(() => prepareRevisionRetryAuthority({ ...input, previousRecheckResult: wrongSubject,
    previousRecheckBinding: binding(wrongSubject) })).toThrow(/subject/i)
})

test('retry authority rejects source-inconsistent verdict kinds and document ownership despite self-consistent public evidence', () => {
  const fixture = twoIssueFixture()
  const input = { sourceResult: fixture.source, sourceBinding: binding(fixture.source), previousCandidateResult: fixture.candidate,
    previousCandidateBinding: binding(fixture.candidate), previousRecheckResult: fixture.recheckResult,
    previousRecheckBinding: binding(fixture.recheckResult) }

  const kindMismatch = clone(fixture.recheckResult)
  const semanticPass = kindMismatch.recheck!.issueVerdicts.find(item => item.status === 'PASS')!
  semanticPass.kind = 'deterministic'
  const kindRebound = rehash(kindMismatch)
  expect(() => prepareRevisionRetryAuthority({ ...input, previousRecheckResult: kindRebound,
    previousRecheckBinding: binding(kindRebound) })).toThrow(/issue kind/i)

  const ownershipMismatch = clone(fixture.recheckResult)
  const verdicts = ownershipMismatch.recheck!.documentVerdicts
  const first = verdicts[0]!
  const second = verdicts[1]!
  const firstPath = first.documentPath
  const firstDigest = first.documentDigest
  first.documentPath = second.documentPath
  first.documentDigest = second.documentDigest
  second.documentPath = firstPath
  second.documentDigest = firstDigest
  const ownershipRebound = rehash(ownershipMismatch)
  expect(() => prepareRevisionRetryAuthority({ ...input, previousRecheckResult: ownershipRebound,
    previousRecheckBinding: binding(ownershipRebound) })).toThrow(/document authority/i)
})

test('same-round retry rejects a recheck that introduces a different supporting evidence identity', () => {
  const fixture = twoIssueFixture()
  const input = { sourceResult: fixture.source, sourceBinding: binding(fixture.source), previousCandidateResult: fixture.candidate,
    previousCandidateBinding: binding(fixture.candidate), previousRecheckResult: fixture.recheckResult,
    previousRecheckBinding: binding(fixture.recheckResult) }
  const forged = clone(fixture.recheckResult)
  const index = buildFoundationSectionIndex({ documents: new Map(forged.documents.map(doc => [doc.path, doc.content])) })
  const indexed = index.find(section => section.documentPath === 'docs/GDD.md' && section.sectionId === 'vision')!
  const document = forged.documents.find(doc => doc.path === indexed.documentPath)!
  const support = { documentPath: indexed.documentPath, sectionId: indexed.sectionId, heading: indexed.heading,
    startLine: indexed.startLine, endLine: indexed.endLine, digest: indexed.digest }
  const content = document.content.split('\n').slice(indexed.startLine - 1, indexed.endLine).join('\n')
  const entry = forged.issues.find(item => item.issue.id === fixture.source.issues[0]!.issue.id)!
  ;(entry.issue as Record<string, unknown>).supportingSections = [support]
  entry.sections.push({ path: support.documentPath, sectionId: support.sectionId, content, digest: support.digest })
  forged.issueRegistryDigest = revisionDigest(forged.issues.map(item => item.issue))
  const rebound = rehash(forged)
  expect(() => prepareRevisionRetryAuthority({ ...input, previousRecheckResult: rebound,
    previousRecheckBinding: binding(rebound) })).toThrow(/supporting evidence/i)
})
