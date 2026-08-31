import { describe, expect, test } from 'bun:test'
import {
  admitResourceRealizationSemanticResult,
  prepareResourceRealizationSemanticProjectionPacket,
} from './resource-realization-producer'
import {
  admitResourceRealizationSemanticValidationResult,
  prepareResourceRealizationSemanticValidationPacket,
} from './phase6-admission'
import {
  completeResourceInput,
  realAuthority,
} from './resource-realization-test-helpers'
import { assembleResourceRealizationClosure } from './resource-realization-assembler'
import { digestGameIrValue } from './model'

function completeAuthority() {
  const projectedAuthority = realAuthority()
  const projectionPacket =
    prepareResourceRealizationSemanticProjectionPacket(projectedAuthority)
  const semantic = admitResourceRealizationSemanticResult(
    projectedAuthority,
    projectionPacket,
    completeResourceInput(
      projectionPacket,
      projectedAuthority.resourceRealization.source.sectionBytes,
    ),
  )
  if (semantic.outcome !== 'PROJECTED') throw new Error('fixture must project')
  const validationAuthority = {
    phase5Authority: projectedAuthority.phase5Authority,
    resourceRealization: {
      ...projectedAuthority.resourceRealization,
      semantic,
    },
  }
  const validationPacket =
    prepareResourceRealizationSemanticValidationPacket(validationAuthority)
  const validation = admitResourceRealizationSemanticValidationResult(
    validationAuthority,
    validationPacket,
    {
      outcome: 'PASS',
      packetDigest: validationPacket.packetDigest,
      checkIds: validationPacket.checkIds,
      coveredTargets: validationPacket.requiredTargets,
    },
  )
  return {
    ...validationAuthority,
    resourceRealization: {
      ...validationAuthority.resourceRealization,
      validation,
    },
  }
}

