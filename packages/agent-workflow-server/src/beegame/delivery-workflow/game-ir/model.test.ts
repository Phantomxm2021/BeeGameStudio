import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  canonicalizeGameIrSourceSections,
  canonicalGameIrJson,
  digestGameIrValue,
  parseGameIrTargetPointer,
  parseGameIrModuleCandidate,
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrSourceBinding,
  type GameIrSourceSection,
} from './model'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { digestSectionIndex } from '../foundation-section-index'

const digest = 'a'.repeat(64)
const sectionDigest = 'b'.repeat(64)
const technicalSectionDigest = 'c'.repeat(64)

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function receiptWithoutDigest(): Omit<FoundationReadyReceipt, 'receiptDigest'> {
  return {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: digest,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, digest]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(sectionIndex),
    authority: {
      kind: 'review',
      reviewDigest: digest,
      issueRegistryDigest: digest,
    },
  }
}

const sectionIndex: readonly GameIrSourceSection[] = [
  {
    documentPath: 'docs/GDD.md',
    sectionId: 'core-loop',
    heading: 'Core Loop',
    startLine: 1,
    endLine: 4,
    digest: sectionDigest,
  },
  {
    documentPath: 'docs/TECHNICAL_DESIGN.md',
    sectionId: 'runtime-states',
    heading: 'Runtime States',
    startLine: 1,
    endLine: 5,
    digest: technicalSectionDigest,
  },
]

