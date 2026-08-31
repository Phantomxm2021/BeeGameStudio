import { describe, expect, test } from 'bun:test'
import { digestSectionIndex } from '../foundation-section-index'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { BALANCE_DOMAIN_MANIFEST } from './balance-schema'
import {
  receiptDigest,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  compareCodeUnits,
  digestGameIrValue,
  type GameIrNode,
  type GameIrSourceSection,
} from './model'
import {
  IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST,
  parseImplementationVerificationModule,
} from './implementation-verification-schema'
import { GAMEPLAY_DOMAIN_MANIFEST } from './gameplay-schema'
import { PRESENTATION_DOMAIN_MANIFEST } from './presentation-schema'
import { RESOURCE_REALIZATION_DOMAIN_MANIFEST } from './resource-realization-schema'
import { WORLD_SCENE_DOMAIN_MANIFEST } from './world-scene-schema'

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
      compareCodeUnits(
        `${a.type}\0${a.targetId}\0${a.targetType}`,
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
    nodes: module.nodes.sort((a, b) => compareCodeUnits(a.id, b.id)),
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
      e('constrains', 'gameplay.player', 'gameplay.entity'),
      e(
        'proved-by',
        'iv.evidence.logic',
        'implementation-verification.evidence-requirement',
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
    ].sort((a, b) => compareCodeUnits(a.id, b.id)),
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
  const nodes = module.nodes.map(node =>
    node.id === id ? change(structuredClone(node)) : structuredClone(node),
  )
  return {
    ...module,
    nodes: nodes
      .map(item => {
        item.edges.sort((left, right) =>
          compareCodeUnits(
            `${left.type}\0${left.targetId}\0${left.targetType}`,
            `${right.type}\0${right.targetId}\0${right.targetType}`,
          ),
        )
        return bind(item)
      })
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
  }
}
function rebuildPrior(
  modules: ReturnType<typeof prior>,
): ReturnType<typeof prior> {
  return modules.map(module => ({
    ...module,
    nodes: module.nodes
      .map(node => bind(structuredClone(node)))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
  }))
}
function addNode(
  module: ReturnType<typeof valid>,
  extra: MutableNode,
): ReturnType<typeof valid> {
  return {
    ...module,
    nodes: [...module.nodes, bind(structuredClone(extra))].sort((a, b) =>
      compareCodeUnits(a.id, b.id),
    ),
  }
}
function expanded(): ReturnType<typeof valid> {
  let module = valid()
  for (let index = 0; index < 12; index += 1) {
    const suffix = String(index).padStart(2, '0')
    const evidence = iv(
      `iv.evidence.expanded.${suffix}`,
      'implementation-verification.evidence-requirement',
      {
        label: `Expanded evidence ${suffix}`,
        kind: 'integration-test',
        expected: `Expanded proof ${suffix}`,
        artifactPaths: [`tests/expanded/${suffix}`],
      },
      [
        e(
          'owned-by',
          'iv.unit.integration',
          'implementation-verification.unit',
        ),
      ],
    )
    const scenario = iv(
      `iv.scenario.expanded.${suffix}`,
      'implementation-verification.acceptance-scenario',
      {
        label: `Expanded scenario ${suffix}`,
        precondition: 'Launched',
        action: 'Run expanded flow',
        expectedOutcome: 'Completes',
      },
      [
        e('covers', 'gameplay.player', 'gameplay.entity'),
        e(
          'owned-by',
          'iv.unit.integration',
          'implementation-verification.unit',
        ),
        e(
          'proved-by',
          evidence.id,
          'implementation-verification.evidence-requirement',
        ),
      ],
    )
    module = addNode(addNode(module, evidence), scenario)
  }
  return module
}

