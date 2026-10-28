import { expect, test } from 'bun:test'
import { assertDesignReviewReady, parseDesignReview, type DesignReviewDisposition, type DesignReviewReceipt } from './design-review'
import { parseProductionResult } from './production-workflow'

const finding = { location: 'GDD Rules', issue: 'Conflicting transition', evidence: 'One event has two incompatible outcomes.', impact: 'The agreed behavior is ambiguous.' }
const disposition: DesignReviewDisposition = { finding: 1, status: 'rejected', evidence: 'Rules restricts this transition to idle; the reported counterexample assumes active.' }
const source = { path: 'docs/GDD.md', sha256: 'unchanged-candidate' }
function receipt(report: DesignReviewReceipt['report']): DesignReviewReceipt {
  return { source, nativeThreadId: 'reviewer', nativeTurnId: 'review-turn',
    startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', report }
}

test('a finding cannot be downgraded to advisory or bypass handoff in an otherwise valid report', () => {
  expect(() => parseDesignReview(JSON.stringify({ summary: 'Optional', findings: [{ ...finding, severity: 'advisory' }] }))).toThrow('invalid report')
  const review = receipt(parseDesignReview(JSON.stringify({ summary: 'A real conflict', findings: [finding] })))
  expect(() => assertDesignReviewReady(source, [review])).toThrow('unresolved review findings')
})

test('follow-up requires exact coverage, not disappearance of earlier findings', () => {
  for (const resolutions of [undefined, [], [disposition, disposition], [{ ...disposition, finding: 2 }]]) {
    expect(() => parseDesignReview(JSON.stringify({ summary: 'All fixed', findings: [], resolutions }), 1)).toThrow('exactly one evidence-backed disposition')
  }
  expect(() => parseDesignReview(JSON.stringify({ summary: 'Fixed', findings: [], resolutions: [{ ...disposition, evidence: ' ' }] }), 1)).toThrow('invalid report')
})

test('an evidence-backed rejection can hand off without unnecessary document changes', () => {
  const initial = receipt({ summary: 'Reported conflict', findings: [finding] })
  const final = receipt(parseDesignReview(JSON.stringify({ summary: 'Original finding disproven', findings: [], resolutions: [disposition] }), 1))
  final.authorResponses = [disposition]
  expect(() => assertDesignReviewReady(source, [initial, final])).not.toThrow()
  delete final.authorResponses
  expect(() => assertDesignReviewReady(source, [initial, final])).toThrow('exactly one evidence-backed disposition')
})

test('resolved originals do not excuse a new defect, unresolved response or changed source', () => {
  const initial = receipt({ summary: 'Reported conflict', findings: [finding] })
  for (const status of ['author-unresolved', 'reviewer-unresolved', 'new-defect'] as const) {
    const final = receipt({ summary: 'Follow-up', findings: status === 'new-defect' ? [finding] : [],
      resolutions: [{ ...disposition, status: status === 'reviewer-unresolved' ? 'unresolved' : 'corrected' }] })
    final.authorResponses = [{ ...disposition, status: status === 'author-unresolved' ? 'unresolved' : 'corrected' }]
    expect(() => assertDesignReviewReady(source, [initial, final])).toThrow('unresolved review findings')
  }
  expect(() => assertDesignReviewReady({ ...source, sha256: 'changed' }, [receipt({ summary: 'Checked', findings: [] })])).toThrow('changed after')
})

test('author responses extend the small final result, never replace the saved draft with a returned body', () => {
  const task = { stage: 'design' as const, originRequestKey: 'synthetic' }
  const value = { status: 'ready', summary: 'Rejected the unsupported finding', reviewResponses: [disposition] }
  expect(parseProductionResult(task, value)).toMatchObject({ action: 'advance', reviewResponses: [disposition] })
  for (const invalid of [{ ...value, document: '# Replacement' },
    { ...value, reviewResponses: [{ ...disposition, finding: 0 }] },
    { ...value, reviewResponses: [{ ...disposition, evidence: '' }] }])
    expect(() => parseProductionResult(task, invalid)).toThrow('missing or invalid')
})
