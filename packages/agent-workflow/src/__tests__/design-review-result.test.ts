import { expect, test } from 'bun:test'
import { designReviewResultIssues, validateDesignReviewReceipt, requiredDesignFindings, requiredDesignUserDecisions, type DesignFinding, type DesignReviewReceiptContext } from '../design-review-result'

const finding: DesignFinding = { id: 'rule', severity: 'blocker', action: 'correct', owner: 'GDD.md',
  documents: ['GDD.md'], sources: [{ document: 'GDD.md', section: 'Design' }], impact: 'Consumer must guess a rule',
  closeWhen: 'One consistent source-backed rule', neededBefore: 'TECHNICAL_DESIGN.md' }
const context: DesignReviewReceiptContext = { step: 'inspect', findings: [], sourceHeadings: { 'GDD.md': ['Design'] } }
const encode = (value: unknown, status = 'complete') => status + '\n' + JSON.stringify(value)

test('combined review retains later required deadlines instead of forcing defects to optional', () => {
  const assigned = { ...context, step: 'revise' as const, combined: true }
  const optional = { ...finding, severity: 'follow-up' as const, neededBefore: null }
  expect(designReviewResultIssues({ step: 'revise', findings: [optional], resolved: [] }, assigned)).toEqual([])
  const due = { ...optional, neededBefore: 'content' as const }
  expect(designReviewResultIssues({ step: 'revise', findings: [due], resolved: [] }, assigned)).toEqual([])
  expect(designReviewResultIssues({ step: 'revise', findings: [due], resolved: [] }, { ...assigned, combined: undefined })).toEqual([])
  expect(designReviewResultIssues({ step: 'revise', findings: [due], resolved: [] }, { ...assigned, findings: [due] })).toEqual([])
  expect(designReviewResultIssues({ step: 'revise', findings: [finding], resolved: [] }, assigned)).toEqual([])
  expect(requiredDesignFindings([optional, finding])).toEqual([finding])
  expect(requiredDesignFindings([optional, due], ['resources'])).toEqual([])
  expect(requiredDesignFindings([optional, due], ['content'])).toEqual([due])
  expect(requiredDesignFindings([optional, due], ['implementation'])).toEqual([due])
  const verify = { ...assigned, step: 'verify' as const, findings: [due] }
  expect(designReviewResultIssues({ step: 'verify', findings: [due], resolved: [] }, verify)).toEqual([])
  expect(designReviewResultIssues({ step: 'verify', findings: [{ ...due, neededBefore: null }], resolved: [] }, verify).join(' '))
    .toContain('cannot be redefined')
})

test('false finding dismissal is explicit, source-backed and never self-certified by Revision', () => {
  const assigned = { ...context, step: 'verify' as const, findings: [finding] }
  const result = { step: 'verify' as const, findings: [], resolved: [
    { id: finding.id, disposition: 'not-applicable' as const, evidence: 'GDD.md / Design already provides the confirmed required action; the proposal was optional.' },
  ] }
  expect(designReviewResultIssues(result, assigned)).toEqual([])
  expect(designReviewResultIssues({ ...result, resolved: [{ ...result.resolved[0]!, evidence: 'Looks fine' }] }, assigned).join(' ')).toContain('actual source')
  expect(designReviewResultIssues({ ...result, step: 'revise' }, { ...assigned, step: 'revise' }).join(' ')).toContain('cannot certify')
  const provenance = { ...finding, id: 'bgs-change-provenance-fixture' }
  expect(designReviewResultIssues({ ...result, resolved: [{ ...result.resolved[0]!, id: provenance.id }] },
    { ...assigned, findings: [provenance] }).join(' ')).toContain('actual user authorization')
})

test('execution obstacle is separate from findings, compatible with older receipts and not closure', () => {
  const result = { step: 'inspect', findings: [], resolved: [] }
  expect(validateDesignReviewReceipt(encode({ ...result, blockedReason: 'Checker process could not start.' }, 'blocked'), context)).toEqual([])
  expect(validateDesignReviewReceipt(encode(result, 'blocked'), context)).toEqual([])
  expect(validateDesignReviewReceipt(encode({ ...result, blockedReason: '' }, 'blocked'), context).length).toBeGreaterThan(0)
  const verify = { ...context, step: 'verify' as const, findings: [finding] }
  expect(validateDesignReviewReceipt(encode({ ...result, step: 'verify', blockedReason: 'Checker failed.' }, 'blocked'), verify).join(' '))
    .toContain('omitted without closure evidence')
})

