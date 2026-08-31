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
  type PresentationRequirementFixture,
  type ResourceFixtureNode,
} from './resource-realization-test-helpers'
import { assembleResourceRealizationClosure } from './resource-realization-assembler'
import { digestGameIrValue } from './model'

function completeAuthority(
  mutate?: (nodes: ResourceFixtureNode[]) => ResourceFixtureNode[],
  options: {
    presentationRequirements?: readonly PresentationRequirementFixture[]
  } = {},
) {
  const projectedAuthority = realAuthority(options)
  const projectionPacket =
    prepareResourceRealizationSemanticProjectionPacket(projectedAuthority)
  const semantic = admitResourceRealizationSemanticResult(
    projectedAuthority,
    projectionPacket,
    completeResourceInput(
      projectionPacket,
      projectedAuthority.resourceRealization.source.sectionBytes,
      'player',
      mutate,
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
    const firstDigest = first.closureDigest
    const selectedKey = Object.keys(
      authority.resourceRealization.source.sectionBytes,
    ).find(key => key.endsWith('#section-7'))
    expect(selectedKey).toBeDefined()
    ;(
      authority.resourceRealization.source.sectionBytes as Record<
        string,
        string
      >
    )[selectedKey!] += '\ntampered'
    expect(first.closureDigest).toBe(firstDigest)
    expect(() => assembleResourceRealizationClosure(authority)).toThrow(
      /source|digest|section|stale|authority/i,
    )
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

  test('projects only the exact plan fields and preserves optional profile data', () => {
    const authority = completeAuthority(nodes =>
      nodes.map(node =>
        node.id === 'profile-screen-main'
          ? {
              ...node,
              value: {
                ...node.value,
                name: 'profile-main',
                purpose: 'technical-design-section',
                capabilities: [],
                coverage: [{ capabilities: ['ui-states'] }],
              },
            }
          : node,
      ),
    )
    const closure = assembleResourceRealizationClosure(authority)
    expect(Object.keys(closure.resourcePlan).sort()).toEqual([
      'projectTarget',
      'requirements',
    ])
    expect(Object.keys(closure.resourcePlan.projectTarget)).toEqual([
      'platform',
      'runtime',
      'assetFormatCapabilities',
    ])
    const requirement = closure.resourcePlan.requirements.find(
      item => item.id === 'screen-main',
    )!
    expect(Object.keys(requirement).sort()).toEqual([
      'acquisitionProfile',
      'id',
      'name',
      'purpose',
      'required',
      'sourcingPolicy',
    ])
    expect(Object.keys(requirement.acquisitionProfile).sort()).toEqual([
      'assetKinds',
      'capabilities',
      'coverage',
      'dimensions',
      'styles',
      'usageTags',
    ])
    expect(Object.keys(requirement.sourcingPolicy).sort()).toEqual([
      'allowedSourceKinds',
      'handoffCriteria',
      'licenseConstraints',
      'responsibleParty',
    ])
    expect(requirement).toMatchObject({
      name: 'profile-main',
      purpose: 'technical-design-section',
      acquisitionProfile: {
        capabilities: [],
        coverage: [{ capabilities: ['ui-states'] }],
      },
    })
    expect(Object.isFrozen(requirement.acquisitionProfile.coverage)).toBe(true)
    expect(Object.isFrozen(requirement.sourcingPolicy)).toBe(true)
  })

  test('rejects caller resourcePlan, module, and packet injection by exact authority shape', () => {
    const authority = completeAuthority()
    expect(() =>
      assembleResourceRealizationClosure({
        ...authority,
        resourcePlan: {},
      } as never),
    ).toThrow(/authority|unknown|missing|field/i)
    expect(() =>
      assembleResourceRealizationClosure({
        ...authority,
        resourceRealization: {
          ...authority.resourceRealization,
          module: {},
        },
      } as never),
    ).toThrow(/resourceRealization|unknown|missing|field/i)
    expect(() =>
      assembleResourceRealizationClosure({
        ...authority,
        packet: {},
      } as never),
    ).toThrow(/authority|unknown|missing|field/i)
  })

  test('rejects representative nested source, mechanical, semantic, Phase 5, and cross-authority tampering', () => {
    const baseline = completeAuthority()
    const sourceTampered = structuredClone(baseline)
    const sourceKey = Object.keys(
      sourceTampered.resourceRealization.source.sectionBytes,
    ).find(key => key.endsWith('#section-7'))!
    ;(
      sourceTampered.resourceRealization.source.sectionBytes as Record<
        string,
        string
      >
    )[sourceKey] += '\ntampered'
    expect(() => assembleResourceRealizationClosure(sourceTampered)).toThrow(
      /source|digest|section|stale/i,
    )

    const mechanicalTampered = structuredClone(baseline)
    const mechanicalBody = {
      ...mechanicalTampered.resourceRealization.mechanical,
      nodes: [
        mechanicalTampered.phase5Authority.phase4Authority.gameplay.semantic
          .nodes[0] as never,
      ] as never,
    }
    mechanicalTampered.resourceRealization.mechanical = {
      ...mechanicalBody,
      receiptDigest: digestGameIrValue(mechanicalBody),
    }
    expect(() =>
      assembleResourceRealizationClosure(mechanicalTampered),
    ).toThrow(/mechanical|empty|isolated/i)

    const semanticTampered = structuredClone(baseline)
    const semanticBody = {
      ...semanticTampered.resourceRealization.semantic,
      nodes: semanticTampered.resourceRealization.semantic.nodes.map(
        (node, index) =>
          index === 0
            ? { ...node, value: { ...node.value, runtimeRole: 'tampered' } }
            : node,
      ),
    }
    semanticTampered.resourceRealization.semantic = {
      ...semanticBody,
      receiptDigest: digestGameIrValue(semanticBody),
    }
    expect(() => assembleResourceRealizationClosure(semanticTampered)).toThrow(
      /semantic|claim|literal|stale|detached/i,
    )

    const phase5SemanticTampered = structuredClone(baseline)
    const phase5SemanticBody = {
      ...phase5SemanticTampered.phase5Authority.presentation.semantic,
      nodes:
        phase5SemanticTampered.phase5Authority.presentation.semantic.nodes.map(
          (node, index) =>
            index === 0
              ? { ...node, value: { ...node.value, label: 'tampered' } }
              : node,
        ),
    }
    ;(
      phase5SemanticTampered.phase5Authority.presentation as unknown as {
        semantic: unknown
      }
    ).semantic = {
      ...phase5SemanticBody,
      receiptDigest: digestGameIrValue(phase5SemanticBody),
    }
    expect(() =>
      assembleResourceRealizationClosure(phase5SemanticTampered),
    ).toThrow(/Phase 5|Presentation|semantic|claim|literal|stale/i)

    const phase5ValidationTampered = structuredClone(baseline)
    const phase5Validation =
      phase5ValidationTampered.phase5Authority.presentation.validation
    if (phase5Validation.outcome !== 'PASS')
      throw new Error('fixture must pass')
    ;(
      phase5ValidationTampered.phase5Authority.presentation as unknown as {
        validation: unknown
      }
    ).validation = {
      ...phase5Validation,
      coveredTargets: phase5Validation.coveredTargets.slice(1),
    }
    expect(() =>
      assembleResourceRealizationClosure(phase5ValidationTampered),
    ).toThrow(/Phase 5|Presentation|validation|coverage|target/i)

    const other = completeAuthority(undefined, { presentationRequirements: [] })
    expect(() =>
      assembleResourceRealizationClosure({
        ...baseline,
        resourceRealization: {
          ...baseline.resourceRealization,
          validation: other.resourceRealization.validation,
        },
      }),
    ).toThrow(/validation|packet|stale|authority|coverage/i)
  })
})
