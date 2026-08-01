import { describe, expect, test } from 'bun:test'
import {
  documentReviewFindingSchema,
  documentReviewSubmissionSchemaForMode,
} from './worker-contracts'

const baseFinding = {
  findingId: 'CALC-1',
  checkId: 'technical_feasibility' as const,
  severity: 'blocking' as const,
  owner: 'foundation' as const,
  subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
  observation: 'The documented calculation is inconsistent.',
  blockingReason: 'The implementation cannot derive one result.',
  requiredAction: 'Correct the calculation.',
  closureCondition: 'The documents define one deterministic calculation.',
}

describe('document review finding contract', () => {
  test('preserves the single canonical finding contract', () => {
    const parsed = documentReviewFindingSchema.parse(baseFinding)
    expect(parsed).toEqual(baseFinding)
  })

  test('still rejects non-empty resource subjects on non-resource findings', () => {
    expect(() =>
      documentReviewFindingSchema.parse({
        ...baseFinding,
        subjects: [{
          path: 'docs/GDD.md',
          anchor: 'Rules',
          requirementId: 'RES-1',
        }],
      }),
    ).toThrow('foundation and checklist findings cannot carry resource subjects')
  })

  test('requires a current manifest subject for resource findings', () => {
    expect(() =>
      documentReviewFindingSchema.parse({
        ...baseFinding,
        owner: 'resource',
        subjects: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
      }),
    ).toThrow('resource findings require at least one current manifest subject')
  })

  test('does not expose Closure regression fields in Initial Review', () => {
    const submission = {
      verdict: 'NEEDS_REVISION',
      checks: [{
        id: 'technical_feasibility',
        status: 'block',
        conclusion: 'The delivery contract conflicts.',
        evidence: [{ path: 'systemDeliveryContract', anchor: '/roots/content' }],
        findingIds: ['CALC-1'],
      }],
      findings: [{ ...baseFinding, regressionPaths: ['docs/GDD.md'] }],
    }
    expect(() =>
      documentReviewSubmissionSchemaForMode('initial').parse(submission),
    ).toThrow()
    expect(
      documentReviewSubmissionSchemaForMode('closure').parse(submission)
        .findings[0],
    ).toMatchObject({ regressionPaths: ['docs/GDD.md'] })
  })

  test('does not expose resource ownership or identities in Foundation Review', () => {
    const submission = {
      verdict: 'NEEDS_REVISION',
      checks: [{
        id: 'cross_document_consistency',
        status: 'block',
        conclusion: 'The foundation documents conflict.',
        evidence: [{ path: 'systemDeliveryContract', anchor: '/content/factOwnership' }],
        findingIds: ['CALC-1'],
      }],
      findings: [{
        ...baseFinding,
        checkId: 'cross_document_consistency',
        owner: 'resource',
        subjects: [{
          path: 'docs/AUDIO_DESIGN.md',
          anchor: 'Resources',
          resourceId: 'UNREGISTERED-ID',
        }],
      }],
    }
    expect(() =>
      documentReviewSubmissionSchemaForMode(
        'initial',
        'foundation',
      ).parse(submission),
    ).toThrow()
  })
})
