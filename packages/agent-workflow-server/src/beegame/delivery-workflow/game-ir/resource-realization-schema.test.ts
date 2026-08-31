import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  digestGameIrValue,
  type GameIrModuleCandidate,
  type GameIrNode,
  type GameIrSourceSection,
} from './model'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { digestSectionIndex } from '../foundation-section-index'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_RELATION_KINDS,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import {
  parseResourceRealizationModule,
  RESOURCE_REALIZATION_DOMAIN_MANIFEST,
} from './resource-realization-schema'

const sectionDigest = 'b'.repeat(64)
const resourceSection: GameIrSourceSection = {
  documentPath: 'docs/ASSET_PLAN.md',
  sectionId: 'resource-plan',
  heading: 'Resource plan',
  startLine: 1,
  endLine: 100,
  digest: sectionDigest,
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function request(): GameIrCompileRequest {
  const foundation: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: sectionDigest,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, sectionDigest]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex([resourceSection]),
    authority: {
      kind: 'review',
      reviewDigest: sectionDigest,
      issueRegistryDigest: sectionDigest,
    },
  }
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'compile-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundation,
      receiptDigest: createHash('sha256')
        .update(canonical(foundation))
        .digest('hex'),
    },
  }
}

type MutableNode = {
  id: string
  kind: string
  producerMode: GameIrNode['producerMode']
  value: Record<string, unknown>
  references: Array<{ targetId: string; targetType: string }>
  edges: GameIrNode['edges']
  bindings: Record<string, Record<string, unknown>>
}

type MutableModule = {
  moduleId: string
  nodes: MutableNode[]
}

const externalEntity: GameIrNode = {
  id: 'gameplay.player',
  kind: 'gameplay.entity',
  producerMode: 'semantic',
  value: { label: 'Player' },
  references: [],
  edges: [],
  bindings: {
    '/id': {
      kind: 'owner',
      documentPath: resourceSection.documentPath,
      sectionId: resourceSection.sectionId,
      sectionDigest,
      sourcePointer: '/gameplay/player',
    },
    '/value/label': {
      kind: 'owner',
      documentPath: resourceSection.documentPath,
      sectionId: resourceSection.sectionId,
      sectionDigest,
      sourcePointer: '/gameplay/player/label',
    },
  },
}

const externalGameplayState: GameIrNode = {
  id: 'gameplay.state.playing',
  kind: 'gameplay.state',
  producerMode: 'semantic',
  value: { label: 'Playing' },
  references: [],
  edges: [],
  bindings: {
    '/id': {
      kind: 'owner',
      documentPath: resourceSection.documentPath,
      sectionId: resourceSection.sectionId,
      sectionDigest,
      sourcePointer: '/gameplay/state/playing',
    },
    '/value/label': {
      kind: 'owner',
      documentPath: resourceSection.documentPath,
      sectionId: resourceSection.sectionId,
      sectionDigest,
      sourcePointer: '/gameplay/state/playing/label',
    },
  },
}

function node(
  id: string,
  kind: string,
  value: Record<string, unknown>,
  edges: GameIrNode['edges'] = [],
  producerMode: GameIrNode['producerMode'] = 'semantic',
): MutableNode {
  return { id, kind, producerMode, value, references: [], edges, bindings: {} }
}

