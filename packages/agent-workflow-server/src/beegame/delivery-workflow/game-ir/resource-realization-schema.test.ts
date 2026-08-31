import { describe, expect, test } from 'bun:test'
import type { GameIrModuleCandidate, GameIrNode } from './model'
import {
  parseResourceRealizationModule,
  RESOURCE_REALIZATION_DOMAIN_MANIFEST,
} from './resource-realization-schema'

const externalEntity: GameIrNode = {
  id: 'gameplay.player',
  kind: 'gameplay.entity',
  producerMode: 'semantic',
  value: { label: 'Player' },
  references: [],
  edges: [],
  bindings: {},
}

function node(
  id: string,
  kind: string,
  value: Record<string, unknown>,
  edges: GameIrNode['edges'] = [],
  producerMode: GameIrNode['producerMode'] = 'semantic',
): GameIrNode {
  return { id, kind, producerMode, value, references: [], edges, bindings: {} }
}

function validModule(): GameIrModuleCandidate {
  const logical = node(
    'resource.requirement.player-model',
    'resource-realization.logical-resource',
    {
      requirementId: 'player-model',
      resourceKind: 'model',
      runtimeRole: 'player',
    },
    [
      {
        type: 'required-by',
        targetId: 'gameplay.player',
        targetType: 'gameplay.entity',
      },
    ],
  )
  const profile = node(
    'resource.profile.player-model',
    'resource-realization.acquisition-profile',
    {
      name: 'Player model',
      purpose: 'Player avatar',
      required: true,
      dimensions: ['3D'],
      assetKinds: ['model'],
      usageTags: ['character'],
      capabilities: ['skinned'],
      styles: ['stylized'],
      sourcingPolicy: {
        allowedSourceKinds: ['agent-authored'],
        licenseConstraints: ['project-license'],
        responsibleParty: 'art-team',
        handoffCriteria: ['runtime-import-ready'],
      },
    },
    [
      {
        type: 'describes',
        targetId: logical.id,
        targetType: logical.kind,
      },
    ],
  )
  const target = node(
    'resource.target.primary',
    'resource-realization.delivery-target',
    { platform: 'desktop', runtime: 'web', assetFormatCapabilities: ['glb'] },
  )
  const variant = node(
    'resource.variant.player-model.required',
    'resource-realization.variant',
    { activation: { kind: 'required' } },
    [
      {
        type: 'realizes',
        targetId: logical.id,
        targetType: logical.kind,
      },
    ],
  )
  const artifact = node(
    'resource.artifact.player-model.glb',
    'resource-realization.delivery-artifact',
    {
      artifactClass: 'runtime-resource',
      path: 'assets/runtime/player-model.glb',
      format: 'glb',
      runtimeRole: 'player',
      technicalConstraints: [
        {
          name: 'lod',
          assertion: { operator: 'gte', value: 1, unit: 'count' },
        },
      ],
      budgets: [{ metric: 'file-size', limit: 100, unit: 'MB' }],
    },
    [
      {
        type: 'part-of',
        targetId: variant.id,
        targetType: variant.kind,
      },
    ],
  )
  return {
    moduleId: 'resource-realization',
    nodes: [logical, profile, target, variant, artifact].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
  }
}

function parse(module = validModule()): GameIrModuleCandidate {
  return parseResourceRealizationModule(
    module,
    new Map([[externalEntity.id, externalEntity]]),
  )
}

