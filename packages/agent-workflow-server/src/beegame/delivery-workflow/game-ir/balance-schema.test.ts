import { describe, expect, test } from 'bun:test'
import type { GameIrModuleCandidate, GameIrNode } from './model'
import {
  BALANCE_DOMAIN_MANIFEST,
  parseBalanceModule,
  type BalanceFormulaExpression,
} from './balance-schema'

type MutableNode = {
  id: string
  kind: string
  producerMode: 'semantic'
  value: Record<string, unknown>
  references: Array<{ targetId: string; targetType: string }>
  edges: Array<{ type: string; targetId: string; targetType: string }>
  bindings: Record<string, never>
}

const edge = (type: string, targetId: string, targetType: string) => ({
  type,
  targetId,
  targetType,
})
const ref = (targetId: string, targetType: string) => ({
  targetId,
  targetType,
})

function node(
  id: string,
  kind: string,
  value: Record<string, unknown>,
  options: Partial<Pick<MutableNode, 'references' | 'edges'>> = {},
): MutableNode {
  return {
    id,
    kind,
    producerMode: 'semantic',
    value,
    references: options.references ?? [],
    edges: options.edges ?? [],
    bindings: {},
  }
}

const noneUnit = {
  symbol: '1',
  dimensions: [],
  scale: { numerator: 1, denominator: 1 },
}
const healthUnit = {
  symbol: 'hp',
  dimensions: [{ base: 'health', exponent: 1 }],
  scale: { numerator: 1, denominator: 1 },
}
const currencyUnit = {
  symbol: 'coin',
  dimensions: [{ base: 'currency', exponent: 1 }],
  scale: { numerator: 1, denominator: 1 },
}
const timeUnit = {
  symbol: 's',
  dimensions: [{ base: 'time', exponent: 1 }],
  scale: { numerator: 1, denominator: 1 },
}

