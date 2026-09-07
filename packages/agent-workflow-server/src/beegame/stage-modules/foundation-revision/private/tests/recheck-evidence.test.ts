import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { validateReviewerTargetedEvidence, reviewerFullFormatPolicyDigest, reviewerTargetedPolicyDigest, reviewerRecheckEvidenceSchema } from '../../../foundation-reviewer/private/recheck-contract'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'
import { revisionFullFormatPolicyDigest, revisionTargetedPolicyDigest, validateRevisionRecheckEvidence, type RevisionRecheckEvidence, type RevisionTargetedRecheckEvidence } from '../recheck-evidence'

const documents = reviewFixtureDocuments()
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const documentDigests = documents.map(document => ({ path: document.path, digest: digest(document.content) }))
const sectionIndex = buildFoundationSectionIndex({ documents: new Map(documents.map(document => [document.path, document.content])) })
const section = sectionIndex.find(ref => ref.documentPath === 'docs/GDD.md' && ref.sectionId === 'player_actions')!
const issues = [{ issue: { id: 'issue-1' } }, { issue: { id: 'issue-2' } }]

function targeted(overrides: Record<string, unknown> = {}): RevisionTargetedRecheckEvidence {
  return {
    kind: 'targeted', round: 1, candidateResultDigest: 'a'.repeat(64), policyDigest: revisionTargetedPolicyDigest(), decision: 'round_complete',
    issueVerdicts: [{ issueId: 'issue-1', kind: 'semantic', status: 'PASS' }, { issueId: 'issue-2', kind: 'deterministic', status: 'PASS' }],
    documentVerdicts: [{ documentPath: section.documentPath, documentDigest: documentDigests.find(item => item.path === section.documentPath)!.digest, issueIds: ['issue-1', 'issue-2'], retryIssueIds: [], status: 'PASS' }],
    ...overrides,
  } as RevisionTargetedRecheckEvidence
}

function outcome(run: () => unknown): boolean {
  try { run(); return true } catch { return false }
}

test('full-format and targeted public evidence match Reviewer policy encodings', () => {
  expect(revisionFullFormatPolicyDigest()).toBe(reviewerFullFormatPolicyDigest())
  expect(revisionTargetedPolicyDigest()).toBe(reviewerTargetedPolicyDigest())
  const full: RevisionRecheckEvidence = { kind: 'full_format', round: 1, candidateResultDigest: 'b'.repeat(64), policyDigest: revisionFullFormatPolicyDigest(), nextRound: 1 }
  expect(validateRevisionRecheckEvidence(full, documentDigests, issues, sectionIndex)).toEqual(full)
  expect(validateRevisionRecheckEvidence(targeted(), documentDigests, [], sectionIndex)).toEqual(targeted())
  const newIssues = [{ issue: { id: 'new-next-round-issue' } }]
  expect(validateRevisionRecheckEvidence(targeted(), documentDigests, newIssues, sectionIndex)).toEqual(targeted())
  expect(() => validateReviewerTargetedEvidence(targeted(), documentDigests, newIssues, sectionIndex)).not.toThrow()
})

test('targeted failure, deferred semantic and diagnostic evidence are accepted only when coherent', () => {
  const diagnostic = { unmetExpected: 'expected', observedActual: 'actual', evidence: [section], dependencySections: [section], failureReasonCode: 'expected_not_met' as const, scopeAssessment: 'repairable_in_scope' as const }
  const value = targeted({ decision: 'retry_same_round', issueVerdicts: [
    { issueId: 'issue-1', kind: 'deterministic', status: 'FAIL' },
    { issueId: 'issue-2', kind: 'semantic', status: 'NOT_CHECKED' },
  ], documentVerdicts: [{ documentPath: section.documentPath, documentDigest: documentDigests.find(item => item.path === section.documentPath)!.digest, issueIds: ['issue-1', 'issue-2'], retryIssueIds: ['issue-1'], status: 'FAIL' }] })
  expect(validateRevisionRecheckEvidence(value, documentDigests, issues, sectionIndex)).toEqual(value)
  const semanticFailure = targeted({ decision: 'retry_same_round', issueVerdicts: [{ issueId: 'issue-1', kind: 'semantic', status: 'FAIL', diagnostic }, { issueId: 'issue-2', kind: 'semantic', status: 'PASS' }], documentVerdicts: [{ documentPath: section.documentPath, documentDigest: documentDigests.find(item => item.path === section.documentPath)!.digest, issueIds: ['issue-1', 'issue-2'], retryIssueIds: ['issue-1'], status: 'FAIL' }] })
  expect(validateRevisionRecheckEvidence(semanticFailure, documentDigests, [{ issue: { id: 'issue-1' } }], sectionIndex)).toEqual(semanticFailure)
})

test('wrong policy, coverage, status, digest, diagnostic and decision fail like Reviewer', () => {
  const valid = targeted()
  expect(() => validateRevisionRecheckEvidence(valid, documentDigests, [{ issue: { id: 'issue-1' } }], sectionIndex)).toThrow(/remaining issue authority/)
  const cases: RevisionRecheckEvidence[] = [
    targeted({ policyDigest: 'c'.repeat(64) }),
    targeted({ issueVerdicts: [{ issueId: 'issue-1', kind: 'semantic', status: 'PASS' }], documentVerdicts: [{ ...valid.documentVerdicts[0], issueIds: ['issue-1', 'issue-1'] }] }),
    targeted({ documentVerdicts: [{ ...valid.documentVerdicts[0], status: 'DEFERRED' }] }),
    targeted({ documentVerdicts: [{ ...valid.documentVerdicts[0], documentDigest: 'd'.repeat(64) }] }),
    targeted({ documentVerdicts: [{ ...valid.documentVerdicts[0], retryIssueIds: ['issue-1'] }] }),
    targeted({ decision: 'retry_same_round' }),
    targeted({ issueVerdicts: [{ issueId: 'issue-1', kind: 'semantic', status: 'NOT_CHECKED' }, { issueId: 'issue-2', kind: 'deterministic', status: 'PASS' }] }),
    targeted({ issueVerdicts: [{ issueId: 'issue-1', kind: 'semantic', status: 'FAIL', diagnostic: { unmetExpected: 'e', observedActual: 'a', evidence: [{ ...section, digest: 'e'.repeat(64) }], dependencySections: [section], failureReasonCode: 'expected_not_met', scopeAssessment: 'repairable_in_scope' } }, { issueId: 'issue-2', kind: 'semantic', status: 'PASS' }], documentVerdicts: [{ ...valid.documentVerdicts[0], issueIds: ['issue-1', 'issue-2'], retryIssueIds: ['issue-1'], status: 'FAIL' }], decision: 'retry_same_round' }),
  ]
  for (const value of cases) {
    const remaining = value.kind === 'targeted' ? value.issueVerdicts.filter(item => item.status !== 'PASS').map(item => ({ issue: { id: item.issueId } })) : []
    expect(outcome(() => validateRevisionRecheckEvidence(value, documentDigests, remaining, sectionIndex))).toBe(false)
    expect(outcome(() => validateReviewerTargetedEvidence(reviewerRecheckEvidenceSchema.parse(value) as never, documentDigests, remaining, sectionIndex))).toBe(false)
  }
  const full = { kind: 'full_format', round: 1, candidateResultDigest: 'b'.repeat(64), policyDigest: 'e'.repeat(64), nextRound: 1 }
  expect(outcome(() => validateRevisionRecheckEvidence(full, documentDigests, issues, sectionIndex))).toBe(false)
})