describe('Resource Realization sole assembler', () => {
  test('assembles the replayed closure with a resource module and derived plan', () => {
    const closure = assembleResourceRealizationClosure(completeAuthority())

    expect(Object.keys(closure).sort()).toEqual([
      'authoritySectionIndexDigest',
      'closureDigest',
      'compileRequestDigest',
      'foundationReceiptDigest',
      'foundationRevision',
      'phase5',
      'resourcePlan',
      'resourcePlanDigest',
      'resourceRealization',
      'schemaVersion',
      'taskId',
    ])
    expect(closure.phase5.presentation.module.moduleId).toBe('presentation')
    expect(closure.resourceRealization.module.moduleId).toBe(
      'resource-realization',
    )
    expect(closure.resourceRealization.projectionDigest).toMatch(
      /^[a-f0-9]{64}$/,
    )
    expect(closure.resourceRealization.sourceDigest).toBe(
      completeAuthority().resourceRealization.source.sourceDigest,
    )
    expect(closure.resourcePlan.projectTarget).toEqual({
      platform: 'desktop',
      runtime: 'web',
      assetFormatCapabilities: ['glb', 'svg'],
    })
    expect(
      closure.resourcePlan.requirements.map(requirement => requirement.id),
    ).toEqual(['player-model', 'screen-main'])
    expect(closure.resourcePlan.requirements[0]).toMatchObject({
      id: 'player-model',
      required: true,
      acquisitionProfile: {
        dimensions: ['3D'],
        assetKinds: ['model'],
        usageTags: ['character'],
        capabilities: ['skinned'],
        styles: ['stylized'],
      },
      sourcingPolicy: {
        allowedSourceKinds: ['agent-authored'],
        licenseConstraints: ['project-license'],
        responsibleParty: 'art-team',
        handoffCriteria: ['runtime-import-ready'],
      },
    })
    expect(closure.resourcePlanDigest).toBe(
      digestGameIrValue(closure.resourcePlan),
    )
    const { closureDigest, ...closureBody } = closure
    expect(closureDigest).toBe(digestGameIrValue(closureBody))
    expect(Object.isFrozen(closure)).toBe(true)
    expect(Object.isFrozen(closure.resourceRealization)).toBe(true)
    expect(Object.isFrozen(closure.resourcePlan)).toBe(true)
    expect(Object.isFrozen(closure.resourcePlan.requirements)).toBe(true)
  })

  test('is deterministic and does not expose caller-owned mutable state', () => {
    const authority = structuredClone(completeAuthority())
    const first = assembleResourceRealizationClosure(authority)
    const second = assembleResourceRealizationClosure(authority)
    expect(first).toEqual(second)
    ;(
      authority.resourceRealization.source.sectionBytes as Record<
        string,
        string
      >
    )['docs/ASSET_PLAN.md#section-0'] = 'tampered'
    expect(first).toEqual(second)
    expect(() => {
      ;(first.resourcePlan.requirements as unknown as Array<unknown>).push({})
    }).toThrow()
  })

  test('rejects non-PASS, partial, and extra validation results', () => {
    const authority = completeAuthority()
    expect(() =>
      assembleResourceRealizationClosure({
        ...authority,
        resourceRealization: {
          ...authority.resourceRealization,
          validation: { outcome: 'FAIL', diagnostics: [] } as never,
        },
      }),
    ).toThrow(/validation|FAIL|PASS/i)
    expect(() =>
      assembleResourceRealizationClosure({
        ...authority,
        resourceRealization: {
          ...authority.resourceRealization,
          validation: {
            outcome: 'PASS',
            packetDigest: '0'.repeat(64),
            checkIds: [],
            coveredTargets: [],
          } as never,
        },
      }),
    ).toThrow(/validation|packet|coverage|stale/i)
    expect(() =>
      assembleResourceRealizationClosure({
        ...authority,
        resourceRealization: {
          ...authority.resourceRealization,
          validation: {
            ...authority.resourceRealization.validation,
            extra: true,
          } as never,
        },
      }),
    ).toThrow(/validation|field|unknown/i)
  })

  test('rejects unknown authority fields and cross-authority resource evidence', () => {
    const authority = completeAuthority()
    expect(() =>
      assembleResourceRealizationClosure({
        ...authority,
        extra: true,
      } as never),
    ).toThrow(/authority|field|unknown/i)
    expect(() =>
      assembleResourceRealizationClosure({
        ...authority,
        resourceRealization: {
          ...authority.resourceRealization,
          extra: true,
        },
      } as never),
    ).toThrow(/resourceRealization|field|unknown/i)
    const other = realAuthority({ presentationRequirements: [] })
    expect(() =>
      assembleResourceRealizationClosure({
        ...authority,
        resourceRealization: {
          ...authority.resourceRealization,
          source: other.resourceRealization.source,
          mechanical: other.resourceRealization.mechanical,
        },
      }),
    ).toThrow(/identity|detached|authority|source/i)
  })

  test('mechanically includes zero, same-owner, and multi-owner Presentation requirements', () => {
    const cases = [
      { requirements: [], expected: ['player-model'] },
      {
        requirements: [
          {
            requirementId: 'screen-a',
            kind: 'ui' as const,
            runtimeRole: 'screen' as const,
          },
          {
            requirementId: 'screen-b',
            kind: 'ui' as const,
            runtimeRole: 'screen' as const,
          },
        ],
        expected: ['player-model', 'screen-a', 'screen-b'],
      },
      {
        requirements: [
          {
            requirementId: 'screen-a',
            kind: 'ui' as const,
            runtimeRole: 'screen' as const,
          },
          {
            requirementId: 'screen-b',
            kind: 'ui' as const,
            runtimeRole: 'screen' as const,
            owner: 'secondary' as const,
          },
        ],
        expected: ['player-model', 'screen-a', 'screen-b'],
      },
    ]
    for (const { requirements, expected } of cases) {
      const projectedAuthority = realAuthority({
        presentationRequirements: requirements,
      })
      const projectionPacket =
        prepareResourceRealizationSemanticProjectionPacket(projectedAuthority)
      const semantic = admitResourceRealizationSemanticResult(
        projectedAuthority,
        projectionPacket,
        completeResourceInput(
          projectionPacket,
          projectedAuthority.resourceRealization.source.sectionBytes,
        ),
      )
      if (semantic.outcome !== 'PROJECTED')
        throw new Error('fixture must project')
      const validationAuthority = {
        phase5Authority: projectedAuthority.phase5Authority,
        resourceRealization: {
          ...projectedAuthority.resourceRealization,
          semantic,
        },
      }
      const validationPacket =
        prepareResourceRealizationSemanticValidationPacket(validationAuthority)
      const validation = admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        validationPacket,
        {
          outcome: 'PASS',
          packetDigest: validationPacket.packetDigest,
          checkIds: validationPacket.checkIds,
          coveredTargets: validationPacket.requiredTargets,
        },
      )
      const closure = assembleResourceRealizationClosure({
        ...validationAuthority,
        resourceRealization: {
          ...validationAuthority.resourceRealization,
          validation,
        },
      })
      expect(
        closure.resourcePlan.requirements.map(requirement => requirement.id),
      ).toEqual(expected)
    }
  })
})