function validBalanceModule(): GameIrModuleCandidate {
  const mathExpression: BalanceFormulaExpression = {
    kind: 'absolute',
    operand: {
      kind: 'negate',
      operand: {
        kind: 'binary',
        operator: 'maximum',
        left: {
          kind: 'binary',
          operator: 'minimum',
          left: {
            kind: 'binary',
            operator: 'add',
            left: { kind: 'reference', referenceIndex: 1 },
            right: { kind: 'literal', value: 2, unitReferenceIndex: 0 },
          },
          right: { kind: 'reference', referenceIndex: 2 },
        },
        right: {
          kind: 'binary',
          operator: 'subtract',
          left: { kind: 'reference', referenceIndex: 2 },
          right: { kind: 'literal', value: 1, unitReferenceIndex: 0 },
        },
      },
    },
  }
  const nodes: MutableNode[] = [
    node(
      'balance.binding',
      'balance.reward-cost-binding',
      {
        label: 'Jump payout',
      },
      {
        references: [
          ref('balance.reward', 'balance.reward'),
          ref('balance.cost', 'balance.cost'),
          ref('gameplay.jump', 'gameplay.action'),
        ],
        edges: [
          edge('cost', 'balance.cost', 'balance.cost'),
          edge('reward', 'balance.reward', 'balance.reward'),
          edge('triggered-by', 'gameplay.jump', 'gameplay.action'),
        ],
      },
    ),
    node(
      'balance.cost',
      'balance.cost',
      { label: 'Jump cost' },
      {
        references: [ref('balance.coins', 'balance.variable')],
        edges: [edge('amount', 'balance.coins', 'balance.variable')],
      },
    ),
    node(
      'balance.coins',
      'balance.variable',
      {
        label: 'Coins',
        baseline: 10,
        minimum: 0,
        maximum: 100,
        unitReferenceIndex: 0,
      },
      {
        references: [ref('balance.unit.coin', 'balance.unit')],
      },
    ),
    node(
      'balance.formula.currency',
      'balance.formula',
      {
        label: 'Payout',
        expression: { kind: 'literal', value: 5, unitReferenceIndex: 0 },
        outputUnitReferenceIndex: 0,
      },
      {
        references: [ref('balance.unit.coin', 'balance.unit')],
      },
    ),
    node(
      'balance.formula.math',
      'balance.formula',
      {
        label: 'Difficulty score',
        expression: mathExpression,
        outputUnitReferenceIndex: 0,
      },
      {
        references: [
          ref('balance.unit.none', 'balance.unit'),
          ref('balance.score', 'balance.variable'),
          ref('balance.rate', 'balance.parameter'),
        ],
        edges: [
          edge('depends-on', 'balance.rate', 'balance.parameter'),
          edge('depends-on', 'balance.score', 'balance.variable'),
        ],
      },
    ),
    node(
      'balance.formula.ratio',
      'balance.formula',
      {
        label: 'Health ratio',
        expression: {
          kind: 'binary',
          operator: 'divide',
          left: {
            kind: 'binary',
            operator: 'multiply',
            left: { kind: 'literal', value: 1, unitReferenceIndex: 0 },
            right: { kind: 'reference', referenceIndex: 1 },
          },
          right: { kind: 'reference', referenceIndex: 1 },
        },
        outputUnitReferenceIndex: 0,
      },
      {
        references: [
          ref('balance.unit.none', 'balance.unit'),
          ref('balance.hp', 'balance.variable'),
        ],
        edges: [edge('depends-on', 'balance.hp', 'balance.variable')],
      },
    ),
    node(
      'balance.hp',
      'balance.variable',
      {
        label: 'Health',
        baseline: 100,
        minimum: 0,
        maximum: 100,
        unitReferenceIndex: 0,
      },
      {
        references: [ref('balance.unit.hp', 'balance.unit')],
      },
    ),
    node(
      'balance.rate',
      'balance.parameter',
      {
        label: 'Rate',
        baseline: 1,
        minimum: 0,
        maximum: 4,
        unitReferenceIndex: 0,
      },
      {
        references: [ref('balance.unit.none', 'balance.unit')],
      },
    ),
    node(
      'balance.reward',
      'balance.reward',
      { label: 'Jump reward' },
      {
        references: [ref('balance.formula.currency', 'balance.formula')],
        edges: [edge('amount', 'balance.formula.currency', 'balance.formula')],
      },
    ),
    node(
      'balance.source',
      'balance.economy-source',
      { label: 'Earn coins' },
      {
        references: [
          ref('balance.formula.currency', 'balance.formula'),
          ref('balance.unit.coin', 'balance.unit'),
        ],
        edges: [
          edge('amount', 'balance.formula.currency', 'balance.formula'),
          edge('unit', 'balance.unit.coin', 'balance.unit'),
        ],
      },
    ),
    node(
      'balance.sink',
      'balance.economy-sink',
      { label: 'Spend coins' },
      {
        references: [
          ref('balance.coins', 'balance.variable'),
          ref('balance.unit.coin', 'balance.unit'),
        ],
        edges: [
          edge('amount', 'balance.coins', 'balance.variable'),
          edge('unit', 'balance.unit.coin', 'balance.unit'),
        ],
      },
    ),
    node('balance.curve', 'balance.progression-curve', {
      label: 'Difficulty curve',
      points: [
        { input: 0, output: 1 },
        { input: 1, output: 2 },
        { input: 5, output: 8 },
      ],
    }),
    node('balance.unit.coin', 'balance.unit', currencyUnit),
    node('balance.unit.hp', 'balance.unit', healthUnit),
    node('balance.unit.none', 'balance.unit', noneUnit),
    node('balance.unit.s', 'balance.unit', timeUnit),
    node(
      'balance.score',
      'balance.variable',
      {
        label: 'Score',
        baseline: 2,
        minimum: 0,
        maximum: 100,
        unitReferenceIndex: 0,
      },
      {
        references: [ref('balance.unit.none', 'balance.unit')],
      },
    ),
  ]
  nodes.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )
  return { moduleId: 'balance', nodes }
}

function cloneModule(): GameIrModuleCandidate {
  return structuredClone(validBalanceModule())
}

function gameplayTargets(): ReadonlyMap<string, GameIrNode> {
  return new Map([
    [
      'gameplay.jump',
      { id: 'gameplay.jump', kind: 'gameplay.action' } as GameIrNode,
    ],
  ])
}

function nodeById(module: GameIrModuleCandidate, id: string): MutableNode {
  return module.nodes.find(
    candidate => candidate.id === id,
  ) as unknown as MutableNode
}

