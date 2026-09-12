import { expect, test } from 'bun:test'
import { foundationReviewerInputDigest, type ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { buildSingleReviewResult } from '../stage-modules/foundation-reviewer/private/single-agent-publication'
import fixtures from '../stage-modules/foundation-revision/private/tests/fixtures/public-initial-inputs.json'
import { foundationPublicDigest } from './foundation-public-handoff'
import {
  FOUNDATION_ACCEPTANCE_POLICY_VERSION,
  evaluateFoundationAcceptance,
  assertFoundationAcceptanceDecision,
  type FoundationRiskDecision,
} from './foundation-acceptance-policy'

function fixture(severities: Array<'LOW' | 'MEDIUM' | 'HIGH'> = ['HIGH']) {
  const base = fixtures.infrastructure.start.input.sourceResult as unknown as ReviewerReviewResult
  const input = { subject: base.subject, requirements: base.requirements,
    documents: base.documents.map(({ path, content }) => ({ path, content })) }
  const identity = { ownerId: base.ownerId, projectId: base.projectId }
  const review = buildSingleReviewResult({ protocolVersion: 1, ...identity, requestId: 'independent-audit', input,
    inputDigest: foundationReviewerInputDigest({ ...identity, input }) }, {
    status: 'completed', summary: 'Independent policy audit',
    findings: severities.map((severity, index) => ({ severity, documentPath: 'docs/GDD.md' as const,
      title: `Finding ${index}`, actual: `Observed ${index}`, expected: `Expected ${index}` })),
  })
  return { ...identity, review, policyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION,
    automaticRepairLimit: 2, completedRepairCount: 0 }
}

function resign(review: ReviewerReviewResult) {
  const { resultId: _, ...body } = review
  review.resultId = foundationPublicDigest(body)
}

function waiver(f: ReturnType<typeof fixture>, index = 0): FoundationRiskDecision {
  return { decisionId: `decision-${index}`, findingId: f.review.issues[index]!.issue.id, action: 'accept_risk',
    actorId: f.ownerId, reason: 'Explicit risk acceptance for this exact report', recordedAt: '2026-09-12T02:00:00.000Z',
    reviewResultId: f.review.resultId, reviewResultDigest: foundationPublicDigest(f.review),
    documentSetDigest: f.review.documentSetDigest, policyVersion: FOUNDATION_ACCEPTANCE_POLICY_VERSION }
}

test('independent audit: accepted-with-advisories preserves the full original report', () => {
  const f = fixture(['LOW', 'LOW'])
  const before = structuredClone(f.review)
  const decision = evaluateFoundationAcceptance(f)
  expect(decision.disposition).toBe('accepted_with_advisories')
  expect(decision.advisoryFindingIds).toHaveLength(2)
  expect(decision.blockingFindingIds).toEqual([])
  expect(f.review).toEqual(before)
  expect(f.review.kind).toBe('issues_found')
})

test('independent audit: every finding belongs to exactly one partition, including waived LOW', () => {
  const f = fixture(['LOW', 'MEDIUM', 'HIGH'])
  const riskDecisions = [waiver(f, 0), waiver(f, 1)]
  const decision = evaluateFoundationAcceptance({ ...f, riskDecisions })
  const partition = [...decision.advisoryFindingIds, ...decision.blockingFindingIds, ...decision.waivedFindingIds]
  expect(partition).toHaveLength(f.review.issues.length)
  expect(new Set(partition).size).toBe(partition.length)
  expect([...partition].sort()).toEqual(f.review.issues.map(entry => entry.issue.id).sort())
  expect(decision.disposition).toBe('repair_required')
})

test('independent audit: a decision cannot authorize its own invented waiver', () => {
  const f = fixture()
  const authorized = [waiver(f)]
  const decision = evaluateFoundationAcceptance({ ...f, riskDecisions: authorized })
  expect(decision.disposition).toBe('accepted_with_advisories')
  expect(() => assertFoundationAcceptanceDecision({ ...f, decision } as any)).toThrow()
  expect(() => assertFoundationAcceptanceDecision({ ...f, decision, riskDecisions: [] })).toThrow()
  expect(assertFoundationAcceptanceDecision({ ...f, decision, riskDecisions: authorized })).toEqual(decision)
})

for (const mutation of ['unsupported-kind', 'passed-with-issues', 'issues-without-findings', 'missing-severity', 'unknown-severity', 'array-severity', 'empty-finding-id', 'duplicate-finding'] as const) {
  test(`independent audit: malformed but rehashed report is rejected (${mutation})`, () => {
    const f = fixture()
    const r = f.review as any
    if (mutation === 'unsupported-kind') r.kind = 'blocked'
    if (mutation === 'passed-with-issues') r.kind = 'passed'
    if (mutation === 'issues-without-findings') r.issues = []
    if (mutation === 'missing-severity') delete r.issues[0].issue.severity
    if (mutation === 'unknown-severity') r.issues[0].issue.severity = 'INFO'
    if (mutation === 'array-severity') r.issues[0].issue.severity = ['LOW']
    if (mutation === 'empty-finding-id') r.issues[0].issue.id = '   '
    if (mutation === 'duplicate-finding') r.issues.push(structuredClone(r.issues[0]))
    resign(f.review)
    expect(() => evaluateFoundationAcceptance(f)).toThrow()
  })
}

test('independent audit: unknown severity cannot be laundered by accepting its risk', () => {
  const f = fixture()
  ;(f.review.issues[0]!.issue as any).severity = 'INFO'
  resign(f.review)
  expect(() => evaluateFoundationAcceptance({ ...f, riskDecisions: [waiver(f)] })).toThrow()
})

for (const field of ['actorId', 'reason', 'recordedAt', 'decisionId'] as const) {
  test(`independent audit: waiver must retain valid ${field}`, () => {
    const f = fixture()
    const risk = waiver(f)
    risk[field] = ''
    expect(() => evaluateFoundationAcceptance({ ...f, riskDecisions: [risk] })).toThrow()
  })
}

test('independent audit: waiver cannot cross a report, document version, or identity', () => {
  for (const field of ['reviewResultId', 'reviewResultDigest', 'documentSetDigest', 'policyVersion'] as const) {
    const f = fixture()
    const risk = waiver(f)
    ;(risk as any)[field] = 'f'.repeat(64)
    expect(() => evaluateFoundationAcceptance({ ...f, riskDecisions: [risk] })).toThrow()
  }
  const f = fixture()
  expect(() => evaluateFoundationAcceptance({ ...f, ownerId: 'another-owner' })).toThrow()
  expect(() => evaluateFoundationAcceptance({ ...f, projectId: 'another-project' })).toThrow()
})

test('independent audit: duplicate authorization IDs cannot stand for separate decisions', () => {
  const f = fixture(['HIGH', 'HIGH'])
  const risks = [waiver(f, 0), waiver(f, 1)]
  risks[1]!.decisionId = risks[0]!.decisionId
  expect(() => evaluateFoundationAcceptance({ ...f, riskDecisions: risks })).toThrow()
})

test('independent audit: budget cannot change the classification or force premature acceptance', () => {
  const high = fixture()
  expect(evaluateFoundationAcceptance({ ...high, completedRepairCount: 2 }).disposition).toBe('needs_action')
  const low = fixture(['LOW'])
  expect(evaluateFoundationAcceptance({ ...low, completedRepairCount: 2 }).disposition).toBe('accepted_with_advisories')
  const decision = evaluateFoundationAcceptance(high)
  decision.disposition = 'accepted'
  decision.blockingFindingIds = []
  expect(() => assertFoundationAcceptanceDecision({ ...high, decision, riskDecisions: [] })).toThrow()
})