describe('resource-realization schema', () => {
  test('declares one authority for exactly five node kinds', () => {
    expect(Object.keys(RESOURCE_REALIZATION_DOMAIN_MANIFEST).sort()).toEqual([
      'resource-realization.acquisition-profile',
      'resource-realization.delivery-artifact',
      'resource-realization.delivery-target',
      'resource-realization.logical-resource',
      'resource-realization.variant',
    ])
  })

  test('admits a complete one-to-one realization and freezes the result', () => {
    const result = parse()
    expect(result.moduleId).toBe('resource-realization')
    expect(result.nodes).toHaveLength(5)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.nodes)).toBe(true)
    expect(Object.isFrozen(result.nodes[0])).toBe(true)
  })

  test('allows omitted units for eq and one-of assertions without freezing input', () => {
    const module = validModule()
    const artifact = module.nodes.find(node =>
      node.kind.endsWith('delivery-artifact'),
    )!
    const changed = {
      ...module,
      nodes: module.nodes.map(node =>
        node.id === artifact.id
          ? {
              ...node,
              value: {
                ...node.value,
                technicalConstraints: [
                  {
                    name: 'format',
                    assertion: { operator: 'eq', value: 'glb' },
                  },
                  {
                    name: 'quality',
                    assertion: {
                      operator: 'one-of',
                      values: ['high', 'standard'],
                    },
                  },
                ],
              },
            }
          : node,
      ),
    }
    const result = parse(changed)
    expect(
      Object.isFrozen(
        result.nodes.find(node => node.id === artifact.id)!.bindings,
      ),
    ).toBe(true)
    expect(
      Object.isFrozen(
        changed.nodes.find(node => node.id === artifact.id)!.bindings,
      ),
    ).toBe(false)
  })

  test('admits multiple variants and multiple delivery artifacts', () => {
    const module = validModule()
    const logical = module.nodes.find(node =>
      node.kind.endsWith('logical-resource'),
    )!
    const profile = module.nodes.find(node =>
      node.kind.endsWith('acquisition-profile'),
    )!
    const target = module.nodes.find(node =>
      node.kind.endsWith('delivery-target'),
    )!
    const firstVariant = module.nodes.find(node =>
      node.kind.endsWith('.variant'),
    )!
    const firstArtifact = module.nodes.find(node =>
      node.kind.endsWith('delivery-artifact'),
    )!
    const alternative = node(
      'resource.variant.player-model.alternative',
      firstVariant.kind,
      { activation: { kind: 'alternative', groupId: 'player-model-format' } },
      [{ type: 'realizes', targetId: logical.id, targetType: logical.kind }],
    )
    const alternativeArtifact = node(
      'resource.artifact.player-model.fbx',
      firstArtifact.kind,
      {
        artifactClass: 'runtime-resource',
        path: 'assets/runtime/player-model.fbx',
        format: 'fbx',
        runtimeRole: 'player',
      },
      [
        {
          type: 'part-of',
          targetId: alternative.id,
          targetType: alternative.kind,
        },
      ],
    )
    const changedTarget = {
      ...target,
      value: {
        platform: 'desktop',
        runtime: 'web',
        assetFormatCapabilities: ['fbx', 'glb'],
      },
    }
    const changedProfile = {
      ...profile,
      value: {
        ...profile.value,
        capabilities: [],
        coverage: [{ assetKinds: ['model'] }],
      },
    }
    const nodes = [
      logical,
      changedProfile,
      changedTarget,
      {
        ...firstVariant,
        value: {
          activation: { kind: 'alternative', groupId: 'player-model-format' },
        },
      },
      alternative,
      firstArtifact,
      alternativeArtifact,
    ].sort((left, right) => left.id.localeCompare(right.id))
    expect(parse({ moduleId: module.moduleId, nodes }).nodes).toHaveLength(7)
  })

  test('admits the derived Presentation ui to ui-asset shape and reachable predicates', () => {
    const module = validModule()
    const logical = module.nodes.find(node =>
      node.kind.endsWith('logical-resource'),
    )!
    const variant = module.nodes.find(node => node.kind.endsWith('.variant'))!
    const nodes = module.nodes.map(node => {
      if (node.id === logical.id) {
        return {
          ...node,
          producerMode: 'derived' as const,
          value: {
            requirementId: 'player-model',
            resourceKind: 'ui-asset',
            runtimeRole: 'screen',
          },
        }
      }
      if (node.id === variant.id) {
        return {
          ...node,
          value: {
            activation: {
              kind: 'conditional' as const,
              predicate: {
                field: 'platform' as const,
                operator: 'eq' as const,
                value: 'desktop',
              },
            },
          },
        }
      }
      return node
    })
    expect(parse({ moduleId: module.moduleId, nodes }).nodes).toHaveLength(5)
  })

  test('rejects unknown fields and a second identity inside a variant/artifact', () => {
    const module = validModule()
    const variant = module.nodes.find(node => node.kind.endsWith('.variant'))!
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === variant.id
            ? { ...node, value: { ...node.value, variantId: 'legacy' } }
            : node,
        ),
      }),
    ).toThrow(/unknown or missing fields/)
  })

  test('rejects actual resource, provenance and inventory facts', () => {
    const module = validModule()
    const artifact = module.nodes.find(node =>
      node.kind.endsWith('delivery-artifact'),
    )!
    for (const field of [
      'contentHash',
      'provenance',
      'inventoryStatus',
      'actualPath',
    ]) {
      expect(() =>
        parse({
          ...module,
          nodes: module.nodes.map(node =>
            node.id === artifact.id
              ? { ...node, value: { ...node.value, [field]: 'observed' } }
              : node,
          ),
        }),
      ).toThrow(/unknown or missing fields/)
    }
  })

  test('rejects unsafe paths, target format mismatch, non-finite values and non-canonical arrays', () => {
    const module = validModule()
    const artifact = module.nodes.find(node =>
      node.kind.endsWith('delivery-artifact'),
    )!
    const target = module.nodes.find(node =>
      node.kind.endsWith('delivery-target'),
    )!
    const profile = module.nodes.find(node =>
      node.kind.endsWith('acquisition-profile'),
    )!
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === artifact.id
            ? { ...node, value: { ...node.value, path: '../player.glb' } }
            : node,
        ),
      }),
    ).toThrow(/path/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === target.id
            ? {
                ...node,
                value: { ...node.value, assetFormatCapabilities: ['fbx'] },
              }
            : node,
        ),
      }),
    ).toThrow(/format/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === artifact.id
            ? {
                ...node,
                value: {
                  ...node.value,
                  budgets: [{ metric: 'size', limit: Number.NaN, unit: 'MB' }],
                },
              }
            : node,
        ),
      }),
    ).toThrow(/finite/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === profile.id
            ? { ...node, value: { ...node.value, dimensions: ['3D', '2D'] } }
            : node,
        ),
      }),
    ).toThrow(/sorted/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === artifact.id
            ? {
                ...node,
                value: {
                  ...node.value,
                  path: 'assets/content/player-model.glb',
                },
              }
            : node,
        ),
      }),
    ).toThrow(/artifact class root/)
  })

  test('rejects empty Manifest-v8 dimensions/assets and unresolvable predicates', () => {
    const module = validModule()
    const profile = module.nodes.find(node =>
      node.kind.endsWith('acquisition-profile'),
    )!
    const variant = module.nodes.find(node => node.kind.endsWith('.variant'))!
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === profile.id
            ? { ...node, value: { ...node.value, dimensions: [] } }
            : node,
        ),
      }),
    ).toThrow(/dimensions/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === variant.id
            ? {
                ...node,
                value: {
                  activation: {
                    kind: 'conditional',
                    predicate: {
                      field: 'runtime',
                      operator: 'eq',
                      value: 'native',
                    },
                  },
                },
              }
            : node,
        ),
      }),
    ).toThrow(/unreachable/)
  })

  test('rejects missing/wrong relationship targets, orphan closure and weak alternative groups', () => {
    const module = validModule()
    const logical = module.nodes.find(node =>
      node.kind.endsWith('logical-resource'),
    )!
    const variant = module.nodes.find(node => node.kind.endsWith('.variant'))!
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === logical.id ? { ...node, edges: [] } : node,
        ),
      }),
    ).toThrow(/required-by/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === variant.id
            ? {
                ...node,
                edges: [
                  {
                    type: 'realizes',
                    targetId: 'missing',
                    targetType: logical.kind,
                  },
                ],
              }
            : node,
        ),
      }),
    ).toThrow(/target/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === variant.id
            ? {
                ...node,
                value: {
                  activation: { kind: 'alternative', groupId: 'single' },
                },
              }
            : node,
        ),
      }),
    ).toThrow(/alternative/)
  })
})
