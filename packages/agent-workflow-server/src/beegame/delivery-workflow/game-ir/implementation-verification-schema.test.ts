import { describe, expect, test } from 'bun:test'
import { digestSectionIndex } from '../foundation-section-index'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import {
  receiptDigest,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  digestGameIrValue,
  type GameIrNode,
  type GameIrSourceSection,
} from './model'
import {
  IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST,
  parseImplementationVerificationModule,
} from './implementation-verification-schema'

const digest = 'a'.repeat(64)
const section: GameIrSourceSection = {
  documentPath: 'docs/GDD.md',
  sectionId: 'gameplay',
  heading: 'Gameplay',
  startLine: 1,
  endLine: 10,
  digest,
}
function request(): GameIrCompileRequest {
  const foundation: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project',
    foundationRevision: 'revision',
    confirmedBriefDigest: digest,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, digest]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex([section]),
    authority: {
      kind: 'review',
      reviewDigest: digest,
      issueRegistryDigest: digest,
    },
  }
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'task',
    publicationId: 'publication',
    gameIrSchemaVersion: 'game-ir.v1',
    foundation: { ...foundation, receiptDigest: receiptDigest(foundation) },
  }
}
type MutableNode = {
  id: string
  kind: string
  producerMode: 'semantic'
  value: Record<string, unknown>
  references: Array<{ targetId: string; targetType: string }>
  edges: Array<{ type: string; targetId: string; targetType: string }>
  bindings: Record<string, Record<string, unknown>>
}
const e = (type: string, targetId: string, targetType: string) => ({
  type,
  targetId,
  targetType,
})
function leafPaths(value: unknown, path: string): string[] {
  if (Array.isArray(value))
    return value.length === 0
      ? [path]
      : value.flatMap((item, i) => leafPaths(item, `${path}/${i}`))
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length === 0
      ? [path]
      : entries.flatMap(([key, item]) => leafPaths(item, `${path}/${key}`))
  }
  return [path]
}
function bind(node: MutableNode): MutableNode {
  const pointers = [
    '/id',
    ...leafPaths(node.value, '/value'),
    ...node.references.map((_, i) => `/references/${i}`),
    ...node.edges.map((_, i) => `/edges/${i}`),
  ]
  node.bindings = Object.fromEntries(
    pointers.map(pointer => [
      pointer,
      {
        kind: 'owner',
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        sectionDigest: digest,
        sourcePointer: `/fixture${pointer}`,
      },
    ]),
  )
  return node
}
function node(
  id: string,
  kind: string,
  value: Record<string, unknown>,
  edges: MutableNode['edges'] = [],
): MutableNode {
  return bind({
    id,
    kind,
    producerMode: 'semantic',
    value,
    references: [],
    edges: edges.sort((a, b) =>
      `${a.type}\0${a.targetId}\0${a.targetType}`.localeCompare(
        `${b.type}\0${b.targetId}\0${b.targetType}`,
      ),
    ),
    bindings: {},
  })
}
function prior(): Array<{ moduleId: string; nodes: MutableNode[] }> {
  const gameplay = [
    node('gameplay.player', 'gameplay.entity', { label: 'Player' }),
    node('gameplay.state.playing', 'gameplay.state', {
      label: 'Playing',
      initial: true,
      terminal: 'none',
    }),
  ]
  const balance = [
    node('balance.unit.base', 'balance.unit', {
      symbol: 'u',
      dimensions: [],
      scale: { numerator: 1, denominator: 1 },
    }),
  ]
  const world = [
    node(
      'world-scene.node.root',
      'world-scene.node',
      {
        label: 'Root',
        nodeType: 'container',
        transform: {
          dimensions: '2d',
          space: 'world',
          position: { x: 0, y: 0 },
          rotationRadians: 0,
          scale: { x: 1, y: 1 },
        },
      },
      [e('scene', 'world-scene.scene.main', 'world-scene.scene')],
    ),
    node(
      'world-scene.scene.main',
      'world-scene.scene',
      {
        label: 'Main',
        coordinateConvention: {
          dimensions: '2d',
          xDirection: 'right',
          yDirection: 'up',
          distanceUnit: 'meter',
        },
      },
      [e('root', 'world-scene.node.root', 'world-scene.node')],
    ),
  ]
  const presentation = [
    node(
      'presentation.screen.main',
      'presentation.ui-screen',
      { label: 'Main', modal: false },
      [
        e('driven-by', 'gameplay.state.playing', 'gameplay.state'),
        e('initial-state', 'presentation.state.main', 'presentation.ui-state'),
      ],
    ),
    node(
      'presentation.state.main',
      'presentation.ui-state',
      { label: 'Main', terminal: false },
      [
        e('driven-by', 'gameplay.state.playing', 'gameplay.state'),
        e('screen', 'presentation.screen.main', 'presentation.ui-screen'),
      ],
    ),
  ]
  const resource = [
    node(
      'resource.requirement.player',
      'resource-realization.logical-resource',
      { requirementId: 'player', resourceKind: 'model', runtimeRole: 'player' },
      [e('required-by', 'gameplay.player', 'gameplay.entity')],
    ),
    node(
      'resource.profile.player',
      'resource-realization.acquisition-profile',
      {
        required: true,
        dimensions: ['3D'],
        assetKinds: ['model'],
        usageTags: ['character'],
        capabilities: ['skinned'],
        styles: ['stylized'],
        sourcingPolicy: {
          allowedSourceKinds: ['agent-authored'],
          licenseConstraints: ['project'],
          responsibleParty: 'team',
          handoffCriteria: ['ready'],
        },
      },
      [
        e(
          'describes',
          'resource.requirement.player',
          'resource-realization.logical-resource',
        ),
      ],
    ),
    node('resource.target.primary', 'resource-realization.delivery-target', {
      platform: 'desktop',
      runtime: 'web',
      assetFormatCapabilities: ['glb'],
    }),
    node(
      'resource.variant.player',
      'resource-realization.variant',
      { activation: { kind: 'required' } },
      [
        e(
          'realizes',
          'resource.requirement.player',
          'resource-realization.logical-resource',
        ),
      ],
    ),
    node(
      'resource.artifact.player',
      'resource-realization.delivery-artifact',
      {
        artifactClass: 'runtime-resource',
        path: 'assets/runtime/player.glb',
        format: 'glb',
        runtimeRole: 'player',
      },
      [e('part-of', 'resource.variant.player', 'resource-realization.variant')],
    ),
  ]
  return [
    { moduleId: 'gameplay', nodes: gameplay },
    { moduleId: 'balance', nodes: balance },
    { moduleId: 'world-scene', nodes: world },
    { moduleId: 'presentation', nodes: presentation },
    { moduleId: 'resource-realization', nodes: resource },
  ].map(module => ({
    ...module,
    nodes: module.nodes.sort((a, b) => a.id.localeCompare(b.id)),
  }))
}
function iv(
  id: string,
  kind: string,
  value: Record<string, unknown>,
  edges: MutableNode['edges'],
): MutableNode {
  return node(id, kind, value, edges)
}
function valid(): { moduleId: string; nodes: MutableNode[] } {
  const target = iv(
    'iv.target.runtime',
    'implementation-verification.target',
    {
      label: 'Runtime',
      runtime: 'web',
      platforms: ['desktop', 'web'],
      projectRoots: ['src', 'tests'],
    },
    [],
  )
  const logic = iv(
    'iv.unit.logic',
    'implementation-verification.unit',
    {
      label: 'Logic',
      responsibility: 'Own gameplay and balance logic',
      ownedPaths: ['src/gameplay'],
    },
    [
      e('implements', 'balance.unit.base', 'balance.unit'),
      e('implements', 'gameplay.player', 'gameplay.entity'),
      e('targets', target.id, target.kind),
    ],
  )
  const integration = iv(
    'iv.unit.integration',
    'implementation-verification.unit',
    {
      label: 'Integration',
      responsibility: 'Own integration',
      ownedPaths: ['tests/integration'],
    },
    [
      e('depends-on', logic.id, logic.kind),
      e('implements', 'gameplay.state.playing', 'gameplay.state'),
      e('implements', 'presentation.screen.main', 'presentation.ui-screen'),
      e('implements', 'presentation.state.main', 'presentation.ui-state'),
      e(
        'implements',
        'resource.artifact.player',
        'resource-realization.delivery-artifact',
      ),
      e(
        'implements',
        'resource.profile.player',
        'resource-realization.acquisition-profile',
      ),
      e(
        'implements',
        'resource.requirement.player',
        'resource-realization.logical-resource',
      ),
      e(
        'implements',
        'resource.target.primary',
        'resource-realization.delivery-target',
      ),
      e(
        'implements',
        'resource.variant.player',
        'resource-realization.variant',
      ),
      e('implements', 'world-scene.node.root', 'world-scene.node'),
      e('implements', 'world-scene.scene.main', 'world-scene.scene'),
      e('targets', target.id, target.kind),
    ],
  )
  const unitEvidence = iv(
    'iv.evidence.logic',
    'implementation-verification.evidence-requirement',
    {
      label: 'Unit tests',
      kind: 'unit-test',
      expected: 'Logic passes',
      artifactPaths: ['tests/unit'],
    },
    [e('owned-by', logic.id, logic.kind)],
  )
  const integrationEvidence = iv(
    'iv.evidence.integration',
    'implementation-verification.evidence-requirement',
    {
      label: 'Integration',
      kind: 'integration-test',
      expected: 'Flow passes',
      artifactPaths: ['tests/integration/results'],
    },
    [e('owned-by', integration.id, integration.kind)],
  )
  const scenarioLogic = iv(
    'iv.scenario.logic',
    'implementation-verification.acceptance-scenario',
    {
      label: 'Logic',
      precondition: 'Loaded',
      action: 'Advance',
      expectedOutcome: 'Updates',
    },
    [
      e('covers', 'balance.unit.base', 'balance.unit'),
      e('covers', 'gameplay.player', 'gameplay.entity'),
      e('owned-by', logic.id, logic.kind),
      e('proved-by', unitEvidence.id, unitEvidence.kind),
    ],
  )
  const scenarioIntegration = iv(
    'iv.scenario.integration',
    'implementation-verification.acceptance-scenario',
    {
      label: 'Integration',
      precondition: 'Launched',
      action: 'Run flow',
      expectedOutcome: 'Completes',
    },
    [
      e('covers', 'gameplay.state.playing', 'gameplay.state'),
      e('covers', 'presentation.screen.main', 'presentation.ui-screen'),
      e('covers', 'presentation.state.main', 'presentation.ui-state'),
      e(
        'covers',
        'resource.artifact.player',
        'resource-realization.delivery-artifact',
      ),
      e(
        'covers',
        'resource.profile.player',
        'resource-realization.acquisition-profile',
      ),
      e(
        'covers',
        'resource.requirement.player',
        'resource-realization.logical-resource',
      ),
      e(
        'covers',
        'resource.target.primary',
        'resource-realization.delivery-target',
      ),
      e('covers', 'resource.variant.player', 'resource-realization.variant'),
      e('covers', 'world-scene.node.root', 'world-scene.node'),
      e('covers', 'world-scene.scene.main', 'world-scene.scene'),
      e('owned-by', integration.id, integration.kind),
      e('proved-by', integrationEvidence.id, integrationEvidence.kind),
    ],
  )
  const invariant = iv(
    'iv.invariant.resource',
    'implementation-verification.invariant',
    {
      label: 'Resource',
      assertion: 'Resources remain addressable',
      scope: 'resource',
    },
    [
      e('constrains', integration.id, integration.kind),
      e(
        'constrains',
        'resource.requirement.player',
        'resource-realization.logical-resource',
      ),
      e('proved-by', integrationEvidence.id, integrationEvidence.kind),
    ],
  )
  return {
    moduleId: 'implementation-verification',
    nodes: [
      target,
      logic,
      integration,
      unitEvidence,
      integrationEvidence,
      scenarioLogic,
      scenarioIntegration,
      invariant,
    ].sort((a, b) => a.id.localeCompare(b.id)),
  }
}
function parseValid(module = valid(), modules = prior()): unknown {
  return parseImplementationVerificationModule(module, {
    request: request(),
    sections: [section],
    priorModules: modules,
  })
}
function mutate(
  module: ReturnType<typeof valid>,
  id: string,
  change: (node: MutableNode) => MutableNode,
): ReturnType<typeof valid> {
  return {
    ...module,
    nodes: module.nodes.map(node =>
      node.id === id ? change(structuredClone(node)) : node,
    ),
  }
}

