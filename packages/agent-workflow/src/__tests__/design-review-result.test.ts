import { expect, test } from 'bun:test'
import { designReviewResultSchema, type DesignFinding } from '../design-review-result'

const finding: DesignFinding = { id: 'rule', severity: 'blocker', action: 'correct', owner: 'GDD.md',
  documents: ['GDD.md'], sources: [{ document: 'GDD.md', section: 'Design' }], impact: 'Consumer must guess a rule',
  closeWhen: 'One consistent source-backed rule', neededBefore: 'TECHNICAL_DESIGN.md' }

test('acceptance design issue fields retain valid findings and reject unknown source documents', () => {
  const findings = designReviewResultSchema.shape.findings
  expect(findings.parse([finding])).toEqual([finding])
  const malformed = findings.safeParse([{ ...finding, sources: [{ document: 'context.md', section: 'Design' }] }])
  expect(malformed.success).toBe(false)
  if (!malformed.success)
    expect(malformed.error.issues[0]?.path).toEqual([0, 'sources', 0, 'document'])
})