function valueLeafPointers(value: Record<string, unknown>): string[] {
  const leaves: string[] = []
  const visit = (entry: unknown, path: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) leaves.push(path)
      else entry.forEach((child, index) => visit(child, `${path}/${index}`))
      return
    }
    if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry as Record<string, unknown>)
      if (entries.length === 0) leaves.push(path)
      else
        entries.forEach(([key, child]) =>
          visit(
            child,
            `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
          ),
        )
      return
    }
    leaves.push(path)
  }
  Object.entries(value).forEach(([key, child]) =>
    visit(child, `/value/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`),
  )
  return leaves
}

function bindNode(nodeValue: MutableNode): void {
  const pointers = [
    '/id',
    ...valueLeafPointers(nodeValue.value),
    ...nodeValue.edges.map((_, index) => `/edges/${index}`),
  ]
  nodeValue.bindings = Object.fromEntries(
    pointers.map(pointer => [
      pointer,
      {
        kind: 'owner',
        documentPath: resourceSection.documentPath,
        sectionId: resourceSection.sectionId,
        sectionDigest,
        sourcePointer: `/resource/${nodeValue.id}${pointer}`,
      },
    ]),
  )
}

function bindModule(module: MutableModule): MutableModule {
  module.nodes.forEach(bindNode)
  module.nodes.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )
  return module
}

function withNodes(
  module: MutableModule,
  transform: (node: MutableNode) => MutableNode,
): MutableModule {
  const copy = structuredClone(module) as MutableModule
  copy.nodes = copy.nodes.map(transform)
  return bindModule(copy)
}

function validModule(): MutableModule {
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
  return bindModule({
    moduleId: 'resource-realization',
    nodes: [logical, profile, target, variant, artifact],
  })
}

function parseRaw(
  module: unknown,
  externalModules: readonly unknown[] = [
    { moduleId: 'gameplay', nodes: [externalEntity] },
  ],
): GameIrModuleCandidate {
  return parseResourceRealizationModule(module, {
    request: request(),
    sections: [resourceSection],
    externalModules,
  })
}

function parse(module: MutableModule = validModule()): GameIrModuleCandidate {
  return parseRaw(bindModule(structuredClone(module) as MutableModule))
}

function presentationRequirementModule(): MutableModule {
  const ownerBindings = (nodeId: string, pointers: string[]) =>
    Object.fromEntries(
      pointers.map(pointer => [
        pointer,
        {
          kind: 'owner',
          documentPath: resourceSection.documentPath,
          sectionId: resourceSection.sectionId,
          sectionDigest,
          sourcePointer: `/presentation/${nodeId}${pointer}`,
        },
      ]),
    )
  return {
    moduleId: 'presentation',
    nodes: [
      {
        id: 'presentation.screen.main',
        kind: 'presentation.ui-screen',
        producerMode: 'semantic',
        value: {
          label: 'Main screen',
          modal: false,
          requirements: [
            { requirementId: 'req.ui.main', kind: 'ui', runtimeRole: 'screen' },
          ],
        },
        references: [],
        edges: [
          {
            type: 'driven-by',
            targetId: 'gameplay.state.playing',
            targetType: 'gameplay.state',
          },
          {
            type: 'initial-state',
            targetId: 'presentation.state.main',
            targetType: 'presentation.ui-state',
          },
        ],
        bindings: ownerBindings('screen.main', [
          '/id',
          '/value/label',
          '/value/modal',
          '/value/requirements/0/requirementId',
          '/value/requirements/0/kind',
          '/value/requirements/0/runtimeRole',
          '/edges/0',
          '/edges/1',
        ]),
      },
      {
        id: 'presentation.state.main',
        kind: 'presentation.ui-state',
        producerMode: 'semantic',
        value: { label: 'Main state', terminal: false },
        references: [],
        edges: [
          {
            type: 'driven-by',
            targetId: 'gameplay.state.playing',
            targetType: 'gameplay.state',
          },
          {
            type: 'screen',
            targetId: 'presentation.screen.main',
            targetType: 'presentation.ui-screen',
          },
        ],
        bindings: ownerBindings('state.main', [
          '/id',
          '/value/label',
          '/value/terminal',
          '/edges/0',
          '/edges/1',
        ]),
      },
    ],
  }
}

function derivedPresentationRequirementModule(): MutableModule {
  const module = structuredClone(validModule()) as MutableModule
  const logical = module.nodes.find(node =>
    node.kind.endsWith('logical-resource'),
  )!
  const previousId = logical.id
  logical.id = 'resource.requirement.req.ui.main'
  logical.producerMode = 'derived'
  logical.value = {
    requirementId: 'req.ui.main',
    resourceKind: 'ui-asset',
    runtimeRole: 'screen',
  }
  logical.edges = logical.edges.map(edge =>
    edge.type === 'required-by'
      ? {
          ...edge,
          targetId: 'presentation.screen.main',
          targetType: 'presentation.ui-screen',
        }
      : edge,
  )
  for (const current of module.nodes)
    current.edges = current.edges.map(edge =>
      edge.targetId === previousId ? { ...edge, targetId: logical.id } : edge,
    )
  bindModule(module)
  logical.bindings = {
    '/id': {
      kind: 'derived',
      derivationRuleId: 'presentation-requirement-node-id',
      inputs: [
        {
          kind: 'external',
          moduleId: 'presentation',
          nodeId: 'presentation.screen.main',
          pointer: '/id',
          targetDigest: digestGameIrValue('presentation.screen.main'),
        },
      ],
    },
    '/value/requirementId': {
      kind: 'derived',
      derivationRuleId: 'presentation-requirement-id',
      inputs: [
        {
          kind: 'external',
          moduleId: 'presentation',
          nodeId: 'presentation.screen.main',
          pointer: '/value/requirements/0/requirementId',
          targetDigest: digestGameIrValue('req.ui.main'),
        },
      ],
    },
    '/value/resourceKind': {
      kind: 'derived',
      derivationRuleId: 'presentation-resource-kind',
      inputs: [
        {
          kind: 'external',
          moduleId: 'presentation',
          nodeId: 'presentation.screen.main',
          pointer: '/value/requirements/0/kind',
          targetDigest: digestGameIrValue('ui'),
        },
      ],
    },
    '/value/runtimeRole': {
      kind: 'derived',
      derivationRuleId: 'presentation-runtime-role',
      inputs: [
        {
          kind: 'external',
          moduleId: 'presentation',
          nodeId: 'presentation.screen.main',
          pointer: '/value/requirements/0/runtimeRole',
          targetDigest: digestGameIrValue('screen'),
        },
      ],
    },
    '/edges/0': {
      kind: 'derived',
      derivationRuleId: 'presentation-requirement-owner-edge',
      inputs: [
        {
          kind: 'external',
          moduleId: 'presentation',
          nodeId: 'presentation.screen.main',
          pointer: '/id',
          targetDigest: digestGameIrValue('presentation.screen.main'),
        },
      ],
    },
  }
  return module
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
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === artifact.id
            ? {
                ...node,
                value: {
                  ...node.value,
                  path: 'assets/runtime/player-model.glb\0suffix',
                },
              }
            : node,
        ),
      }),
    ).toThrow(/path/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === artifact.id
            ? {
                ...node,
                value: {
                  ...node.value,
                  path: 'assets/runtime/player-model.fbx',
                },
              }
            : node,
        ),
      }),
    ).toThrow(/extension|format/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === artifact.id
            ? {
                ...node,
                value: { ...node.value, codec: '' },
              }
            : node,
        ),
      }),
    ).toThrow(/codec/)
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
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === profile.id
            ? { ...node, value: { ...node.value, coverage: [] } }
            : node,
        ),
      }),
    ).toThrow(/coverage/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === profile.id
            ? { ...node, value: { ...node.value, coverage: [{}] } }
            : node,
        ),
      }),
    ).toThrow(/constraint|coverage/)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === profile.id
            ? {
                ...node,
                value: {
                  ...node.value,
                  capabilities: ['skinned'],
                  coverage: [{ assetKinds: ['model'] }],
                },
              }
            : node,
        ),
      }),
    ).toThrow(/capabilities|coverage/)
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

  test('admits only Core-bound prior target modules and complete source evidence', () => {
    const module = validModule()
    expect(() =>
      parseResourceRealizationModule(bindModule(structuredClone(module)), {
        request: request(),
        sections: [resourceSection],
      }),
    ).toThrow(/target|external/i)
    expect(() =>
      (
        parseResourceRealizationModule as unknown as (
          ...args: unknown[]
        ) => unknown
      )(
        bindModule(structuredClone(module)),
        { request: request(), sections: [resourceSection] },
        new Map([[externalEntity.id, externalEntity]]),
      ),
    ).toThrow(/target|external/i)

    for (const externalNode of [
      { ...externalEntity, kind: 'rogue.kind' },
      { ...externalEntity, kind: 'resource-realization.logical-resource' },
      {
        ...externalEntity,
        bindings: { '/id': externalEntity.bindings['/id']! },
      },
    ]) {
      expect(() =>
        parseResourceRealizationModule(module, {
          request: request(),
          sections: [resourceSection],
          externalModules: [{ moduleId: 'gameplay', nodes: [externalNode] }],
        }),
      ).toThrow(/target|kind|binding|leaf|external/i)
    }
    expect(() =>
      parseResourceRealizationModule(module, {
        request: request(),
        sections: [{ ...resourceSection, heading: 'forged index' }],
        externalModules: [{ moduleId: 'gameplay', nodes: [externalEntity] }],
      }),
    ).toThrow(/section|index|digest/i)
  })

  test('closes a dependency between raw prior modules through one Core parse', () => {
    const module = validModule()
    const balanceNode: GameIrNode = {
      id: 'balance.variable.player-health',
      kind: 'balance.variable',
      producerMode: 'derived',
      value: { value: 3 },
      references: [],
      edges: [],
      bindings: {
        '/id': {
          kind: 'derived',
          derivationRuleId: 'id-from-player-label',
          inputs: [
            {
              kind: 'external',
              moduleId: 'gameplay',
              nodeId: externalEntity.id,
              pointer: '/value/label',
              targetDigest: digestGameIrValue('Player'),
            },
          ],
        },
        '/value/value': {
          kind: 'derived',
          derivationRuleId: 'health-from-player',
          inputs: [
            {
              kind: 'external',
              moduleId: 'gameplay',
              nodeId: externalEntity.id,
              pointer: '/value/label',
              targetDigest: digestGameIrValue('Player'),
            },
          ],
        },
      },
    }
    expect(
      parseResourceRealizationModule(module, {
        request: request(),
        sections: [resourceSection],
        externalModules: [
          { moduleId: 'gameplay', nodes: [externalEntity] },
          { moduleId: 'balance', nodes: [balanceNode] },
        ],
      }).nodes,
    ).toHaveLength(5)
  })

  test('rejects duplicate artifact paths, missing target cardinality, and invalid sourcing policy', () => {
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
    const variant = module.nodes.find(node => node.kind.endsWith('.variant'))!
    const artifact = module.nodes.find(node =>
      node.kind.endsWith('delivery-artifact'),
    )!
    const duplicateArtifact = {
      ...artifact,
      id: 'resource.artifact.player-model.copy',
      edges: [
        {
          type: 'part-of',
          targetId: variant.id,
          targetType: variant.kind,
        },
      ],
    }
    expect(() =>
      parse({
        ...module,
        nodes: [...module.nodes, duplicateArtifact],
      }),
    ).toThrow(/path|duplicated/i)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.filter(node => node.id !== target.id),
      }),
    ).toThrow(/target/i)
    expect(() =>
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === logical.id ? { ...node, edges: [] } : node,
        ),
      }),
    ).toThrow(/required-by|target/i)
    const validSourcingPolicy = profile.value.sourcingPolicy as Record<
      string,
      unknown
    >
    for (const sourcingPolicy of [
      { ...validSourcingPolicy, allowedSourceKinds: [] },
      { ...validSourcingPolicy, handoffCriteria: [] },
      { ...validSourcingPolicy, allowedSourceKinds: ['unknown'] },
    ]) {
      expect(() =>
        parse({
          ...module,
          nodes: module.nodes.map(node =>
            node.id === profile.id
              ? {
                  ...node,
                  value: { ...node.value, sourcingPolicy },
                }
              : node,
          ),
        }),
      ).toThrow(/source|sourcing|handoff|admitted/i)
    }
  })

  test('rejects empty asset kinds, malformed codecs, constraints, and budgets', () => {
    const module = validModule()
    const profile = module.nodes.find(node =>
      node.kind.endsWith('acquisition-profile'),
    )!
    const artifact = module.nodes.find(node =>
      node.kind.endsWith('delivery-artifact'),
    )!
    const cases: Array<[string, MutableModule]> = [
      [
        'assetKinds',
        {
          ...module,
          nodes: module.nodes.map(node =>
            node.id === profile.id
              ? { ...node, value: { ...node.value, assetKinds: [] } }
              : node,
          ),
        },
      ],
      [
        'codec object',
        {
          ...module,
          nodes: module.nodes.map(node =>
            node.id === artifact.id
              ? { ...node, value: { ...node.value, codec: {} } }
              : node,
          ),
        },
      ],
      [
        'codec array',
        {
          ...module,
          nodes: module.nodes.map(node =>
            node.id === artifact.id
              ? { ...node, value: { ...node.value, codec: [] } }
              : node,
          ),
        },
      ],
      [
        'technicalConstraints',
        {
          ...module,
          nodes: module.nodes.map(node =>
            node.id === artifact.id
              ? { ...node, value: { ...node.value, technicalConstraints: [] } }
              : node,
          ),
        },
      ],
      [
        'budgets',
        {
          ...module,
          nodes: module.nodes.map(node =>
            node.id === artifact.id
              ? { ...node, value: { ...node.value, budgets: [] } }
              : node,
          ),
        },
      ],
    ]
    for (const [label, changed] of cases)
      expect(() => parse(changed), label).toThrow()
  })

  test('admits every legal assertion branch and rejects malformed assertion tables', () => {
    const module = validModule()
    const artifact = module.nodes.find(node =>
      node.kind.endsWith('delivery-artifact'),
    )!
    const assertions = [
      { name: 'a-eq-bool', assertion: { operator: 'eq', value: true } },
      { name: 'b-eq-number', assertion: { operator: 'eq', value: 1 } },
      { name: 'c-eq-string', assertion: { operator: 'eq', value: 'glb' } },
      {
        name: 'd-gte',
        assertion: { operator: 'gte', value: 1, unit: 'count' },
      },
      {
        name: 'e-lte',
        assertion: { operator: 'lte', value: 2, unit: 'count' },
      },
      {
        name: 'f-one-of-numbers',
        assertion: { operator: 'one-of', values: [1, 2] },
      },
      {
        name: 'g-one-of-strings',
        assertion: { operator: 'one-of', values: ['glb', 'standard'] },
      },
      {
        name: 'h-range',
        assertion: { operator: 'range', min: 1, max: 2, unit: 'count' },
      },
    ]
    expect(
      parse({
        ...module,
        nodes: module.nodes.map(node =>
          node.id === artifact.id
            ? {
                ...node,
                value: { ...node.value, technicalConstraints: assertions },
              }
            : node,
        ),
      }).nodes,
    ).toHaveLength(5)

    const malformed = [
      { operator: 'unknown', value: 1 },
      { operator: 'lte', value: Number.NaN, unit: 'count' },
      { operator: 'gte', value: Number.POSITIVE_INFINITY, unit: 'count' },
      { operator: 'lte', value: 1 },
      { operator: 'range', min: 2, max: 1, unit: 'count' },
      { operator: 'range', min: Number.NaN, max: 1, unit: 'count' },
      { operator: 'one-of', values: [] },
      { operator: 'one-of', values: [1, '2'] },
      { operator: 'one-of', values: [Number.NaN, 1] },
      { operator: 'one-of', values: [2, 1] },
      { operator: 'one-of', values: ['glb', 'glb'] },
    ]
    for (const assertion of malformed)
      expect(() =>
        parse({
          ...module,
          nodes: module.nodes.map(node =>
            node.id === artifact.id
              ? {
                  ...node,
                  value: {
                    ...node.value,
                    technicalConstraints: [{ name: 'constraint', assertion }],
                  },
                }
              : node,
          ),
        }),
      ).toThrow()
  })

  test('rejects negative, duplicate, and unsorted budgets and constraints', () => {
    const module = validModule()
    const artifact = module.nodes.find(node =>
      node.kind.endsWith('delivery-artifact'),
    )!
    const changes = [
      {
        budgets: [{ metric: 'file-size', limit: -1, unit: 'MB' }],
      },
      {
        budgets: [
          { metric: 'size', limit: 1, unit: 'MB' },
          { metric: 'size', limit: 2, unit: 'MB' },
        ],
      },
      {
        budgets: [
          { metric: 'size', limit: 1, unit: 'MB' },
          { metric: 'file-size', limit: 2, unit: 'MB' },
        ],
      },
      {
        technicalConstraints: [
          {
            name: 'z',
            assertion: { operator: 'gte', value: 1, unit: 'count' },
          },
          {
            name: 'a',
            assertion: { operator: 'gte', value: 1, unit: 'count' },
          },
        ],
      },
      {
        technicalConstraints: [
          {
            name: 'a',
            assertion: { operator: 'gte', value: 1, unit: 'count' },
          },
          {
            name: 'a',
            assertion: { operator: 'gte', value: 2, unit: 'count' },
          },
        ],
      },
    ]
    for (const value of changes)
      expect(() =>
        parse({
          ...module,
          nodes: module.nodes.map(node =>
            node.id === artifact.id
              ? { ...node, value: { ...node.value, ...value } }
              : node,
          ),
        }),
      ).toThrow()
  })

  test('accepts every entry from the shared resource vocabularies', () => {
    const profileFields = [
      ['dimensions', RESOURCE_DIMENSIONS],
      ['assetKinds', RESOURCE_ASSET_KINDS],
      ['usageTags', RESOURCE_USAGE_TAGS],
      ['capabilities', RESOURCE_CAPABILITIES],
    ] as const
    for (const [field, values] of profileFields) {
      const module = validModule()
      const profile = module.nodes.find(node =>
        node.kind.endsWith('acquisition-profile'),
      )!
      expect(() =>
        parse({
          ...module,
          nodes: module.nodes.map(node =>
            node.id === profile.id
              ? {
                  ...node,
                  value: { ...node.value, [field]: [...values].sort() },
                }
              : node,
          ),
        }),
      ).not.toThrow()
    }
    for (const [field, values] of [
      ['relationKinds', RESOURCE_RELATION_KINDS],
      ['embeddedKinds', RESOURCE_EMBEDDED_COMPONENT_KINDS],
    ] as const) {
      const module = validModule()
      const profile = module.nodes.find(node =>
        node.kind.endsWith('acquisition-profile'),
      )!
      expect(() =>
        parse({
          ...module,
          nodes: module.nodes.map(node =>
            node.id === profile.id
              ? {
                  ...node,
                  value: {
                    ...node.value,
                    capabilities: [],
                    coverage: [{ [field]: [...values].sort() }],
                  },
                }
              : node,
          ),
        }),
      ).not.toThrow()
    }
  })

  test('admits an expanded Resource graph without an arbitrary size limit', () => {
    const nodes = Array.from({ length: 64 }, (_, index) => {
      const prefix = `resource-${String(index).padStart(3, '0')}`
      const requirementId = `${prefix}-player-model`
      const copy = structuredClone(validModule()) as MutableModule
      const ids = new Map<string, string>()
      for (const current of copy.nodes) {
        const nextId = current.kind.endsWith('logical-resource')
          ? `resource.requirement.${requirementId}`
          : `${prefix}.${current.id}`
        ids.set(current.id, nextId)
        current.id = nextId
        if (current.kind.endsWith('logical-resource'))
          current.value.requirementId = requirementId
        if (current.kind.endsWith('delivery-artifact'))
          current.value.path = `assets/runtime/${prefix}-player-model.glb`
      }
      for (const current of copy.nodes)
        current.edges = current.edges.map(edge => ({
          ...edge,
          targetId: ids.get(edge.targetId) ?? edge.targetId,
        }))
      return copy.nodes.filter(
        current => index === 0 || !current.kind.endsWith('delivery-target'),
      )
    }).flat()
    expect(
      parse({ moduleId: 'resource-realization', nodes }).nodes,
    ).toHaveLength(257)
  })

  test('admits a logical resource derived from an exact Presentation requirement', () => {
    const module = derivedPresentationRequirementModule()
    expect(
      parseRaw(module, [
        {
          moduleId: 'gameplay',
          nodes: [externalEntity, externalGameplayState],
        },
        presentationRequirementModule(),
      ]).nodes,
    ).toHaveLength(5)
  })

  test('rejects a tampered Presentation requirement kind digest', () => {
    const module = derivedPresentationRequirementModule()
    const logical = module.nodes.find(node =>
      node.kind.endsWith('logical-resource'),
    )!
    const binding = logical.bindings['/value/resourceKind']!
    const input = (binding.inputs as Array<Record<string, unknown>>)[0]!
    input.targetDigest = digestGameIrValue('vfx')
    expect(() =>
      parseRaw(module, [
        {
          moduleId: 'gameplay',
          nodes: [externalEntity, externalGameplayState],
        },
        presentationRequirementModule(),
      ]),
    ).toThrow(/wrong target digest|digest/i)
  })

  test('requires every derived Presentation binding to preserve its rule and target leaf', () => {
    const cases = [
      {
        label: 'target prefix',
        pointer: '/id',
        mutate: (binding: Record<string, unknown>) => ({
          ...binding,
          inputs: [
            {
              ...(binding.inputs as Array<Record<string, unknown>>)[0]!,
              nodeId: 'presentation.screen.other',
            },
          ],
        }),
      },
      {
        label: 'target value digest',
        pointer: '/value/resourceKind',
        mutate: (binding: Record<string, unknown>) => ({
          ...binding,
          inputs: [
            {
              ...(binding.inputs as Array<Record<string, unknown>>)[0]!,
              targetDigest: digestGameIrValue('vfx'),
            },
          ],
        }),
      },
      {
        label: 'target pointer',
        pointer: '/value/runtimeRole',
        mutate: (binding: Record<string, unknown>) => ({
          ...binding,
          inputs: [
            {
              ...(binding.inputs as Array<Record<string, unknown>>)[0]!,
              pointer: '/value/requirements/0/kind',
            },
          ],
        }),
      },
      {
        label: 'target digest',
        pointer: '/value/requirementId',
        mutate: (binding: Record<string, unknown>) => ({
          ...binding,
          inputs: [
            {
              ...(binding.inputs as Array<Record<string, unknown>>)[0]!,
              targetDigest: digestGameIrValue('wrong-requirement'),
            },
          ],
        }),
      },
      {
        label: 'owner edge binding',
        pointer: '/edges/0',
        mutate: (binding: Record<string, unknown>) => ({
          ...binding,
          kind: 'owner',
        }),
      },
    ] as const
    for (const scenario of cases) {
      const module = derivedPresentationRequirementModule()
      const logical = module.nodes.find(node =>
        node.kind.endsWith('logical-resource'),
      )!
      logical.bindings[scenario.pointer] = scenario.mutate(
        logical.bindings[scenario.pointer]!,
      )
      expect(() =>
        parseRaw(module, [
          {
            moduleId: 'gameplay',
            nodes: [externalEntity, externalGameplayState],
          },
          presentationRequirementModule(),
        ]),
      ).toThrow(/binding|derived|digest|target|producer/i)
    }
  })
})