test('affected verification needs an explicit downstream route at the receipt boundary, not a later paid review', () => {
  const assigned = { ...context, step: 'verify' as const, findings: [finding], affectedChange: true, nextConsumers: ['content'] }
  const result = { step: 'verify', findings: [], resolved: [{ id: finding.id, evidence: 'Read the corrected rule and the affected content mapping' }] }
  expect(validateDesignReviewReceipt(encode(result), assigned).join(' ')).toContain('resumeFrom')
  for (const resumeFrom of ['resources', 'content', 'implementation', 'acceptance'])
    expect(validateDesignReviewReceipt(encode({ ...result, resumeFrom }), assigned)).toEqual([])
  expect(validateDesignReviewReceipt(encode(result, 'blocked'), assigned)).toEqual([])
  expect(validateDesignReviewReceipt(encode(result), { ...assigned, affectedChange: false })).toEqual([])
  expect(validateDesignReviewReceipt(encode({ step: 'verify', findings: [finding], resolved: [] }), assigned)).toEqual([])
  expect(validateDesignReviewReceipt(encode({ step: 'revise', findings: [finding], resolved: [] }), { ...assigned, step: 'revise' })).toEqual([])
})

test('changed sources without findings need impact reasoning, but unchanged Inspect does not', () => {
  const assigned = { ...context, step: 'verify' as const, affectedChange: true }
  const result = { step: 'verify', findings: [], resolved: [], resumeFrom: 'content' }
  expect(validateDesignReviewReceipt(encode(result), assigned).join(' ')).toContain('resumeReason')
  expect(validateDesignReviewReceipt(encode({ ...result, resumeReason: 'Saved source changes invalidate content bindings, not existing assets.' }), assigned)).toEqual([])
  expect(validateDesignReviewReceipt(encode({ ...result, resumeReason: ' ' }), assigned).length).toBeGreaterThan(0)
  expect(validateDesignReviewReceipt(encode({ ...result, resumeFrom: 'author' }), assigned).length).toBeGreaterThan(0)
  expect(validateDesignReviewReceipt(encode({ step: 'inspect', findings: [], resolved: [] }), { ...context, affectedChange: true })).toEqual([])
  const later = { ...finding, severity: 'follow-up' as const, neededBefore: 'acceptance' as const }
  expect(validateDesignReviewReceipt(encode({ step: 'verify', findings: [later], resolved: [] }),
    { ...assigned, findings: [later], nextConsumers: ['content'] }).join(' ')).toContain('resumeFrom')
})

test('required scope uses deadlines without rewriting severity or optional follow-ups', () => {
  const findings: DesignFinding[] = ([null, 'resources', 'content', 'implementation', 'acceptance', 'UI_UX_SPEC.md'] as const)
    .map((neededBefore, i) => ({ ...finding, id: String(i), severity: 'follow-up', neededBefore }))
  expect(requiredDesignFindings(findings).map(f => f.id)).toEqual(['1', '5'])
  expect(requiredDesignFindings(findings.map(f => ({ ...f, action: 'evidence' as const }))).map(f => f.id)).toEqual(['1', '5'])
  expect(requiredDesignFindings(findings, ['implementation']).map(f => f.id)).toEqual(['1', '2', '3', '5'])
  expect(requiredDesignFindings(findings, ['acceptance']).map(f => f.id)).toEqual(['1', '2', '3', '4', '5'])
  expect(requiredDesignFindings([finding], ['resources'])).toEqual([finding])
  expect(requiredDesignFindings(findings)[0]).toBe(findings[1])
  expect(findings.every(f => f.severity === 'follow-up')).toBe(true)
  expect(requiredDesignUserDecisions(findings.map(f => ({ ...f, owner: 'user' })), ['content']).map(f => f.id))
    .toEqual(['1', '2', '5'])
})

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

test.each(['revise', 'verify'] as const)('%s receipt preserves the same fields regardless of recorded JSON key order', step => {
  const recorded: DesignFinding = { ...Object.fromEntries(Object.entries(finding).reverse()) as DesignFinding,
    sources: finding.sources.map(source => ({ section: source.section, document: source.document })) }
  const assigned = { ...context, step, findings: [recorded] }
  expect(validateDesignReviewReceipt(encode({ step, findings: [finding], resolved: [] }), assigned)).toEqual([])
  expect(validateDesignReviewReceipt(encode({ step, findings: [{ ...finding, neededBefore: 'acceptance' }], resolved: [] }), assigned).length)
    .toBeGreaterThan(0)
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