describe('Balance Game IR schema', () => {
  const valueGuard = {
    'duplicate dimensions': /duplicate dimension/i,
    'unsorted dimensions': /sorted by base/i,
    'non-integer exponent': /exponent.*integer/i,
    'zero denominator': /denominator/i,
    'non-finite value': /baseline.*finite/i,
    'lower bound above upper bound': /minimum cannot exceed maximum/i,
    'baseline outside bounds': /baseline is above maximum/i,
    'missing unit reference': /unit.*reference.*range|exactly one unit/i,
    'wrong unit reference': /unit reference must target balance\.unit/i,
    'unknown value field': /unknown or missing fields/i,
  } as const
  const formulaGuard = {
    'dangling formula reference': /unknown node missing/i,
    'dependency cycle': /cycle/i,
    'AST/reference mismatch': /reference index is out of range/i,
    'add dimension mismatch': /dimension mismatch/i,
    'output unit mismatch': /output unit/i,
    'proven zero-literal division': /proven zero literal/i,
    'caller-supplied dependency summary': /unknown or missing fields/i,
  } as const

  test('accepts the complete balance fixture and freezes normalized output', () => {
    const parsed = parseBalanceModule(validBalanceModule(), gameplayTargets())
    expect(parsed.moduleId).toBe('balance')
    expect(parsed.nodes).toHaveLength(17)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.nodes)).toBe(true)
    expect(Object.isFrozen(parsed.nodes[0]!.value)).toBe(true)
  })

  test('exposes the closed relationship role manifest', () => {
    expect(
      BALANCE_DOMAIN_MANIFEST['balance.economy-source'].relationships.amount
        .targetKinds,
    ).toEqual(['balance.variable', 'balance.formula'])
    expect(
      BALANCE_DOMAIN_MANIFEST['balance.reward-cost-binding'].relationships[
        'triggered-by'
      ].targetKinds,
    ).toEqual(['gameplay.action', 'gameplay.event'])
  })

  test.each([
    [
      'duplicate dimensions',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.unit.hp').value.dimensions = [
          { base: 'health', exponent: 1 },
          { base: 'health', exponent: 2 },
        ]
      },
    ],
    [
      'unsorted dimensions',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.unit.hp').value.dimensions = [
          { base: 'z', exponent: 1 },
          { base: 'a', exponent: 1 },
        ]
      },
    ],
    [
      'non-integer exponent',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.unit.hp').value.dimensions = [
          { base: 'health', exponent: 0.5 },
        ]
      },
    ],
    [
      'zero denominator',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.unit.hp').value.scale = {
          numerator: 1,
          denominator: 0,
        }
      },
    ],
    [
      'non-finite value',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.hp').value.baseline = Number.NaN
      },
    ],
    [
      'lower bound above upper bound',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.hp').value.minimum = 101
      },
    ],
    [
      'baseline outside bounds',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.hp').value.baseline = 101
      },
    ],
    [
      'missing unit reference',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.hp').references = []
      },
    ],
    [
      'wrong unit reference',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.hp').references = [
          ref('balance.score', 'balance.variable'),
        ]
      },
    ],
    [
      'unknown value field',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.hp').value.extra = true
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const module = cloneModule()
    mutate(module)
    expect(() => parseBalanceModule(module, gameplayTargets())).toThrow(
      valueGuard[_name as keyof typeof valueGuard],
    )
  })

  test.each([
    [
      'dangling formula reference',
      (module: GameIrModuleCandidate) => {
        const formula = nodeById(module, 'balance.formula.math')
        formula.references[1] = ref('missing', 'balance.variable')
      },
    ],
    [
      'dependency cycle',
      (module: GameIrModuleCandidate) => {
        const formula = nodeById(module, 'balance.formula.math')
        formula.references[1] = ref('balance.formula.math', 'balance.formula')
        formula.edges = [
          edge('depends-on', 'balance.formula.math', 'balance.formula'),
          edge('depends-on', 'balance.rate', 'balance.parameter'),
        ]
      },
    ],
    [
      'AST/reference mismatch',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.formula.math').value.expression = {
          kind: 'reference',
          referenceIndex: 99,
        }
      },
    ],
    [
      'add dimension mismatch',
      (module: GameIrModuleCandidate) => {
        const formula = nodeById(module, 'balance.formula.math')
        formula.references[2] = ref('balance.hp', 'balance.variable')
        formula.edges[0] = edge('depends-on', 'balance.hp', 'balance.variable')
      },
    ],
    [
      'output unit mismatch',
      (module: GameIrModuleCandidate) => {
        const formula = nodeById(module, 'balance.formula.math')
        formula.references.push(ref('balance.unit.hp', 'balance.unit'))
        formula.value.outputUnitReferenceIndex = 3
      },
    ],
    [
      'proven zero-literal division',
      (module: GameIrModuleCandidate) => {
        const formula = nodeById(module, 'balance.formula.currency')
        formula.value.expression = {
          kind: 'binary',
          operator: 'divide',
          left: { kind: 'literal', value: 1, unitReferenceIndex: 0 },
          right: { kind: 'literal', value: 0, unitReferenceIndex: 0 },
        }
      },
    ],
    [
      'caller-supplied dependency summary',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.formula.math').value.dependencies = [
          'balance.score',
        ]
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const module = cloneModule()
    mutate(module)
    expect(() => parseBalanceModule(module, gameplayTargets())).toThrow(
      formulaGuard[_name as keyof typeof formulaGuard],
    )
  })

  test.each([
    [
      'wrong economy role kind',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.source').edges[0] = edge(
          'amount',
          'balance.unit.coin',
          'balance.unit',
        )
      },
    ],
    [
      'reward without amount',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.reward').edges = []
      },
    ],
    [
      'binding without gameplay trigger',
      (module: GameIrModuleCandidate) => {
        nodeById(module, 'balance.binding').edges = nodeById(
          module,
          'balance.binding',
        ).edges.filter(edgeValue => edgeValue.type !== 'triggered-by')
      },
    ],
    [
      'duplicate progression coordinate',
      (module: GameIrModuleCandidate) => {
        ;(
          nodeById(module, 'balance.curve').value.points as Array<
            Record<string, number>
          >
        )[1]!.input = 0
      },
    ],
    [
      'decreasing progression coordinate',
      (module: GameIrModuleCandidate) => {
        ;(
          nodeById(module, 'balance.curve').value.points as Array<
            Record<string, number>
          >
        )[2]!.input = -1
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const module = cloneModule()
    mutate(module)
    expect(() =>
      parseBalanceModule(
        module,
        new Map([
          [
            'gameplay.jump',
            { id: 'gameplay.jump', kind: 'gameplay.action' } as GameIrNode,
          ],
        ]),
      ),
    ).toThrow(/balance|role|amount|reward|trigger|progression|point/i)
  })

  test('rejects a variable unit reference that is valid but points to the wrong unit', () => {
    const module = cloneModule()
    nodeById(module, 'balance.hp').references = [
      ref('balance.score', 'balance.variable'),
    ]
    expect(() => parseBalanceModule(module, gameplayTargets())).toThrow(/unit/i)
  })

  test('eagerly rejects a wrong unit kind on an otherwise-unused variable', () => {
    const module = cloneModule()
    const nodes = module.nodes as unknown as MutableNode[]
    nodes.push(
      node(
        'balance.unused',
        'balance.variable',
        {
          label: 'Unused value',
          baseline: 1,
          unitReferenceIndex: 0,
        },
        {
          references: [ref('balance.score', 'balance.variable')],
        },
      ),
    )
    nodes.sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    expect(() => parseBalanceModule(module, gameplayTargets())).toThrow(
      /unit reference must target balance\.unit/i,
    )
  })

  test('rejects division by a negative zero literal', () => {
    const module = cloneModule()
    nodeById(module, 'balance.formula.currency').value.expression = {
      kind: 'binary',
      operator: 'divide',
      left: { kind: 'literal', value: 1, unitReferenceIndex: 0 },
      right: { kind: 'literal', value: -0, unitReferenceIndex: 0 },
    }
    expect(() => parseBalanceModule(module, gameplayTargets())).toThrow(/zero/i)
  })

  test.each([
    'add',
    'subtract',
    'minimum',
    'maximum',
  ] as const)('accepts %s for same-dimension operands with different scales', operator => {
    const module = cloneModule()
    const nodes = module.nodes as unknown as MutableNode[]
    nodes.push(
      node('balance.unit.ms', 'balance.unit', {
        symbol: 'ms',
        dimensions: [{ base: 'time', exponent: 1 }],
        scale: { numerator: 1, denominator: 1000 },
      }),
    )
    const formula = nodeById(module, 'balance.formula.math')
    formula.references = [
      ref('balance.unit.ms', 'balance.unit'),
      ref('balance.unit.s', 'balance.unit'),
    ]
    formula.edges = []
    formula.value.expression = {
      kind: 'binary',
      operator,
      left: { kind: 'literal', value: 1, unitReferenceIndex: 0 },
      right: { kind: 'literal', value: 1, unitReferenceIndex: 1 },
    }
    formula.value.outputUnitReferenceIndex = 0
    nodes.sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    expect(() => parseBalanceModule(module, gameplayTargets())).not.toThrow()
  })

  test('rejects economy amount and explicit unit with incoherent units', () => {
    const module = cloneModule()
    const source = nodeById(module, 'balance.source')
    source.references[1] = ref('balance.unit.hp', 'balance.unit')
    source.edges[1] = edge('unit', 'balance.unit.hp', 'balance.unit')
    expect(() => parseBalanceModule(module, gameplayTargets())).toThrow(
      /unit|coher/i,
    )
  })

  test.each([
    'balance.unit.s',
    'balance.curve',
  ])('rejects unused references on relationship-free node %s', id => {
    const module = cloneModule()
    const target = nodeById(module, id)
    target.references = [ref('balance.unit.none', 'balance.unit')]
    expect(() => parseBalanceModule(module, gameplayTargets())).toThrow(
      /reference|consum/i,
    )
  })

  test('does not impose a fixed progression point count', () => {
    const module = cloneModule()
    const points = nodeById(module, 'balance.curve').value.points as Array<
      Record<string, number>
    >
    for (let index = 6; index < 203; index += 1)
      points.push({ input: index, output: index * 2 })
    expect(
      parseBalanceModule(
        module,
        new Map([
          [
            'gameplay.jump',
            { id: 'gameplay.jump', kind: 'gameplay.action' } as GameIrNode,
          ],
        ]),
      ).nodes.find(nodeValue => nodeValue.id === 'balance.curve')!.value.points,
    ).toHaveLength(200)
  })
})
