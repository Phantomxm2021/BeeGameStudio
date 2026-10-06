import { expect, test } from 'bun:test'
import { designReviewResultIssues, validateDesignReviewReceipt, type DesignFinding, type DesignReviewReceiptContext } from '../design-review-result'

const finding: DesignFinding = { id: 'rule', severity: 'blocker', action: 'correct', owner: 'GDD.md',
  documents: ['GDD.md'], sources: [{ document: 'GDD.md', section: 'Design' }], impact: 'Consumer must guess a rule',
  closeWhen: 'One consistent source-backed rule', neededBefore: 'TECHNICAL_DESIGN.md' }
const context: DesignReviewReceiptContext = { step: 'inspect', findings: [], sourceHeadings: { 'GDD.md': ['Design'] } }
const encode = (value: unknown, status = 'complete') => status + '\n' + JSON.stringify(value)

test('receipt reports malformed fields without accepting a quality PASS', () => {
  expect(validateDesignReviewReceipt('PASS', context)).toHaveLength(1)
  expect(validateDesignReviewReceipt('complete\n{', context)).toHaveLength(1)
  expect(validateDesignReviewReceipt(encode({ step: 'inspect', findings: [{ ...finding,
    sources: [{ document: 'context.md', section: 'Design' }] }], resolved: [] }), context).join(' ')).toContain('findings.0.sources.0.document')
  expect(validateDesignReviewReceipt(encode({ step: 'inspect', findings: [finding], resolved: [] }), context)).toEqual([])
  expect(validateDesignReviewReceipt(encode({ step: 'inspect', findings: [], resolved: [] }, 'blocked'), context)).toEqual([])
})

test('routine passed checks are not closures; source headings cannot contain commentary', () => {
  const issues = designReviewResultIssues({ step: 'inspect', findings: [{ ...finding,
    sources: [{ document: 'GDD.md', section: 'Design / states' }] }], resolved: [{ id: 'R1', evidence: 'Scope passed' }] }, context)
  expect(issues.join(' ')).toContain('exact Markdown heading')
  expect(issues.join(' ')).toContain('recorded finding ID')
})

test('revision preserves recorded findings; verifier can close a legitimately removed clause', () => {
  const revise = { ...context, step: 'revise' as const, findings: [finding], sourceHeadings: { 'GDD.md': ['Corrected'] } }
  expect(designReviewResultIssues({ step: 'revise', findings: [finding], resolved: [] }, revise)).toEqual([])
  expect(designReviewResultIssues({ step: 'revise', findings: [], resolved: [{ id: finding.id, evidence: 'I fixed it' }] }, revise).length).toBeGreaterThan(0)
  const verify = { ...revise, step: 'verify' as const }
  expect(designReviewResultIssues({ step: 'verify', findings: [], resolved: [{ id: finding.id, evidence: 'Read corrected source and consumer' }] }, verify)).toEqual([])
  expect(designReviewResultIssues({ step: 'verify', findings: [], resolved: [] }, verify).join(' ')).toContain('omitted')
  expect(designReviewResultIssues({ step: 'verify', findings: [{ ...finding, severity: 'follow-up' }], resolved: [] }, verify).join(' ')).toContain('redefined')
})
test('independent verification can report remaining impact without redefining the issue or weakening the gate', () => {
  const verify = { ...context, step: 'verify' as const, findings: [finding] }
  const remaining = { ...finding, impact: 'Prose corrected; retained numerical evidence still uses the previous definition' }
  expect(designReviewResultIssues({ step: 'verify', findings: [remaining], resolved: [] }, verify)).toEqual([])
  for (const change of [{ severity: 'follow-up' as const }, { neededBefore: null }, { closeWhen: 'Any saved edit' },
    { owner: 'user' as const }, { documents: ['ART_DIRECTION.md'] as const }]) {
    expect(designReviewResultIssues({ step: 'verify', findings: [{ ...remaining, ...change, documents: [...(change.documents ?? remaining.documents)] }], resolved: [] }, verify).join(' ')).toContain('redefined')
  }
  expect(designReviewResultIssues({ step: 'revise', findings: [remaining], resolved: [] }, { ...verify, step: 'revise' }).join(' ')).toContain('preserve')
})
