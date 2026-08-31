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
  validationAuthority,
} from './resource-realization-test-helpers'
import { assembleResourceRealizationClosure } from './resource-realization-assembler'

function assembleProfile(
  requirements: readonly PresentationRequirementFixture[] = [],
  mutate?: (nodes: ResourceFixtureNode[]) => ResourceFixtureNode[],
) {
  const authority = realAuthority({ presentationRequirements: requirements })
  const projectionPacket =
    prepareResourceRealizationSemanticProjectionPacket(authority)
  const semantic = admitResourceRealizationSemanticResult(
    authority,
    projectionPacket,
    completeResourceInput(
      projectionPacket,
      authority.resourceRealization.source.sectionBytes,
      'player',
      mutate,
    ),
  )
  if (semantic.outcome !== 'PROJECTED') throw new Error('fixture must project')
  const validationAuthorityResult = validationAuthority(authority, semantic)
  const validationPacket = prepareResourceRealizationSemanticValidationPacket(
    validationAuthorityResult,
  )
  const validation = admitResourceRealizationSemanticValidationResult(
    validationAuthorityResult,
    validationPacket,
    {
      outcome: 'PASS',
      packetDigest: validationPacket.packetDigest,
      checkIds: validationPacket.checkIds,
      coveredTargets: validationPacket.requiredTargets,
    },
  )
  return assembleResourceRealizationClosure({
    ...validationAuthorityResult,
    resourceRealization: {
      ...validationAuthorityResult.resourceRealization,
      validation,
    },
  })
}