describe('implementation-verification schema', () => {
  test('declares exactly five kinds and admits expanded graph with legal cross-domain edges', () => {
    expect(
      Object.keys(IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST),
    ).toHaveLength(5)
    const result = parseValid() as GameIrNode
    expect(
      (result as unknown as { nodes: readonly unknown[] }).nodes,
    ).toHaveLength(8)
  })
  test('freezes valid output', () => {
    expect(Object.isFrozen(parseValid())).toBe(true)
  })
  test('accepts same-unit and multi-evidence proof with integration transitive support', () => {
    const module = valid()
    const scenario = module.nodes.find(node => node.id === 'iv.scenario.logic')!
    scenario.edges.push(
      e(
        'proved-by',
        'iv.evidence.integration',
        'implementation-verification.evidence-requirement',
      ),
    )
    scenario.edges.sort((left, right) =>
      `${left.type}\0${left.targetId}\0${left.targetType}`.localeCompare(
        `${right.type}\0${right.targetId}\0${right.targetType}`,
      ),
    )
    bind(scenario)
    expect(parseValid(module)).toBeDefined()
  })
  test('rejects each forbidden or invalid value mutation', () => {
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.evidence.integration', node => ({
          ...node,
          value: { ...node.value, kind: 'snapshot' },
        })),
      ),
    ).toThrow(/evidence kind/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.evidence.integration', node => ({
          ...node,
          value: { ...node.value, status: 'passed' },
        })),
      ),
    ).toThrow(/status|binding/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.target.runtime', node => ({
          ...node,
          value: { ...node.value, projectRoots: ['src', 'src/game'] },
        })),
      ),
    ).toThrow(/overlap/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          value: { ...node.value, ownedPaths: ['../gameplay'] },
        })),
      ),
    ).toThrow(/path/)
  })
  test('rejects prior order and graph closure mutations', () => {
    const modules = prior()
    expect(() =>
      parseValid(valid(), [modules[1]!, modules[0]!, ...modules.slice(2)]),
    ).toThrow(/prior modules/)
    const duplicate = mutate(valid(), 'iv.unit.integration', node => ({
      ...node,
      edges: node.edges.map(item =>
        item.targetId === 'resource.artifact.player'
          ? {
              ...item,
              targetId: 'gameplay.player',
              targetType: 'gameplay.entity',
            }
          : item,
      ),
    }))
    expect(() => parseValid(duplicate)).toThrow(/ownership|implemented|sorted/)
    const cycle = mutate(valid(), 'iv.unit.integration', node => ({
      ...node,
      edges: node.edges.map(item =>
        item.type === 'depends-on' ? { ...item, targetId: node.id } : item,
      ),
    }))
    expect(() => parseValid(cycle)).toThrow(/cycle/)
  })
  test('rejects incomplete coverage, orphan units, and irrelevant proof owners', () => {
    const uncovered = mutate(valid(), 'iv.scenario.integration', node => ({
      ...node,
      edges: node.edges.filter(
        item => item.targetId !== 'resource.artifact.player',
      ),
    }))
    expect(() => parseValid(uncovered)).toThrow(/binding|prior|coverage/)
    const orphan = mutate(valid(), 'iv.scenario.integration', node => ({
      ...node,
      edges: node.edges.map(item =>
        item.type === 'owned-by'
          ? { ...item, targetId: 'iv.unit.logic' }
          : item,
      ),
    }))
    expect(() => parseValid(orphan)).toThrow(/orphan|support|proof/)
    const irrelevant = mutate(valid(), 'iv.evidence.integration', node => ({
      ...node,
      edges: node.edges.map(item =>
        item.type === 'owned-by'
          ? { ...item, targetId: 'iv.unit.logic' }
          : item,
      ),
    }))
    expect(() => parseValid(irrelevant)).toThrow(/irrelevant|proof|closure/)
  })
})
