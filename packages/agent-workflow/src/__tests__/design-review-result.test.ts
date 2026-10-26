import { expect, test } from 'bun:test'
import { designReviewResultSchema, type DesignFinding } from '../design-review-result'

const finding: DesignFinding = { id: 'rule', severity: 'blocker', action: 'correct', owner: 'GDD.md',
  documents: ['GDD.md'], sources: [{ document: 'GDD.md', section: 'Design' }], impact: 'Consumer must guess a rule',
  closeWhen: 'One consistent source-backed rule', neededBefore: 'implementation' }

test('acceptance design issue fields retain valid findings and reject unknown source documents', () => {
  const findings = designReviewResultSchema.shape.findings
  expect(findings.parse([finding])).toEqual([finding])
  const malformed = findings.safeParse([{ ...finding, sources: [{ document: 'context.md', section: 'Design' }] }])
  expect(malformed.success).toBe(false)
  if (!malformed.success)
    expect(malformed.error.issues[0]?.path).toEqual([0, 'sources', 0, 'document'])
})

test('one GDD can own findings across professional sections without accepting retired document identities', () => {
  const findings = designReviewResultSchema.shape.findings
  const crossSection = { ...finding, sources: [
    { document: 'GDD.md', section: 'Rules' }, { document: 'GDD.md', section: 'Technical interfaces' },
  ] }
  expect(findings.parse([crossSection])).toEqual([crossSection])
  for (const document of ['LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md', 'TECHNICAL_DESIGN.md',
    'ART_DIRECTION.md', 'UI_UX_SPEC.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md']) {
    expect(findings.safeParse([{ ...finding, owner: document }]).success).toBe(false)
    expect(findings.safeParse([{ ...finding, documents: [document] }]).success).toBe(false)
    expect(findings.safeParse([{ ...finding, sources: [{ document, section: 'Design' }] }]).success).toBe(false)
  }
})