function request(): GameIrCompileRequest {
  const foundation = receiptWithoutDigest()
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

const sections = sectionIndex

function candidate(overrides: Partial<GameIrCandidate> = {}): GameIrCandidate {
  return {
    schemaVersion: GAME_IR_SCHEMA_VERSION,
    taskId: 'compile-task-1',
    foundationRevision: 'foundation-revision-1',
    modules: [
      {
        moduleId: 'gameplay',
        nodes: [
          {
            id: 'player',
            kind: 'entity',
            producerMode: 'mechanical',
            value: {
              health: 3,
              state: { initial: 'ready' },
            },
            references: [],
            edges: [],
            bindings: {
              '/id': {
                kind: 'owner',
                documentPath: 'docs/GDD.md',
                sectionId: 'core-loop',
                sectionDigest: sectionDigest,
                sourcePointer: '/entities/player',
              },
              '/value/health': {
                kind: 'owner',
                documentPath: 'docs/GDD.md',
                sectionId: 'core-loop',
                sectionDigest: sectionDigest,
                sourcePointer: '/entities/player/health',
              },
              '/value/state/initial': {
                kind: 'owner',
                documentPath: 'docs/GDD.md',
                sectionId: 'core-loop',
                sectionDigest: sectionDigest,
                sourcePointer: '/entities/player/state',
              },
            },
          },
        ],
      },
    ],
    ...overrides,
  }
}

function derivedCandidate(
  overrides: Partial<GameIrCandidate['modules'][number]['nodes'][number]> = {},
): GameIrCandidate {
  const base = candidate()
  const node = base.modules[0]!.nodes[0]!
  const anchor = {
    ...node,
    id: 'zz-anchor',
    value: { health: 1, state: { initial: 'ready' } },
  }
  return candidate({
    modules: [
      {
        ...base.modules[0]!,
        nodes: [
          {
            ...node,
            producerMode: 'derived',
            value: { score: 3 },
            bindings: {
              '/id': {
                kind: 'derived',
                derivationRuleId: 'identity-from-anchor',
                inputs: [
                  {
                    kind: 'external',
                    moduleId: 'gameplay',
                    nodeId: 'zz-anchor',
                    pointer: '/id',
                    targetDigest: digestGameIrValue('zz-anchor'),
                  },
                ],
              },
              '/value/score': {
                kind: 'derived',
                derivationRuleId: 'score-from-id',
                inputs: [{ kind: 'local', pointer: '/id' }],
              },
            },
            ...overrides,
          },
          anchor,
        ],
      },
    ],
  })
}

describe('Game IR core candidate and source authority', () => {
  test('defines one code-unit canonical Section Index order for every caller permutation', () => {
    const reversed = [...sections].reverse()
    expect(canonicalizeGameIrSourceSections(sections)).toEqual([...sections])
    expect(canonicalizeGameIrSourceSections(reversed)).toEqual([...sections])
    expect(reversed).toEqual([...sections].reverse())
    expect(() =>
      canonicalizeGameIrSourceSections([...sections, sections[0]!]),
    ).toThrow(/duplicate|section/i)
  })

  test('admits one isolated module and checks its expected identity', () => {
    const rawGameplayModule = candidate().modules[0]!
    const module = parseGameIrModuleCandidate(rawGameplayModule, {
      request: request(),
      sections,
      expectedModuleId: 'gameplay',
    })
    expect(module.moduleId).toBe('gameplay')
    expect(module.nodes).toHaveLength(1)
    expect(() =>
      parseGameIrModuleCandidate(rawGameplayModule, {
        request: request(),
        sections,
        expectedModuleId: 'balance',
      }),
    ).toThrow(/module/i)
  })

  test('admits derived inputs from a raw prior module with an exact leaf digest', () => {
    const source = candidate().modules[0]!.nodes[0]!
    const externalNode = {
      ...source,
      id: 'balance-source',
      value: { health: 9 },
      bindings: {
        '/id': source.bindings['/id']!,
        '/value/health': source.bindings['/value/health']!,
      },
    }
    const externalModule = {
      moduleId: 'balance',
      nodes: [externalNode],
    }
    const localModule = derivedCandidate({
      bindings: {
        '/id': {
          kind: 'derived',
          derivationRuleId: 'identity-from-balance',
          inputs: [
            {
              kind: 'external',
              moduleId: 'balance',
              nodeId: 'balance-source',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(9),
            },
          ],
        },
        '/value/score': {
          kind: 'derived',
          derivationRuleId: 'score-from-balance',
          inputs: [
            {
              kind: 'external',
              moduleId: 'balance',
              nodeId: 'balance-source',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(9),
            },
          ],
        },
      },
    }).modules[0]!
    expect(
      parseGameIrModuleCandidate(localModule, {
        request: request(),
        sections,
        externalModules: [externalModule],
      }),
    ).toBeTruthy()
    expect(() =>
      parseGameIrModuleCandidate(localModule, {
        request: request(),
        sections,
        externalModules: [externalModule],
      }),
    ).not.toThrow()
    expect(() =>
      parseGameIrModuleCandidate(
        {
          ...localModule,
          nodes: [
            {
              ...localModule.nodes[0]!,
              bindings: {
                ...localModule.nodes[0]!.bindings,
                '/value/score': {
                  ...(localModule.nodes[0]!.bindings['/value/score'] as object),
                  inputs: [
                    {
                      kind: 'external',
                      moduleId: 'balance',
                      nodeId: 'balance-source',
                      pointer: '/value/health',
                      targetDigest: digestGameIrValue(8),
                    },
                  ],
                },
              },
            },
          ],
        },
        { request: request(), sections, externalModules: [externalModule] },
      ),
    ).toThrow(/digest/i)
  })

  test('requires canonical input ordering and rejects a cross-module dependency cycle', () => {
    const source = candidate().modules[0]!.nodes[0]!
    const externalNode = {
      ...source,
      id: 'balance-source',
      value: { health: 9 },
      bindings: {
        '/id': source.bindings['/id']!,
        '/value/health': source.bindings['/value/health']!,
      },
    }
    const external = {
      moduleId: 'balance',
      nodes: [externalNode],
    }
    const derived = derivedCandidate({
      value: { score: 3, other: 4 },
      bindings: {
        '/id': {
          kind: 'derived',
          derivationRuleId: 'identity-from-balance',
          inputs: [
            {
              kind: 'external',
              moduleId: 'balance',
              nodeId: 'balance-source',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(9),
            },
          ],
        },
        '/value/score': {
          kind: 'derived',
          derivationRuleId: 'ordered-inputs',
          inputs: [
            {
              kind: 'external',
              moduleId: 'balance',
              nodeId: 'balance-source',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(9),
            },
            { kind: 'local', pointer: '/id' },
          ],
        },
        '/value/other': {
          kind: 'derived',
          derivationRuleId: 'other-from-id',
          inputs: [{ kind: 'local', pointer: '/id' }],
        },
      },
    }).modules[0]!
    expect(
      parseGameIrModuleCandidate(derived, {
        request: request(),
        sections,
        externalModules: [external],
      }),
    ).toBeTruthy()

    const reversed = {
      ...derived,
      nodes: [
        {
          ...derived.nodes[0]!,
          bindings: {
            ...derived.nodes[0]!.bindings,
            '/value/score': {
              ...(derived.nodes[0]!.bindings['/value/score'] as object),
              inputs: [
                { kind: 'local', pointer: '/id' },
                {
                  kind: 'external',
                  moduleId: 'balance',
                  nodeId: 'balance-source',
                  pointer: '/value/health',
                  targetDigest: digestGameIrValue(9),
                },
              ],
            },
          },
        },
      ],
    }
    expect(() =>
      parseGameIrModuleCandidate(reversed, {
        request: request(),
        sections,
        externalModules: [external],
      }),
    ).toThrow(/sorted|unique/i)

    const gameplayCycle = {
      ...derived,
      nodes: [
        {
          ...derived.nodes[0]!,
          id: 'gameplay-derived',
          value: { score: 3 },
          bindings: {
            '/id': {
              kind: 'derived',
              derivationRuleId: 'gameplay-id-from-balance',
              inputs: [
                {
                  kind: 'external',
                  moduleId: 'balance',
                  nodeId: 'balance-derived',
                  pointer: '/value/score',
                  targetDigest: digestGameIrValue(4),
                },
              ],
            },
            '/value/score': {
              kind: 'derived',
              derivationRuleId: 'gameplay-from-balance',
              inputs: [
                {
                  kind: 'external',
                  moduleId: 'balance',
                  nodeId: 'balance-derived',
                  pointer: '/value/score',
                  targetDigest: digestGameIrValue(4),
                },
              ],
            },
          },
        },
      ],
    }
    const balanceCycle = {
      moduleId: 'balance',
      nodes: [
        {
          ...source,
          id: 'balance-derived',
          producerMode: 'derived' as const,
          value: { score: 4 },
          bindings: {
            '/id': {
              kind: 'derived' as const,
              derivationRuleId: 'balance-id-from-gameplay',
              inputs: [
                {
                  kind: 'external' as const,
                  moduleId: 'gameplay' as const,
                  nodeId: 'gameplay-derived',
                  pointer: '/value/score',
                  targetDigest: digestGameIrValue(3),
                },
              ],
            },
            '/value/score': {
              kind: 'derived' as const,
              derivationRuleId: 'balance-from-gameplay',
              inputs: [
                {
                  kind: 'external' as const,
                  moduleId: 'gameplay' as const,
                  nodeId: 'gameplay-derived',
                  pointer: '/value/score',
                  targetDigest: digestGameIrValue(3),
                },
              ],
            },
          },
        },
      ],
    }
    expect(() =>
      parseGameIrCandidate(
        {
          schemaVersion: GAME_IR_SCHEMA_VERSION,
          taskId: 'compile-task-1',
          foundationRevision: 'foundation-revision-1',
          modules: [balanceCycle, gameplayCycle],
        },
        { request: request(), sections },
      ),
    ).toThrow(/cycle/i)
  })

  test('admits a same-module external reference to a different node', () => {
    const ownerNode = candidate().modules[0]!.nodes[0]!
    const sourceNode = {
      ...ownerNode,
      id: 'source-node',
      value: { health: 9 },
      bindings: {
        '/id': ownerNode.bindings['/id']!,
        '/value/health': ownerNode.bindings['/value/health']!,
      },
    }
    const derivedNode = {
      ...ownerNode,
      id: 'derived-node',
      producerMode: 'derived' as const,
      value: { score: 3 },
      bindings: {
        '/id': {
          kind: 'derived' as const,
          derivationRuleId: 'identity-from-source',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'source-node',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(9),
            },
          ],
        },
        '/value/score': {
          kind: 'derived' as const,
          derivationRuleId: 'same-module-copy',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'source-node',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(9),
            },
          ],
        },
      },
    }
    expect(
      parseGameIrCandidate(
        {
          schemaVersion: GAME_IR_SCHEMA_VERSION,
          taskId: 'compile-task-1',
          foundationRevision: 'foundation-revision-1',
          modules: [{ moduleId: 'gameplay', nodes: [derivedNode, sourceNode] }],
        },
        { request: request(), sections },
      ),
    ).toBeTruthy()
    expect(
      parseGameIrModuleCandidate(
        { moduleId: 'gameplay', nodes: [derivedNode, sourceNode] },
        { request: request(), sections },
      ),
    ).toBeTruthy()
  })

  test('rejects missing, non-leaf, self, and unavailable external targets', () => {
    const ownerNode = candidate().modules[0]!.nodes[0]!
    const derivedNode = {
      ...ownerNode,
      id: 'derived-node',
      producerMode: 'derived' as const,
      value: { score: 3 },
      bindings: {
        '/id': {
          kind: 'derived' as const,
          derivationRuleId: 'identity-from-source',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'source-node',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(9),
            },
          ],
        },
        '/value/score': {
          kind: 'derived' as const,
          derivationRuleId: 'external-target',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'balance' as const,
              nodeId: 'missing-node',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(9),
            },
          ],
        },
      },
    }
    const localModule = { moduleId: 'gameplay', nodes: [derivedNode] }
    expect(() =>
      parseGameIrModuleCandidate(localModule, { request: request(), sections }),
    ).toThrow(/module|node|external/i)

    const sourceNode = {
      ...ownerNode,
      id: 'source-node',
      value: { health: 9 },
      bindings: {
        '/id': ownerNode.bindings['/id']!,
        '/value/health': ownerNode.bindings['/value/health']!,
      },
    }
    const external = { moduleId: 'balance', nodes: [sourceNode] }
    const nonLeaf = {
      ...localModule,
      nodes: [
        {
          ...derivedNode,
          bindings: {
            ...derivedNode.bindings,
            '/id': {
              kind: 'derived' as const,
              derivationRuleId: 'identity-from-source',
              inputs: [
                {
                  kind: 'external' as const,
                  moduleId: 'balance' as const,
                  nodeId: 'source-node',
                  pointer: '/value/health',
                  targetDigest: digestGameIrValue(9),
                },
              ],
            },
            '/value/score': {
              ...derivedNode.bindings['/value/score'],
              inputs: [
                {
                  kind: 'external' as const,
                  moduleId: 'balance' as const,
                  nodeId: 'source-node',
                  pointer: '/value',
                  targetDigest: digestGameIrValue({ health: 9 }),
                },
              ],
            },
          },
        },
      ],
    }
    expect(() =>
      parseGameIrModuleCandidate(nonLeaf, {
        request: request(),
        sections,
        externalModules: [external],
      }),
    ).toThrow(/leaf/i)

    const self = {
      ...localModule,
      nodes: [
        {
          ...derivedNode,
          bindings: {
            ...derivedNode.bindings,
            '/id': {
              kind: 'derived' as const,
              derivationRuleId: 'self-id',
              inputs: [
                {
                  kind: 'external' as const,
                  moduleId: 'gameplay' as const,
                  nodeId: 'derived-node',
                  pointer: '/value/score',
                  targetDigest: digestGameIrValue(3),
                },
              ],
            },
            '/value/score': {
              ...derivedNode.bindings['/value/score'],
              inputs: [
                {
                  kind: 'external' as const,
                  moduleId: 'gameplay' as const,
                  nodeId: 'derived-node',
                  pointer: '/value/score',
                  targetDigest: digestGameIrValue(3),
                },
              ],
            },
          },
        },
      ],
    }
    expect(() =>
      parseGameIrCandidate(
        {
          schemaVersion: GAME_IR_SCHEMA_VERSION,
          taskId: 'compile-task-1',
          foundationRevision: 'foundation-revision-1',
          modules: [self],
        },
        { request: request(), sections },
      ),
    ).toThrow(/self|cycle/i)

    const cycleA = {
      ...derivedNode,
      id: 'cycle-a',
      bindings: {
        '/id': {
          kind: 'derived' as const,
          derivationRuleId: 'cycle-a-id',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'cycle-b',
              pointer: '/value/score',
              targetDigest: digestGameIrValue(4),
            },
          ],
        },
        '/value/score': {
          kind: 'derived' as const,
          derivationRuleId: 'cycle-a',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'cycle-b',
              pointer: '/value/score',
              targetDigest: digestGameIrValue(4),
            },
          ],
        },
      },
    }
    const cycleB = {
      ...derivedNode,
      id: 'cycle-b',
      value: { score: 4 },
      bindings: {
        '/id': {
          kind: 'derived' as const,
          derivationRuleId: 'cycle-b-id',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'cycle-a',
              pointer: '/value/score',
              targetDigest: digestGameIrValue(3),
            },
          ],
        },
        '/value/score': {
          kind: 'derived' as const,
          derivationRuleId: 'cycle-b',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'cycle-a',
              pointer: '/value/score',
              targetDigest: digestGameIrValue(3),
            },
          ],
        },
      },
    }
    expect(() =>
      parseGameIrCandidate(
        {
          schemaVersion: GAME_IR_SCHEMA_VERSION,
          taskId: 'compile-task-1',
          foundationRevision: 'foundation-revision-1',
          modules: [{ moduleId: 'gameplay', nodes: [cycleA, cycleB] }],
        },
        { request: request(), sections },
      ),
    ).toThrow(/cycle/i)

    expect(() =>
      parseGameIrModuleCandidate(localModule, {
        request: request(),
        sections,
        externalModules: [external],
      }),
    ).toThrow(/missing|node|external/i)
    expect(() =>
      parseGameIrModuleCandidate(
        {
          ...localModule,
          moduleId: 'gameplay',
        },
        {
          request: request(),
          sections,
          externalModules: [{ ...external, moduleId: 'unknown-module' }],
        },
      ),
    ).toThrow(/expected|canonical|module/i)
    expect(() =>
      parseGameIrModuleCandidate(localModule, {
        request: request(),
        sections,
        externalModules: [{ ...external, moduleId: 'gameplay' }],
      }),
    ).toThrow(/duplicate|module/i)
    expect(() =>
      parseGameIrModuleCandidate(candidate().modules[0]!, {
        request: request(),
        sections,
        externalModules: [
          { ...external, moduleId: 'balance', nodes: [ownerNode] },
        ],
      }),
    ).toThrow(/duplicate|node/i)
    expect(() =>
      parseGameIrModuleCandidate(localModule, {
        request: request(),
        sections: [
          { ...sections[0]!, heading: 'wrong complete index' },
          sections[1]!,
        ],
        externalModules: [external],
      }),
    ).toThrow(/section|index|digest/i)
  })

  test('rejects a cycle that mixes local and external dependency edges', () => {
    const ownerNode = candidate().modules[0]!.nodes[0]!
    const gameplayNode = {
      ...ownerNode,
      id: 'gameplay-node',
      producerMode: 'derived' as const,
      value: { first: 1, second: 2 },
      bindings: {
        '/id': {
          kind: 'derived' as const,
          derivationRuleId: 'gameplay-id-from-balance',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'balance' as const,
              nodeId: 'balance-node',
              pointer: '/value/score',
              targetDigest: digestGameIrValue(3),
            },
          ],
        },
        '/value/first': {
          kind: 'derived' as const,
          derivationRuleId: 'first-from-second',
          inputs: [{ kind: 'local' as const, pointer: '/value/second' }],
        },
        '/value/second': {
          kind: 'derived' as const,
          derivationRuleId: 'second-from-balance',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'balance' as const,
              nodeId: 'balance-node',
              pointer: '/value/score',
              targetDigest: digestGameIrValue(3),
            },
          ],
        },
      },
    }
    const balanceNode = {
      ...ownerNode,
      id: 'balance-node',
      producerMode: 'derived' as const,
      value: { score: 3 },
      bindings: {
        '/id': {
          kind: 'derived' as const,
          derivationRuleId: 'balance-id-from-gameplay',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'gameplay-node',
              pointer: '/value/first',
              targetDigest: digestGameIrValue(1),
            },
          ],
        },
        '/value/score': {
          kind: 'derived' as const,
          derivationRuleId: 'score-from-gameplay',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'gameplay-node',
              pointer: '/value/first',
              targetDigest: digestGameIrValue(1),
            },
          ],
        },
      },
    }
    expect(() =>
      parseGameIrCandidate(
        {
          schemaVersion: GAME_IR_SCHEMA_VERSION,
          taskId: 'compile-task-1',
          foundationRevision: 'foundation-revision-1',
          modules: [
            { moduleId: 'balance', nodes: [balanceNode] },
            { moduleId: 'gameplay', nodes: [gameplayNode] },
          ],
        },
        { request: request(), sections },
      ),
    ).toThrow(/cycle/i)
  })

  test('rejects a raw prior module that depends backward on the current local module', () => {
    const currentNode = candidate().modules[0]!.nodes[0]!
    const rawPriorNode = {
      ...currentNode,
      id: 'balance-derived',
      producerMode: 'derived' as const,
      value: { score: 4 },
      bindings: {
        '/id': {
          kind: 'derived' as const,
          derivationRuleId: 'identity-from-current',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'player',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(3),
            },
          ],
        },
        '/value/score': {
          kind: 'derived' as const,
          derivationRuleId: 'balance-from-gameplay',
          inputs: [
            {
              kind: 'external' as const,
              moduleId: 'gameplay' as const,
              nodeId: 'player',
              pointer: '/value/health',
              targetDigest: digestGameIrValue(3),
            },
          ],
        },
      },
    }
    expect(() =>
      parseGameIrModuleCandidate(currentNodeModule(), {
        request: request(),
        sections,
        externalModules: [{ moduleId: 'balance', nodes: [rawPriorNode] }],
      }),
    ).toThrow(/prior|direction|external|dependency/i)

    function currentNodeModule() {
      return candidate().modules[0]!
    }
  })

  test('rejects isolated modules with stale source bindings', () => {
    const rawGameplayModule = candidate().modules[0]!
    const node = rawGameplayModule.nodes[0]!
    expect(() =>
      parseGameIrModuleCandidate(
        {
          ...rawGameplayModule,
          nodes: [
            {
              ...node,
              bindings: {
                ...node.bindings,
                '/value/health': {
                  ...node.bindings['/value/health']!,
                  sectionDigest: 'd'.repeat(64),
                },
              },
            },
          ],
        },
        { request: request(), sections },
      ),
    ).toThrow(/section|digest/i)
  })

  test('keeps complete-candidate cross-module reference closure', () => {
    const rawGameplayModule = candidate().modules[0]!
    const node = rawGameplayModule.nodes[0]!
    const danglingReference = {
      ...rawGameplayModule,
      nodes: [
        {
          ...node,
          references: [{ targetId: 'missing-core-node', targetType: 'entity' }],
          bindings: {
            ...node.bindings,
            '/references/0': node.bindings['/id']!,
          },
        },
      ],
    }
    expect(() =>
      parseGameIrCandidate(
        {
          ...candidate(),
          modules: [{ moduleId: 'core', nodes: [] }, danglingReference],
        },
        { request: request(), sections },
      ),
    ).toThrow(/reference|target|closure/i)
  })

  test('uses one canonical target-pointer classifier for node bindings', () => {
    expect(parseGameIrTargetPointer('/id')).toBe('/id')
    expect(parseGameIrTargetPointer('/value')).toBe('/value')
    expect(parseGameIrTargetPointer('/value/name')).toBe('/value/name')
    expect(parseGameIrTargetPointer('/references/0')).toBe('/references/0')
    expect(parseGameIrTargetPointer('/edges/12')).toBe('/edges/12')
    expect(parseGameIrTargetPointer('/value/label with spaces')).toBe(
      '/value/label with spaces',
    )
    for (const pointer of [
      '/kind',
      '/bindings/value',
      '/source/value',
      '/references/-1',
      '/references/01',
      '/edges/1/extra',
    ]) {
      expect(() => parseGameIrTargetPointer(pointer)).toThrow(/target pointer/i)
    }

    const base = candidate()
    const node = base.modules[0]!.nodes[0]!
    const parsed = parseGameIrCandidate(
      {
        ...base,
        modules: [
          {
            ...base.modules[0]!,
            nodes: [
              {
                ...node,
                value: { ...node.value, 'rule#variant': 'strict' },
                bindings: {
                  ...node.bindings,
                  '/value/rule#variant': node.bindings['/value/health']!,
                },
              },
            ],
          },
        ],
      },
      { request: request(), sections },
    )
    expect(
      parsed.modules[0]!.nodes[0]!.bindings['/value/rule#variant'],
    ).toEqual(node.bindings['/value/health'])
  })

  test('parses a revision-bound candidate and freezes all containers', () => {
    const parsed = parseGameIrCandidate(candidate(), {
      request: request(),
      sections,
    })

    expect(parsed).toEqual(candidate())
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.modules)).toBe(true)
    expect(Object.isFrozen(parsed.modules[0]!)).toBe(true)
    expect(Object.isFrozen(parsed.modules[0]!.nodes)).toBe(true)
    expect(Object.isFrozen(parsed.modules[0]!.nodes[0]!.value)).toBe(true)
    expect(Object.isFrozen(parsed.modules[0]!.nodes[0]!.bindings)).toBe(true)
  })

  test('binds candidate identity to the compile request', () => {
    expect(() =>
      parseGameIrCandidate(candidate({ taskId: 'other-task' }), {
        request: request(),
        sections,
      }),
    ).toThrow(/task/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({ foundationRevision: 'other-revision' }),
        { request: request(), sections },
      ),
    ).toThrow(/revision/i)
  })

  test('rejects duplicate or unsorted module and node IDs', () => {
    const secondModule = {
      ...candidate().modules[0]!,
      moduleId: 'gameplay',
    }
    expect(() =>
      parseGameIrCandidate(
        candidate({ modules: [secondModule, candidate().modules[0]!] }),
        { request: request(), sections },
      ),
    ).toThrow(/module/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                candidate().modules[0]!.nodes[0]!,
                candidate().modules[0]!.nodes[0]!,
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/node/i)
  })

  test('requires explicit typed references and relationship edges to close globally', () => {
    const node = candidate().modules[0]!.nodes[0]!
    const explicit = candidate({
      modules: [
        {
          ...candidate().modules[0]!,
          nodes: [
            {
              ...node,
              references: [{ targetId: 'player', targetType: 'entity' }],
              edges: [
                {
                  type: 'requires',
                  targetId: 'player',
                  targetType: 'entity',
                },
              ],
              bindings: {
                ...node.bindings,
                '/references/0': node.bindings['/id']!,
                '/edges/0': node.bindings['/id']!,
              },
            },
          ],
        },
      ],
    })
    expect(
      parseGameIrCandidate(explicit, { request: request(), sections }),
    ).toBeTruthy()
    expect(() =>
      parseGameIrCandidate(
        {
          ...explicit,
          modules: [
            {
              ...explicit.modules[0]!,
              nodes: [
                {
                  ...explicit.modules[0]!.nodes[0]!,
                  references: [{ targetId: 'missing', targetType: 'entity' }],
                },
              ],
            },
          ],
        },
        { request: request(), sections },
      ),
    ).toThrow(/reference|target|closure/i)
    expect(() =>
      parseGameIrCandidate(
        {
          ...explicit,
          modules: [
            {
              ...explicit.modules[0]!,
              nodes: [
                {
                  ...explicit.modules[0]!.nodes[0]!,
                  references: [
                    { targetId: 'player', targetType: 'wrong-type' },
                  ],
                },
              ],
            },
          ],
        },
        { request: request(), sections },
      ),
    ).toThrow(/type|reference|target/i)
    expect(() =>
      parseGameIrCandidate(
        {
          ...explicit,
          modules: [
            {
              ...explicit.modules[0]!,
              nodes: [
                {
                  ...explicit.modules[0]!.nodes[0]!,
                  edges: [
                    {
                      type: 'requires',
                      targetId: 'player',
                      targetType: 'entity',
                    },
                    {
                      type: 'requires',
                      targetId: 'player',
                      targetType: 'entity',
                    },
                  ],
                },
              ],
            },
          ],
        },
        { request: request(), sections },
      ),
    ).toThrow(/duplicate|edge/i)
    expect(() =>
      parseGameIrCandidate(
        {
          ...explicit,
          modules: [
            {
              ...explicit.modules[0]!,
              nodes: [
                {
                  ...explicit.modules[0]!.nodes[0]!,
                  edges: [
                    {
                      type: 'reference',
                      targetId: 'player',
                      targetType: 'entity',
                    },
                  ],
                },
              ],
            },
          ],
        },
        { request: request(), sections },
      ),
    ).toThrow(/reserved|reference|edge/i)
  })

  test('rejects unknown producer modes and unsafe pointers', () => {
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...candidate().modules[0]!.nodes[0]!,
                  producerMode: 'unknown' as never,
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/producer/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...candidate().modules[0]!.nodes[0]!,
                  bindings: {
                    ...candidate().modules[0]!.nodes[0]!.bindings,
                    '/value/../health':
                      candidate().modules[0]!.nodes[0]!.bindings[
                        '/value/health'
                      ]!,
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/pointer/i)
  })

  test('rejects owner bindings outside the receipt or Section Index', () => {
    const owner = candidate().modules[0]!.nodes[0]!.bindings[
      '/value/health'
    ] as Extract<GameIrSourceBinding, { kind: 'owner' }>
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...candidate().modules[0]!.nodes[0]!,
                  bindings: {
                    ...candidate().modules[0]!.nodes[0]!.bindings,
                    '/value/health': {
                      ...owner,
                      documentPath: 'docs/ASSET_PLAN.md',
                    },
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/receipt|section/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...candidate().modules[0]!.nodes[0]!,
                  bindings: {
                    ...candidate().modules[0]!.nodes[0]!.bindings,
                    '/value/health': { ...owner, sectionId: 'missing' },
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/section/i)
    expect(() =>
      parseGameIrCandidate(candidate(), {
        request: request(),
        sections: [{ ...sections[0]!, digest: 'b'.repeat(64) }],
      }),
    ).toThrow(/section/i)
  })

  test('rejects malformed derived inputs and incomplete leaf bindings', () => {
    const node = candidate().modules[0]!.nodes[0]!
    expect(() =>
      parseGameIrCandidate(
        derivedCandidate({
          bindings: {
            '/id': node.bindings['/id']!,
            '/value/score': {
              kind: 'derived',
              derivationRuleId: 'legacy-input-pointers',
              inputPointers: ['/id'],
            } as never,
          },
        }),
        { request: request(), sections },
      ),
    ).toThrow(/unknown|missing|inputs/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...node,
                  bindings: {
                    ...node.bindings,
                    '/value/state/initial': {
                      kind: 'derived',
                      derivationRuleId: 'initial-state',
                      inputs: [
                        { kind: 'local', pointer: '/value/health' },
                        { kind: 'local', pointer: '/value/health' },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/input/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [{ ...node, bindings: { '/id': node.bindings['/id']! } }],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/binding|leaf/i)
  })

  test('rejects bindings that do not target /id or a value leaf', () => {
    const node = candidate().modules[0]!.nodes[0]!
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...node,
                  bindings: {
                    ...node.bindings,
                    '/value/state': node.bindings['/value/health']!,
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/leaf|binding/i)
  })

  test('recomputes the complete Section Index digest without trusting caller order', () => {
    const forged = [
      { ...sections[0]!, heading: 'Forged heading' },
      sections[1]!,
    ]
    expect(() =>
      parseGameIrCandidate(candidate(), {
        request: request(),
        sections: forged,
      }),
    ).toThrow(/section.*digest|digest.*section/i)
    expect(() =>
      parseGameIrCandidate(candidate(), {
        request: request(),
        sections: [{ ...sections[0]!, endLine: 99 }, sections[1]!],
      }),
    ).toThrow(/section.*digest|digest.*section/i)
    expect(
      parseGameIrCandidate(candidate(), {
        request: request(),
        sections: [...sections].reverse(),
      }),
    ).toBeTruthy()
    expect(() =>
      parseGameIrCandidate(candidate(), {
        request: request(),
        sections: [...sections, sections[0]!],
      }),
    ).toThrow(/duplicate|section/i)
  })

  test('enforces one producer mode for every value leaf', () => {
    const node = candidate().modules[0]!.nodes[0]!
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...node,
                  bindings: {
                    ...node.bindings,
                    '/value/health': {
                      kind: 'derived',
                      derivationRuleId: 'health-copy',
                      inputs: [{ kind: 'local', pointer: '/id' }],
                    },
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/producer|owner/i)
    expect(() =>
      parseGameIrCandidate(
        derivedCandidate({
          bindings: {
            '/id': node.bindings['/id']!,
            '/value/score': node.bindings['/value/health']!,
          },
        }),
        { request: request(), sections },
      ),
    ).toThrow(/producer|derived/i)
    expect(
      parseGameIrCandidate(derivedCandidate(), {
        request: request(),
        sections,
      }),
    ).toBeTruthy()
  })

  test('uses the producer mode for identity and structural binding targets', () => {
    const source = candidate().modules[0]!.nodes[0]!
    const externalNode = {
      ...source,
      id: 'balance-source',
      value: { health: 9, state: { initial: 'ready' } },
    }
    const externalModule = { moduleId: 'balance', nodes: [externalNode] }
    const externalIdInput = {
      kind: 'external' as const,
      moduleId: 'balance' as const,
      nodeId: 'balance-source',
      pointer: '/id',
      targetDigest: digestGameIrValue('balance-source'),
    }
    const derivedNode = derivedCandidate({
      edges: [
        { type: 'uses', targetId: 'balance-source', targetType: 'entity' },
      ],
      bindings: {
        '/id': {
          kind: 'derived',
          derivationRuleId: 'identity-from-balance',
          inputs: [externalIdInput],
        },
        '/value/score': {
          kind: 'derived',
          derivationRuleId: 'score-from-identity',
          inputs: [{ kind: 'local', pointer: '/id' }],
        },
        '/edges/0': {
          kind: 'derived',
          derivationRuleId: 'edge-from-balance',
          inputs: [externalIdInput],
        },
      },
    }).modules[0]!.nodes[0]!
    expect(() =>
      parseGameIrModuleCandidate(
        { moduleId: 'gameplay', nodes: [derivedNode] },
        {
          request: request(),
          sections,
          externalModules: [externalModule],
        },
      ),
    ).not.toThrow()

    expect(() =>
      parseGameIrModuleCandidate(
        {
          moduleId: 'gameplay',
          nodes: [
            {
              ...derivedNode,
              bindings: {
                ...derivedNode.bindings,
                '/id': source.bindings['/id']!,
              },
            },
          ],
        },
        { request: request(), sections, externalModules: [externalModule] },
      ),
    ).toThrow(/identity|derived|binding/)
    expect(() =>
      parseGameIrModuleCandidate(
        {
          moduleId: 'gameplay',
          nodes: [
            {
              ...derivedNode,
              bindings: {
                ...derivedNode.bindings,
                '/edges/0': source.bindings['/id']!,
              },
            },
          ],
        },
        { request: request(), sections, externalModules: [externalModule] },
      ),
    ).toThrow(/edge|derived|binding/)
    expect(() =>
      parseGameIrModuleCandidate(
        {
          moduleId: 'gameplay',
          nodes: [
            {
              ...derivedNode,
              references: [
                { targetId: 'balance-source', targetType: 'entity' },
              ],
              bindings: {
                ...derivedNode.bindings,
                '/references/0': source.bindings['/id']!,
              },
            },
          ],
        },
        { request: request(), sections, externalModules: [externalModule] },
      ),
    ).toThrow(/reference|derived|binding/)

    const semanticNode = source
    expect(() =>
      parseGameIrModuleCandidate(
        {
          moduleId: 'gameplay',
          nodes: [
            {
              ...semanticNode,
              bindings: {
                ...semanticNode.bindings,
                '/id': {
                  ...derivedNode.bindings['/id']!,
                },
              },
            },
          ],
        },
        { request: request(), sections, externalModules: [externalModule] },
      ),
    ).toThrow(/identity|owner|binding/)
  })

  test('requires every derived dependency chain to reach owner evidence', () => {
    const node = derivedCandidate().modules[0]!.nodes[0]!
    expect(() =>
      parseGameIrCandidate(
        derivedCandidate({
          bindings: {
            '/id': node.bindings['/id']!,
            '/value/score': {
              kind: 'derived',
              derivationRuleId: 'self',
              inputs: [{ kind: 'local', pointer: '/value/score' }],
            },
          },
        }),
        { request: request(), sections },
      ),
    ).toThrow(/cycle|owner|derived/i)

    const twoNodeCycle = derivedCandidate({
      value: { first: 1, second: 2 },
      bindings: {
        '/id': node.bindings['/id']!,
        '/value/first': {
          kind: 'derived',
          derivationRuleId: 'cycle-a',
          inputs: [{ kind: 'local', pointer: '/value/second' }],
        },
        '/value/second': {
          kind: 'derived',
          derivationRuleId: 'cycle-b',
          inputs: [{ kind: 'local', pointer: '/value/first' }],
        },
      },
    })
    expect(() =>
      parseGameIrCandidate(twoNodeCycle, { request: request(), sections }),
    ).toThrow(/cycle|owner|derived/i)

    expect(
      parseGameIrCandidate(
        derivedCandidate({
          value: { source: 1, score: 2 },
          bindings: {
            '/id': node.bindings['/id']!,
            '/value/source': {
              kind: 'derived',
              derivationRuleId: 'source-from-id',
              inputs: [{ kind: 'local', pointer: '/id' }],
            },
            '/value/score': {
              kind: 'derived',
              derivationRuleId: 'score-from-source',
              inputs: [{ kind: 'local', pointer: '/value/source' }],
            },
          },
        }),
        { request: request(), sections },
      ),
    ).toBeTruthy()
  })

  test('rejects hidden non-JSON state and returns an unaliased normalized tree', () => {
    const accessor = candidate()
    Object.defineProperty(accessor.modules[0]!.nodes[0]!.value, 'hidden', {
      enumerable: true,
      configurable: true,
      get: () => 1,
    })
    expect(() =>
      parseGameIrCandidate(accessor, { request: request(), sections }),
    ).toThrow(/descriptor|accessor|json/i)

    const symbolValue = candidate().modules[0]!.nodes[0]!.value
    Object.defineProperty(symbolValue, Symbol('hidden'), {
      enumerable: true,
      configurable: true,
      value: 1,
    })
    expect(() =>
      parseGameIrCandidate(
        Object.assign(candidate(), {
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...candidate().modules[0]!.nodes[0]!,
                  value: symbolValue,
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/symbol|json/i)
    expect(() => canonicalGameIrJson(symbolValue)).toThrow(/symbol|json/i)

    const hidden = candidate()
    Object.defineProperty(hidden.modules[0]!.nodes[0]!.value, 'hidden', {
      enumerable: false,
      configurable: true,
      value: 1,
    })
    expect(() =>
      parseGameIrCandidate(hidden, { request: request(), sections }),
    ).toThrow(/descriptor|enumerable|json/i)

    const sparse = candidate()
    const sparseArray: unknown[] = []
    sparseArray.length = 2
    ;(sparse.modules[0]!.nodes[0]!.value as Record<string, unknown>).items =
      sparseArray
    expect(() =>
      parseGameIrCandidate(sparse, { request: request(), sections }),
    ).toThrow(/sparse|undefined|json/i)

    const input = candidate()
    const parsed = parseGameIrCandidate(input, { request: request(), sections })
    expect(parsed).not.toBe(input)
    expect(parsed.modules[0]!.nodes[0]!.value).not.toBe(
      input.modules[0]!.nodes[0]!.value,
    )
    ;(input.modules[0]!.nodes[0]!.value as Record<string, unknown>).health = 99
    expect(parsed.modules[0]!.nodes[0]!.value.health).toBe(3)
    expect(Object.isFrozen(parsed.modules[0]!.nodes[0]!.value)).toBe(true)
  })

  test('treats empty objects and arrays as bindable leaves', () => {
    const baseNode = candidate().modules[0]!.nodes[0]!
    const emptyOwner = candidate({
      modules: [
        {
          ...candidate().modules[0]!,
          nodes: [
            {
              ...baseNode,
              value: { emptyObject: {}, emptyArray: [] },
              bindings: {
                '/id': baseNode.bindings['/id']!,
                '/value/emptyObject': baseNode.bindings['/value/health']!,
                '/value/emptyArray': baseNode.bindings['/value/health']!,
              },
            },
          ],
        },
      ],
    })
    expect(
      parseGameIrCandidate(emptyOwner, { request: request(), sections }),
    ).toBeTruthy()
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...baseNode,
                  value: { empty: {} },
                  bindings: { '/id': baseNode.bindings['/id']! },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/leaf|binding/i)

    const emptyDerived = derivedCandidate({
      value: { empty: {} },
      bindings: {
        '/id': derivedCandidate().modules[0]!.nodes[0]!.bindings['/id']!,
        '/value/empty': {
          kind: 'derived',
          derivationRuleId: 'empty-from-id',
          inputs: [{ kind: 'local', pointer: '/id' }],
        },
      },
    })
    expect(
      parseGameIrCandidate(emptyDerived, { request: request(), sections }),
    ).toBeTruthy()
  })

  test('accepts frozen parsed candidates and preserves digest identity', () => {
    const plain = candidate()
    const parsed = parseGameIrCandidate(plain, { request: request(), sections })
    expect(() => canonicalGameIrJson(parsed)).not.toThrow()
    expect(digestGameIrValue(parsed)).toBe(digestGameIrValue(plain))
    expect(() =>
      parseGameIrCandidate(parsed, { request: request(), sections }),
    ).not.toThrow()

    const emptyArrayCandidate = candidate({
      modules: [
        {
          ...candidate().modules[0]!,
          nodes: [
            {
              ...candidate().modules[0]!.nodes[0]!,
              value: { items: [] },
              bindings: {
                '/id': candidate().modules[0]!.nodes[0]!.bindings['/id']!,
                '/value/items':
                  candidate().modules[0]!.nodes[0]!.bindings['/value/health']!,
              },
            },
          ],
        },
      ],
    })
    const parsedEmptyArray = parseGameIrCandidate(emptyArrayCandidate, {
      request: request(),
      sections,
    })
    expect(() => canonicalGameIrJson(parsedEmptyArray)).not.toThrow()

    const nonWritable = candidate()
    Object.defineProperty(nonWritable.modules[0]!.nodes[0]!.value, 'stable', {
      enumerable: true,
      configurable: false,
      writable: false,
      value: 7,
    })
    ;(nonWritable.modules[0]!.nodes[0]!.bindings as Record<string, unknown>)[
      '/value/stable'
    ] = nonWritable.modules[0]!.nodes[0]!.bindings['/value/health']!
    const parsedNonWritable = parseGameIrCandidate(nonWritable, {
      request: request(),
      sections,
    })
    expect(parsedNonWritable).not.toBe(nonWritable)
    expect(parsedNonWritable.modules[0]!.nodes[0]!.value).not.toBe(
      nonWritable.modules[0]!.nodes[0]!.value,
    )
    expect(parsedNonWritable.modules[0]!.nodes[0]!.value.stable).toBe(7)
    expect(Object.isFrozen(parsedNonWritable.modules[0]!.nodes[0]!.value)).toBe(
      true,
    )
  })

  test('canonicalizes object keys without changing declared array order', () => {
    const first = { z: 1, a: { d: 2, c: 3 }, list: [{ y: 1, x: 2 }, 0] }
    const second = { list: [{ x: 2, y: 1 }, 0], a: { c: 3, d: 2 }, z: 1 }
    expect(canonicalGameIrJson(first)).toBe(canonicalGameIrJson(second))
    expect(canonicalGameIrJson({ list: [0, 1] })).not.toBe(
      canonicalGameIrJson({ list: [1, 0] }),
    )
    expect(digestGameIrValue(first)).toBe(digestGameIrValue(second))
  })

  test('rejects non-JSON values', () => {
    expect(() => canonicalGameIrJson({ value: Number.NaN })).toThrow(
      /json|finite/i,
    )
    expect(() => canonicalGameIrJson({ value: undefined })).toThrow(
      /json|undefined/i,
    )
    expect(() => canonicalGameIrJson({ value: () => 'nope' })).toThrow(
      /json|function/i,
    )
    expect(() => canonicalGameIrJson(new Date())).toThrow(/json|plain/i)
  })
})
