import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
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
              '/id': node.bindings['/id']!,
              '/value/score': {
                kind: 'derived',
                derivationRuleId: 'score-from-id',
                inputPointers: ['/id'],
              },
            },
            ...overrides,
          },
        ],
      },
    ],
  })
}

describe('Game IR core candidate and source authority', () => {
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
                      inputPointers: ['/value/health', '/value/health'],
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

  test('recomputes the complete Section Index digest before admitting owners', () => {
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
    expect(() =>
      parseGameIrCandidate(candidate(), {
        request: request(),
        sections: [...sections].reverse(),
      }),
    ).toThrow(/sorted|section/i)
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
                      inputPointers: ['/id'],
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
              inputPointers: ['/value/score'],
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
          inputPointers: ['/value/second'],
        },
        '/value/second': {
          kind: 'derived',
          derivationRuleId: 'cycle-b',
          inputPointers: ['/value/first'],
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
              inputPointers: ['/id'],
            },
            '/value/score': {
              kind: 'derived',
              derivationRuleId: 'score-from-source',
              inputPointers: ['/value/source'],
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
        '/id': baseNode.bindings['/id']!,
        '/value/empty': {
          kind: 'derived',
          derivationRuleId: 'empty-from-id',
          inputPointers: ['/id'],
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