describe('Resource Realization complete profiles', () => {
  test('assembles a mixed semantic and Presentation profile with complete alternatives and delivery graph', () => {
    const closure = assembleProfile(
      [{ requirementId: 'screen-main', kind: 'ui', runtimeRole: 'screen' }],
      nodes => {
        const updated = nodes.map(node => {
          if (node.id === 'profile-main')
            return {
              ...node,
              value: {
                ...node.value,
                name: 'player-acquisition',
                purpose: 'runtime-player-model',
                capabilities: [],
                coverage: [
                  { usageTags: ['character'] },
                  { assetKinds: ['model'] },
                ],
              },
            }
          if (node.id === 'target-main')
            return {
              ...node,
              value: {
                ...node.value,
                assetFormatCapabilities: ['glb', 'png', 'svg', 'wav'],
              },
            }
          if (node.id === 'variant-main')
            return {
              ...node,
              value: {
                activation: {
                  kind: 'alternative',
                  groupId: 'model-choice',
                },
              },
            }
          return node
        })
        return [
          ...updated,
          {
            id: 'variant-alt',
            kind: 'resource-realization.variant',
            value: {
              activation: { kind: 'alternative', groupId: 'model-choice' },
            },
            references: [],
            edges: [
              {
                type: 'realizes',
                targetId: 'resource.requirement.player-model',
                targetType: 'resource-realization.logical-resource',
              },
            ],
          },
          {
            id: 'artifact-main-2',
            kind: 'resource-realization.delivery-artifact',
            value: {
              artifactClass: 'runtime-resource',
              path: 'assets/runtime/player-model.png',
              format: 'png',
              runtimeRole: 'player',
            },
            references: [],
            edges: [
              {
                type: 'part-of',
                targetId: 'variant-main',
                targetType: 'resource-realization.variant',
              },
            ],
          },
          {
            id: 'artifact-alt',
            kind: 'resource-realization.delivery-artifact',
            value: {
              artifactClass: 'runtime-resource',
              path: 'assets/runtime/player-model-alt.svg',
              format: 'svg',
              runtimeRole: 'player',
            },
            references: [],
            edges: [
              {
                type: 'part-of',
                targetId: 'variant-alt',
                targetType: 'resource-realization.variant',
              },
            ],
          },
        ]
      },
    )

    expect(closure.resourceRealization.module.nodes).toHaveLength(12)
    expect(
      closure.resourceRealization.module.nodes.filter(
        node => node.kind === 'resource-realization.variant',
      ),
    ).toHaveLength(3)
    expect(
      closure.resourceRealization.module.nodes.filter(
        node => node.kind === 'resource-realization.delivery-artifact',
      ),
    ).toHaveLength(4)
    expect(closure.resourcePlan.projectTarget.assetFormatCapabilities).toEqual([
      'glb',
      'png',
      'svg',
      'wav',
    ])
    expect(
      closure.resourceRealization.module.nodes
        .filter(node => node.kind === 'resource-realization.variant')
        .map(node => node.value.activation),
    ).toContainEqual({ kind: 'alternative', groupId: 'model-choice' })
    expect(closure.resourcePlan.requirements.map(item => item.id)).toEqual([
      'player-model',
      'screen-main',
    ])
    const player = closure.resourcePlan.requirements[0]!
    expect(player.name).toBe('player-acquisition')
    expect(player.purpose).toBe('runtime-player-model')
    expect(player.acquisitionProfile.coverage).toEqual([
      { usageTags: ['character'] },
      { assetKinds: ['model'] },
    ])
    const paths = closure.resourceRealization.module.nodes
      .filter(node => node.kind === 'resource-realization.delivery-artifact')
      .map(node => node.value.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  test('assembles a conditional profile whose predicate is mechanically evaluable against the real target', () => {
    const requirements = [
      {
        requirementId: 'screen-main',
        kind: 'ui' as const,
        runtimeRole: 'screen' as const,
      },
      {
        requirementId: 'screen-secondary',
        kind: 'ui' as const,
        runtimeRole: 'screen' as const,
        owner: 'secondary' as const,
      },
    ]
    const closure = assembleProfile(requirements, nodes => {
      const updated = nodes.map(node => {
        if (node.id === 'variant-main')
          return {
            ...node,
            value: {
              activation: {
                kind: 'conditional',
                predicate: {
                  field: 'platform',
                  operator: 'eq',
                  value: 'desktop',
                },
              },
            },
          }
        if (node.id === 'artifact-main')
          return {
            ...node,
            value: {
              ...node.value,
              codec: 'web-compatible',
              technicalConstraints: [
                {
                  name: 'fps',
                  assertion: { operator: 'lte', value: 72, unit: 'hz' },
                },
              ],
            },
          }
        return node
      })
      return [
        ...updated,
        {
          id: 'variant-runtime',
          kind: 'resource-realization.variant',
          value: {
            activation: {
              kind: 'conditional',
              predicate: { field: 'runtime', operator: 'eq', value: 'web' },
            },
          },
          references: [],
          edges: [
            {
              type: 'realizes',
              targetId: 'resource.requirement.player-model',
              targetType: 'resource-realization.logical-resource',
            },
          ],
        },
        {
          id: 'variant-format',
          kind: 'resource-realization.variant',
          value: {
            activation: {
              kind: 'conditional',
              predicate: {
                field: 'asset-format-capability',
                operator: 'contains',
                value: 'svg',
              },
            },
          },
          references: [],
          edges: [
            {
              type: 'realizes',
              targetId: 'resource.requirement.player-model',
              targetType: 'resource-realization.logical-resource',
            },
          ],
        },
        {
          id: 'artifact-main-2',
          kind: 'resource-realization.delivery-artifact',
          value: {
            artifactClass: 'runtime-resource',
            path: 'assets/runtime/player-model-main-2.svg',
            format: 'svg',
            runtimeRole: 'player',
          },
          references: [],
          edges: [
            {
              type: 'part-of',
              targetId: 'variant-main',
              targetType: 'resource-realization.variant',
            },
          ],
        },
        {
          id: 'artifact-runtime',
          kind: 'resource-realization.delivery-artifact',
          value: {
            artifactClass: 'runtime-resource',
            path: 'assets/runtime/player-model-runtime.svg',
            format: 'svg',
            runtimeRole: 'player',
          },
          references: [],
          edges: [
            {
              type: 'part-of',
              targetId: 'variant-runtime',
              targetType: 'resource-realization.variant',
            },
          ],
        },
        {
          id: 'artifact-format',
          kind: 'resource-realization.delivery-artifact',
          value: {
            artifactClass: 'runtime-resource',
            path: 'assets/runtime/player-model-format.svg',
            format: 'svg',
            runtimeRole: 'player',
          },
          references: [],
          edges: [
            {
              type: 'part-of',
              targetId: 'variant-format',
              targetType: 'resource-realization.variant',
            },
          ],
        },
      ]
    })
    const target = closure.resourceRealization.module.nodes.find(
      node => node.kind === 'resource-realization.delivery-target',
    )!
    const conditionals = closure.resourceRealization.module.nodes.filter(
      node =>
        node.kind === 'resource-realization.variant' &&
        (node.value.activation as { kind?: string }).kind === 'conditional',
    )
    const activations = conditionals.map(
      variant =>
        variant.value.activation as {
          kind: 'conditional'
          predicate: { field: string; operator: string; value: string }
        },
    )
    const targetValue = target.value
    const evaluates = activations.map(activation => {
      const predicate = activation.predicate
      return predicate.field === 'platform'
        ? predicate.operator === 'eq' &&
            targetValue.platform === predicate.value
        : predicate.field === 'runtime'
          ? predicate.operator === 'eq' &&
            targetValue.runtime === predicate.value
          : predicate.field === 'asset-format-capability' &&
            predicate.operator === 'contains' &&
            (targetValue.assetFormatCapabilities as readonly string[]).includes(
              predicate.value,
            )
    })
    expect(evaluates).toEqual([true, true, true])
    expect(
      closure.resourceRealization.module.nodes.filter(
        node => node.kind === 'resource-realization.logical-resource',
      ),
    ).toHaveLength(3)
    expect(closure.resourcePlan.requirements).toHaveLength(3)
    expect(
      closure.resourceRealization.module.nodes.filter(
        node =>
          node.kind === 'resource-realization.delivery-artifact' &&
          node.edges.some(edge => edge.targetId === 'variant-main'),
      ),
    ).toHaveLength(2)
  })

  test('repeated assembly is byte and digest deterministic, frozen, and preserves Presentation ui derivation', () => {
    const requirements = [
      {
        requirementId: 'screen-main',
        kind: 'ui' as const,
        runtimeRole: 'screen' as const,
      },
      {
        requirementId: 'screen-secondary',
        kind: 'ui' as const,
        runtimeRole: 'screen' as const,
        owner: 'secondary' as const,
      },
    ]
    const first = assembleProfile(requirements)
    const second = assembleProfile(requirements)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.closureDigest).toBe(second.closureDigest)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.resourceRealization.module.nodes)).toBe(true)
    expect(Object.isFrozen(first.resourcePlan.requirements)).toBe(true)
    expect(
      first.resourceRealization.module.nodes
        .filter(node => node.kind === 'resource-realization.logical-resource')
        .filter(node => String(node.value.requirementId).startsWith('screen-'))
        .map(node => node.value.resourceKind),
    ).toEqual(['ui-asset', 'ui-asset'])
    const digest = first.closureDigest
    expect(() => {
      ;(first.resourcePlan.requirements as unknown as unknown[]).push({})
    }).toThrow()
    expect(first.closureDigest).toBe(digest)
  })

  test('assembles a representative expanded profile without an arbitrary count ceiling', () => {
    const requirements = Array.from({ length: 64 }, (_, index) => ({
      requirementId: `screen-${String(index).padStart(2, '0')}`,
      kind: 'ui' as const,
      runtimeRole: 'screen' as const,
    }))
    const closure = assembleProfile(requirements)
    expect(closure.resourceRealization.module.nodes).toHaveLength(5 + 64 * 4)
    expect(closure.resourcePlan.requirements).toHaveLength(65)
    expect(
      closure.resourceRealization.module.nodes.filter(
        node => node.kind === 'resource-realization.delivery-artifact',
      ),
    ).toHaveLength(65)
  })
})