describe('implementation-verification schema', () => {
  test('declares exactly five kinds and admits expanded graph with legal cross-domain edges', () => {
    expect(
      Object.keys(IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST),
    ).toHaveLength(5)
    const priorKinds = [
      ...Object.keys(GAMEPLAY_DOMAIN_MANIFEST),
      ...Object.keys(BALANCE_DOMAIN_MANIFEST),
      ...Object.keys(WORLD_SCENE_DOMAIN_MANIFEST),
      ...Object.keys(PRESENTATION_DOMAIN_MANIFEST),
      ...Object.keys(RESOURCE_REALIZATION_DOMAIN_MANIFEST),
    ].sort(compareCodeUnits)
    const unitRelationships =
      IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST[
        'implementation-verification.unit'
      ].relationships
    const scenarioRelationships =
      IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST[
        'implementation-verification.acceptance-scenario'
      ].relationships
    const invariantRelationships =
      IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST[
        'implementation-verification.invariant'
      ].relationships
    expect(unitRelationships.implements.targetKinds).toEqual(priorKinds)
    expect(unitRelationships.implements.targetKinds.length).toBeGreaterThan(0)
    expect(scenarioRelationships.covers.targetKinds).toEqual(priorKinds)
    expect(scenarioRelationships.covers.targetKinds.length).toBeGreaterThan(0)
    expect(invariantRelationships.constrains.targetKinds).toEqual(
      [...priorKinds, 'implementation-verification.unit'].sort(
        compareCodeUnits,
      ),
    )
    expect(
      invariantRelationships.constrains.targetKinds.length,
    ).toBeGreaterThan(priorKinds.length)
    const result = parseValid() as GameIrNode
    expect(
      (result as unknown as { nodes: readonly unknown[] }).nodes,
    ).toHaveLength(8)
    expect(
      (parseValid(expanded()) as unknown as { nodes: readonly unknown[] })
        .nodes,
    ).toHaveLength(32)
  })
  test('freezes valid output', () => {
    expect(Object.isFrozen(parseValid())).toBe(true)
  })
  test('requires canonical sorted unique arrays and segment-safe paths', () => {
    expect(
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          value: {
            ...node.value,
            ownedPaths: ['src/game', 'src/gameplay'],
          },
        })),
      ),
    ).toBeDefined()
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          value: {
            ...node.value,
            ownedPaths: ['src/gameplay', 'src/gameplay/logic'],
          },
        })),
      ),
    ).toThrow(/unit ownedPaths overlap/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.target.runtime', node => ({
          ...node,
          value: { ...node.value, platforms: ['web', 'desktop'] },
        })),
      ),
    ).toThrow(/platforms must be unique and sorted/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.target.runtime', node => ({
          ...node,
          value: { ...node.value, projectRoots: ['src', 'src'] },
        })),
      ),
    ).toThrow(/projectRoots must be unique and sorted/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.target.runtime', node => ({
          ...node,
          value: { ...node.value, projectRoots: ['tests', 'src'] },
        })),
      ),
    ).toThrow(/projectRoots must be unique and sorted/)
    const invalidPaths = [
      '/absolute',
      'C:/drive',
      'src\\game',
      'src//game',
      'src/./game',
      'src/../game',
      '',
    ]
    for (const invalidPath of invalidPaths)
      expect(() =>
        parseValid(
          mutate(valid(), 'iv.unit.logic', node => ({
            ...node,
            value: { ...node.value, ownedPaths: [invalidPath] },
          })),
        ),
      ).toThrow(
        invalidPath === ''
          ? /ownedPaths\[0\] must be non-empty text/
          : /ownedPaths\[0\] must be a safe project-relative path/,
      )
  })
  test('rejects node references because relationships are manifest edges', () => {
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          references: [
            { targetId: 'gameplay.player', targetType: 'gameplay.entity' },
          ],
        })),
      ),
    ).toThrow(/node iv.unit.logic references must be empty; use manifest edges/)
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
      compareCodeUnits(
        `${left.type}\0${left.targetId}\0${left.targetType}`,
        `${right.type}\0${right.targetId}\0${right.targetType}`,
      ),
    )
    bind(scenario)
    expect(parseValid(module)).toBeDefined()
  })
  test('rejects unknown roles, wrong target kinds, duplicate edges, and cardinality', () => {
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          edges: [
            ...node.edges,
            e('unknown-role', 'gameplay.player', 'gameplay.entity'),
          ],
        })),
      ),
    ).toThrow(/node iv.unit.logic has unknown relationship role unknown-role/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          edges: (() => {
            let changed = false
            return node.edges.map(item => {
              if (item.type !== 'implements' || changed) return item
              changed = true
              return e(
                item.type,
                'iv.target.runtime',
                'implementation-verification.target',
              )
            })
          })(),
        })),
      ),
    ).toThrow(/node iv.unit.logic role implements has wrong target kind/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          edges: [node.edges[0]!, ...node.edges],
        })),
      ),
    ).toThrow(/node iv.unit.logic edges must be unique and sorted/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          edges: node.edges.filter(item => item.type !== 'targets'),
        })),
      ),
    ).toThrow(/node iv.unit.logic relationship targets has invalid cardinality/)
  })
  test('rejects exact-field, empty-value, and invalid-scope mutations', () => {
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.evidence.integration', node => ({
          ...node,
          value: { ...node.value, kind: 'snapshot' },
        })),
      ),
    ).toThrow(/node iv\.evidence\.integration evidence kind is invalid/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.evidence.integration', node => ({
          ...node,
          value: { ...node.value, status: 'passed' },
        })),
      ),
    ).toThrow(
      /node iv\.evidence\.integration value has unknown or missing fields/,
    )
    for (const forbiddenField of ['result', 'command', 'actual'])
      expect(() =>
        parseValid(
          mutate(valid(), 'iv.evidence.integration', node => ({
            ...node,
            value: { ...node.value, [forbiddenField]: 'forbidden' },
          })),
        ),
      ).toThrow(
        /node iv\.evidence\.integration value has unknown or missing fields/,
      )
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.target.runtime', node => ({
          ...node,
          value: { ...node.value, projectRoots: ['src', 'src/game'] },
        })),
      ),
    ).toThrow(/node iv\.target\.runtime projectRoots overlap/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          value: { ...node.value, ownedPaths: ['../gameplay'] },
        })),
      ),
    ).toThrow(/ownedPaths\[0\] must be a safe project-relative path/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.invariant.resource', node => ({
          ...node,
          value: { ...node.value, scope: 'invalid' },
        })),
      ),
    ).toThrow(/node iv\.invariant\.resource scope is invalid/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.unit.logic', node => ({
          ...node,
          value: { ...node.value, ownedPaths: [] },
        })),
      ),
    ).toThrow(/ownedPaths must be a non-empty array/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.scenario.logic', node => ({
          ...node,
          value: { ...node.value, label: '' },
        })),
      ),
    ).toThrow(/label must be non-empty text/)
    expect(() =>
      parseValid(
        mutate(valid(), 'iv.evidence.integration', node => ({
          ...node,
          value: { ...node.value, artifactPaths: [] },
        })),
      ),
    ).toThrow(/artifactPaths must be a non-empty array/)
  })
  test('rejects prior order and graph closure mutations', () => {
    const modules = prior()
    expect(() =>
      parseValid(valid(), [modules[1]!, modules[0]!, ...modules.slice(2)]),
    ).toThrow(/prior modules must follow the Phase 6 sequence/)
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
    expect(() => parseValid(duplicate)).toThrow(
      /prior node gameplay\.player is implemented more than once/,
    )
    const missing = mutate(valid(), 'iv.unit.integration', node => ({
      ...node,
      edges: node.edges.filter(
        item => item.targetId !== 'resource.variant.player',
      ),
    }))
    expect(() => parseValid(missing)).toThrow(
      /implementation ownership must cover every prior node exactly once/,
    )
    const cycle = mutate(valid(), 'iv.unit.integration', node => ({
      ...node,
      edges: node.edges.map(item =>
        item.type === 'depends-on' ? { ...item, targetId: node.id } : item,
      ),
    }))
    expect(() => parseValid(cycle)).toThrow(/unit dependencies contain a cycle/)
  })
  test('binds each prior moduleId to its concrete parser for same-kind malformed nodes', () => {
    const malformedCases = [
      ['gameplay', 'gameplay.player'],
      ['balance', 'balance.unit.base'],
      ['world-scene', 'world-scene.scene.main'],
      ['presentation', 'presentation.screen.main'],
      ['resource-realization', 'resource.artifact.player'],
    ] as const
    for (const [moduleId, nodeId] of malformedCases) {
      const malformed = rebuildPrior(
        prior().map(module =>
          module.moduleId === moduleId
            ? {
                ...module,
                nodes: module.nodes.map(node =>
                  node.id === nodeId
                    ? { ...node, value: { ...node.value, unexpected: true } }
                    : node,
                ),
              }
            : module,
        ),
      )
      expect(() => parseValid(valid(), malformed)).toThrow(
        new RegExp(
          `node ${nodeId.replaceAll('.', '\\.')} value has unknown or missing fields`,
        ),
      )
    }
  })
  test('accepts prior-node support closure and rejects coverage/proof/orphan violations', () => {
    const priorOnlyInvariant = mutate(
      valid(),
      'iv.invariant.resource',
      node => ({
        ...node,
        edges: node.edges.filter(
          item =>
            !(
              item.type === 'constrains' &&
              item.targetId === 'iv.unit.integration'
            ),
        ),
      }),
    )
    expect(parseValid(priorOnlyInvariant)).toBeDefined()
    const uncovered = mutate(valid(), 'iv.scenario.integration', node => ({
      ...node,
      edges: node.edges.filter(
        item => item.targetId !== 'resource.artifact.player',
      ),
    }))
    expect(() => parseValid(uncovered)).toThrow(
      /every prior node must be scenario-covered or invariant-constrained/,
    )
    const unsupportedScenario = mutate(
      valid(),
      'iv.scenario.integration',
      node => ({
        ...node,
        edges: node.edges.map(item =>
          item.type === 'owned-by'
            ? { ...item, targetId: 'iv.unit.logic' }
            : item,
        ),
      }),
    )
    expect(() => parseValid(unsupportedScenario)).toThrow(
      /scenario iv\.scenario\.integration does not support covered prior node/,
    )
    const incomplete = mutate(valid(), 'iv.invariant.resource', node => ({
      ...node,
      edges: node.edges.filter(
        item =>
          !(
            item.type === 'proved-by' &&
            item.targetId === 'iv.evidence.integration'
          ),
      ),
    }))
    expect(() => parseValid(incomplete)).toThrow(
      /subject iv.invariant.resource proof closure is incomplete/,
    )
    const irrelevant = mutate(valid(), 'iv.evidence.integration', node => ({
      ...node,
      edges: node.edges.map(item =>
        item.type === 'owned-by'
          ? { ...item, targetId: 'iv.unit.logic' }
          : item,
      ),
    }))
    expect(() => parseValid(irrelevant)).toThrow(
      /subject iv.scenario.integration has irrelevant proof owner/,
    )
    const evidenceOrphan = addNode(
      valid(),
      iv(
        'iv.evidence.orphan',
        'implementation-verification.evidence-requirement',
        {
          label: 'Orphan evidence',
          kind: 'build',
          expected: 'Build passes',
        },
        [e('owned-by', 'iv.unit.logic', 'implementation-verification.unit')],
      ),
    )
    expect(() => parseValid(evidenceOrphan)).toThrow(
      /evidence iv\.evidence\.orphan is orphaned/,
    )
  })
})
