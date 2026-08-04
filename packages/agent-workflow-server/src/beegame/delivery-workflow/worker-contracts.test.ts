import { describe, expect, test } from 'bun:test'
import {
  documentReviewCheckSchema,
  documentReviewFindingSchema,
  documentReviewPacketSubmissionSchemaForContract,
  documentRepairPlanSubmissionSchema,
} from './worker-contracts'
import { GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA } from './types'

const baseFinding = {
  findingId: 'CALC-1',
  checkId: 'technical_feasibility' as const,
  severity: 'blocking' as const,
  owner: 'foundation' as const,
  evidence: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
  subjects: [{ path: 'docs/GDD.md', anchor: 'Rules' }],
  observation: 'The documented calculation is inconsistent.',
  blockingImpact: 'The implementation cannot derive one result.',
  requiredOutcome: 'The documents define one deterministic calculation.',
}
const {
  severity: _submissionSeverity,
  owner: _submissionOwner,
  checkId: _submissionCheckId,
  evidence: _submissionEvidence,
  ...submissionFinding
} = baseFinding
const referenceSubmissionFinding = {
  ...submissionFinding,
  evidence: [{ referenceId: 'ref-evidence' }],
  subjects: [{ referenceId: 'ref-subject' }],
}

describe('document repair plan contract', () => {
  test('accepts one ordered decision per service-owned group', () => {
    expect(
      documentRepairPlanSubmissionSchema.safeParse({
        decisions: [{ decision: 'Apply the smallest consistent correction.' }],
      }).success,
    ).toBe(true)
  })
})

describe('document review finding contract', () => {
  test('preserves the single canonical finding contract', () => {
    const parsed = documentReviewFindingSchema.parse(baseFinding)
    expect(parsed).toEqual(baseFinding)
  })

  test('still rejects non-empty resource subjects on non-resource findings', () => {
    expect(() =>
      documentReviewFindingSchema.parse({
        ...baseFinding,
        subjects: [
          {
            path: 'docs/GDD.md',
            anchor: 'Rules',
            requirementId: 'RES-1',
          },
        ],
      }),
    ).toThrow(
      'foundation and checklist findings cannot carry resource subjects',
    )
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
      conclusion: 'The delivery contract conflicts.',
      evidence: [{ referenceId: 'ref-system' }],
      assessments: [],
      findings: [
        { ...referenceSubmissionFinding, regressionPaths: ['docs/GDD.md'] },
      ],
    }
    expect(() =>
      documentReviewPacketSubmissionSchemaForContract({
        mode: 'initial',
        scope: 'complete',
        currentCheckIds: ['technical_feasibility'],
      }).parse({ checks: [submission] }),
    ).toThrow()
    expect(
      documentReviewPacketSubmissionSchemaForContract({
        mode: 'closure',
        scope: 'complete',
        currentCheckIds: ['technical_feasibility'],
      }).parse({ checks: [submission] }),
    ).toMatchObject({
      checks: [{ findings: [{ regressionPaths: ['docs/GDD.md'] }] }],
    })
    expect(() =>
      documentReviewPacketSubmissionSchemaForContract({
        mode: 'closure',
        scope: 'complete',
        currentCheckIds: ['technical_feasibility'],
      }).parse({
        checks: [
          {
            ...submission,
            findings: [{ ...referenceSubmissionFinding, regressionPaths: [] }],
          },
        ],
      }),
    ).toThrow()
  })

  test('rejects the retired nested check submission shape', () => {
    expect(() =>
      documentReviewPacketSubmissionSchemaForContract({
        mode: 'initial',
        scope: 'foundation',
        currentCheckIds: ['brief_alignment'],
      }).parse({
        conclusion: 'The brief is aligned.',
        evidence: [{ referenceId: 'ref-brief' }],
        assessments: [],
        findings: [],
      }),
    ).toThrow()
  })

  test('does not expose resource ownership or identities in Foundation Review', () => {
    const submission = {
      conclusion: 'The foundation documents conflict.',
      evidence: [{ referenceId: 'ref-system' }],
      assessments: [],
      findings: [
        {
          ...referenceSubmissionFinding,
          checkId: 'cross_document_consistency',
          owner: 'resource',
          subjects: [
            { referenceId: 'ref-audio', resourceId: 'UNREGISTERED-ID' },
          ],
        },
      ],
    }
    expect(() =>
      documentReviewPacketSubmissionSchemaForContract({
        mode: 'initial',
        scope: 'foundation',
        currentCheckIds: ['cross_document_consistency'],
      }).parse({ checks: [submission] }),
    ).toThrow()
  })
})

describe('game design review evidence contract', () => {
  const strategyCheck = {
    id: 'gameplay_strategy_viability' as const,
    status: 'pass' as const,
    conclusion: 'The documented strategy space is viable.',
    evidence: [{ path: 'docs/GDD.md', anchor: 'Strategy' }],
    findingIds: [],
    assessments:
      GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA.gameplay_strategy_viability.map(
        criterion => ({
          criterion,
          status: 'pass' as const,
          evidence: [{ path: 'docs/GDD.md', anchor: 'Strategy' }],
          derivation:
            'Compared every documented choice, response and recovery path.',
          conclusion: 'The criterion is supported by the cited design facts.',
        }),
      ),
  }

  test('requires structured criteria instead of a prose-only design pass', () => {
    const { assessments: _assessments, ...proseOnly } = strategyCheck
    expect(() => documentReviewCheckSchema.parse(proseOnly)).toThrow()
    expect(documentReviewCheckSchema.parse(strategyCheck)).toEqual(
      strategyCheck,
    )
  })

  test('requires the complete level and scene design criterion set', () => {
    const levelSceneCheck = {
      ...strategyCheck,
      id: 'level_scene_design_integrity' as const,
      evidence: [
        { path: 'docs/LEVEL_SCENE_DESIGN.md', anchor: 'Spatial Design' },
      ],
      assessments:
        GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA.level_scene_design_integrity.map(
          criterion => ({
            criterion,
            status: 'pass' as const,
            evidence: [
              {
                path: 'docs/LEVEL_SCENE_DESIGN.md',
                anchor: 'Spatial Design',
              },
            ],
            derivation:
              'Compared spatial support, level progression and scene-state paths.',
            conclusion: 'The criterion is supported by the cited design facts.',
          }),
        ),
    }
    expect(documentReviewCheckSchema.parse(levelSceneCheck)).toEqual(
      levelSceneCheck,
    )
  })

  test('does not duplicate finding identities inside criterion assessments', () => {
    expect(() =>
      documentReviewCheckSchema.parse({
        ...strategyCheck,
        assessments: strategyCheck.assessments.map(assessment => ({
          ...assessment,
          findingIds: [],
        })),
      }),
    ).toThrow()
  })

  test('rejects duplicate criteria and check-level status drift', () => {
    expect(() =>
      documentReviewCheckSchema.parse({
        ...strategyCheck,
        assessments: strategyCheck.assessments.map(assessment => ({
          ...assessment,
          criterion: 'meaningful_choices',
        })),
      }),
    ).toThrow('requires its exact criterion set')

    expect(() =>
      documentReviewCheckSchema.parse({
        ...strategyCheck,
        status: 'block',
        findingIds: ['STRATEGY-1'],
      }),
    ).toThrow('status must match its criterion statuses')
  })
})
