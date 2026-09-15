import {
  compareCodeUnits,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'
import {
  projectionArray,
  projectionFiniteNumber,
  projectionInteger,
  projectionObject,
  projectionRecursive,
  projectionText,
  projectionValueFields,
  projectionValueOptionalFields,
  projectionValueRequiredFields,
  projectionValueSchema,
} from './projection-schema'

const BALANCE_FORMULA_EXPRESSION = projectionRecursive('expression', {
  expression: {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { const: 'literal' },
          value: { type: 'number' },
          unitReferenceIndex: { type: 'integer', minimum: 0 },
        },
        required: ['kind', 'value', 'unitReferenceIndex'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { const: 'reference' },
          referenceIndex: { type: 'integer', minimum: 0 },
        },
        required: ['kind', 'referenceIndex'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { enum: ['negate', 'absolute'] },
          operand: { $ref: '#/$defs/expression' },
        },
        required: ['kind', 'operand'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { const: 'binary' },
          operator: {
            enum: [
              'add',
              'subtract',
              'multiply',
              'divide',
              'minimum',
              'maximum',
            ],
          },
          left: { $ref: '#/$defs/expression' },
          right: { $ref: '#/$defs/expression' },
        },
        required: ['kind', 'operator', 'left', 'right'],
      },
    ],
  },
})

export type BalanceDimension = Readonly<{ base: string; exponent: number }>
export type BalanceUnit = Readonly<{
  symbol: string
  dimensions: readonly BalanceDimension[]
  scale: Readonly<{ numerator: number; denominator: number }>
}>

export type BalanceFormulaExpression =
  | Readonly<{ kind: 'literal'; value: number; unitReferenceIndex: number }>
  | Readonly<{ kind: 'reference'; referenceIndex: number }>
  | Readonly<{ kind: 'negate' | 'absolute'; operand: BalanceFormulaExpression }>
  | Readonly<{
      kind: 'binary'
      operator:
        | 'add'
        | 'subtract'
        | 'multiply'
        | 'divide'
        | 'minimum'
        | 'maximum'
      left: BalanceFormulaExpression
      right: BalanceFormulaExpression
    }>
type BalanceBinaryExpression = Extract<
  BalanceFormulaExpression,
  { kind: 'binary' }
>

export type BalanceRelationshipRole = Readonly<{
  targetKinds: readonly string[]
  required: boolean
  singleton: boolean
}>
export type BalanceReferencePolicy = Readonly<{
  kind: 'exact-edge-targets'
}> | Readonly<{
  kind: 'exact-single-index-reference'
  cardinality: 'exactly-one'
  targetKinds: readonly ['balance.unit']
  indexField: 'unitReferenceIndex'
  requiredIndex: 0
}> | Readonly<{
  kind: 'formula-indexed-references'
  indexedReferences: readonly Readonly<{
    path: string
    targetKinds: readonly string[]
    recursive: boolean
  }>[]
  consumesEveryReference: true
}>

const role = (
  targetKinds: readonly string[],
  options: Readonly<{ required?: boolean; singleton?: boolean }> = {},
): BalanceRelationshipRole =>
  Object.freeze({
    targetKinds: Object.freeze([...targetKinds]),
    required: options.required === true,
    singleton: options.singleton === true,
  })

const EXACT_EDGE_TARGETS_REFERENCE_POLICY: BalanceReferencePolicy =
  Object.freeze({ kind: 'exact-edge-targets' })
const EXACT_SINGLE_INDEX_REFERENCE_POLICY: BalanceReferencePolicy = Object.freeze({
  kind: 'exact-single-index-reference',
  cardinality: 'exactly-one',
  targetKinds: Object.freeze(['balance.unit'] as const),
  indexField: 'unitReferenceIndex',
  requiredIndex: 0,
})
const FORMULA_INDEXED_REFERENCE_POLICY: BalanceReferencePolicy = Object.freeze({
  kind: 'formula-indexed-references',
  indexedReferences: Object.freeze([
    Object.freeze({
      path: 'value.outputUnitReferenceIndex',
      targetKinds: Object.freeze(['balance.unit']),
      recursive: false,
    }),
    Object.freeze({
      path: 'value.expression.literal.unitReferenceIndex',
      targetKinds: Object.freeze(['balance.unit']),
      recursive: true,
    }),
    Object.freeze({
      path: 'value.expression.reference.referenceIndex',
      targetKinds: Object.freeze([
        'balance.variable',
        'balance.parameter',
        'balance.formula',
      ]),
      recursive: true,
    }),
  ]),
  consumesEveryReference: true,
})

/** The single schema-owned authority for Balance kinds, values, and roles. */
export const BALANCE_DOMAIN_MANIFEST = Object.freeze({
  'balance.unit': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      symbol: projectionText('unit symbol'),
      dimensions: projectionArray(
        projectionObject(
          {
            base: projectionText('dimension base'),
            exponent: projectionInteger('dimension exponent'),
          },
          ['base', 'exponent'],
          'unit dimension',
        ),
        'unit dimensions',
        0,
      ),
      scale: projectionObject(
        {
          numerator: projectionInteger('scale numerator'),
          denominator: projectionInteger('scale denominator'),
        },
        ['numerator', 'denominator'],
        'unit scale',
      ),
    }),
    relationships: Object.freeze({}),
  }),
  'balance.variable': Object.freeze({
    valueJsonSchema: projectionValueSchema(
      {
        label: projectionText('variable label'),
        baseline: projectionFiniteNumber('baseline'),
        minimum: projectionFiniteNumber('minimum'),
        maximum: projectionFiniteNumber('maximum'),
        unitReferenceIndex: projectionInteger('unit reference index', 0),
      },
      ['minimum', 'maximum'],
    ),
    relationships: Object.freeze({}),
    referencePolicy: EXACT_SINGLE_INDEX_REFERENCE_POLICY,
  }),
  'balance.parameter': Object.freeze({
    valueJsonSchema: projectionValueSchema(
      {
        label: projectionText('parameter label'),
        baseline: projectionFiniteNumber('baseline'),
        minimum: projectionFiniteNumber('minimum'),
        maximum: projectionFiniteNumber('maximum'),
        unitReferenceIndex: projectionInteger('unit reference index', 0),
      },
      ['minimum', 'maximum'],
    ),
    relationships: Object.freeze({}),
    referencePolicy: EXACT_SINGLE_INDEX_REFERENCE_POLICY,
  }),
  'balance.formula': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('formula label'),
      expression: BALANCE_FORMULA_EXPRESSION,
      outputUnitReferenceIndex: projectionInteger(
        'output unit reference index',
        0,
      ),
    }),
    relationships: Object.freeze({
      'depends-on': role([
        'balance.variable',
        'balance.parameter',
        'balance.formula',
      ]),
    }),
    referencePolicy: FORMULA_INDEXED_REFERENCE_POLICY,
  }),
  'balance.economy-source': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('economy source label'),
    }),
    relationships: Object.freeze({
      amount: role(['balance.variable', 'balance.formula'], {
        required: true,
        singleton: true,
      }),
      unit: role(['balance.unit'], { required: true, singleton: true }),
    }),
    referencePolicy: EXACT_EDGE_TARGETS_REFERENCE_POLICY,
  }),
  'balance.economy-sink': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('economy sink label'),
    }),
    relationships: Object.freeze({
      amount: role(['balance.variable', 'balance.formula'], {
        required: true,
        singleton: true,
      }),
      unit: role(['balance.unit'], { required: true, singleton: true }),
    }),
    referencePolicy: EXACT_EDGE_TARGETS_REFERENCE_POLICY,
  }),
  'balance.progression-curve': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('curve label'),
      points: projectionArray(
        projectionObject(
          {
            input: projectionFiniteNumber('curve input'),
            output: projectionFiniteNumber('curve output'),
          },
          ['input', 'output'],
          'curve point',
        ),
        'curve points',
      ),
    }),
    relationships: Object.freeze({}),
  }),
  'balance.reward': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('reward label'),
    }),
    relationships: Object.freeze({
      amount: role(['balance.variable', 'balance.formula'], {
        required: true,
        singleton: true,
      }),
    }),
    referencePolicy: EXACT_EDGE_TARGETS_REFERENCE_POLICY,
  }),
  'balance.cost': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('cost label'),
    }),
    relationships: Object.freeze({
      amount: role(['balance.variable', 'balance.formula'], {
        required: true,
        singleton: true,
      }),
    }),
    referencePolicy: EXACT_EDGE_TARGETS_REFERENCE_POLICY,
  }),
  'balance.reward-cost-binding': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('reward cost binding label'),
    }),
    relationships: Object.freeze({
      reward: role(['balance.reward'], { required: true, singleton: true }),
      cost: role(['balance.cost'], { required: true, singleton: true }),
      'triggered-by': role(['gameplay.action', 'gameplay.event'], {
        required: true,
        singleton: true,
      }),
    }),
    referencePolicy: EXACT_EDGE_TARGETS_REFERENCE_POLICY,
  }),
} as const)

const NODE_KINDS = new Set(Object.keys(BALANCE_DOMAIN_MANIFEST))
const FORMULA_OPERATORS = new Set([
  'add',
  'subtract',
  'multiply',
  'divide',
  'minimum',
  'maximum',
])
type BalanceFormulaBinaryOperator =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'minimum'
  | 'maximum'
const SAFE_NUMBER = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

type RecordValue = Record<string, unknown>
type ParsedNode = GameIrNode & { value: Readonly<Record<string, unknown>> }
type KnownTarget = Pick<GameIrNode, 'id' | 'kind'>
type NodeValidationOptions = Readonly<{ allowUnknownTargets?: boolean }>

function fail(message: string): never {
  throw new Error(`invalid Balance module: ${message}`)
}

function isRecord(value: unknown): value is RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(
  value: RecordValue,
  expected: readonly string[],
  label: string,
): void {
  const ownKeys = Reflect.ownKeys(value)
  for (const key of ownKeys) {
    if (typeof key !== 'string') fail(`${label} has an unknown symbol key`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    )
      fail(`${label} has a non-JSON property`)
  }
  const actual = (ownKeys as string[]).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    fail(`${label} has unknown or missing fields`)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    fail(`${label} must be non-empty text`)
  return value
}

function referenceIndex(value: unknown, length: number, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= length
  )
    fail(`${label} reference index is out of range`)
  return value
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson)
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]),
    )
  return value
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as RecordValue)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a || 1
}

function canonicalScale(
  value: unknown,
  label: string,
): Readonly<{ numerator: number; denominator: number }> {
  if (!isRecord(value)) fail(`${label} must be an object`)
  exactKeys(value, ['numerator', 'denominator'], label)
  if (
    typeof value.numerator !== 'number' ||
    !Number.isSafeInteger(value.numerator)
  )
    fail(`${label}.numerator must be a finite integer`)
  if (
    typeof value.denominator !== 'number' ||
    !Number.isSafeInteger(value.denominator) ||
    value.denominator === 0
  )
    fail(`${label}.denominator must be a non-zero finite integer`)
  if (value.numerator === 0) return { numerator: 0, denominator: 1 }
  const sign = value.denominator < 0 ? -1 : 1
  const divisor = gcd(value.numerator, value.denominator)
  return {
    numerator: (sign * value.numerator) / divisor,
    denominator: (sign * value.denominator) / divisor,
  }
}

function parseDimensions(
  value: unknown,
  label: string,
): readonly BalanceDimension[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const dimensions: BalanceDimension[] = []
  let previousBase: string | undefined
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index]
    if (!isRecord(entry)) fail(`${label}[${index}] must be an object`)
    exactKeys(entry, ['base', 'exponent'], `${label}[${index}]`)
    const base = text(entry.base, `${label}[${index}].base`)
    if (seen.has(base)) fail(`${label} contains duplicate dimension ${base}`)
    if (previousBase !== undefined && compareCodeUnits(previousBase, base) >= 0)
      fail(`${label} must be sorted by base`)
    previousBase = base
    seen.add(base)
    if (
      typeof entry.exponent !== 'number' ||
      !Number.isSafeInteger(entry.exponent)
    )
      fail(`${label}[${index}].exponent must be a finite integer`)
    if (entry.exponent !== 0)
      dimensions.push({ base, exponent: entry.exponent })
  }
  return dimensions
}

function parseUnit(value: unknown, label: string): BalanceUnit {
  if (!isRecord(value)) fail(`${label} must be an object`)
  exactKeys(value, ['symbol', 'dimensions', 'scale'], label)
  const symbol = text(value.symbol, `${label}.symbol`)
  return {
    symbol,
    dimensions: parseDimensions(value.dimensions, `${label}.dimensions`),
    scale: canonicalScale(value.scale, `${label}.scale`),
  }
}

function parseExpression(
  value: unknown,
  referencesLength: number,
  usedReferences: Set<number>,
  label = 'formula expression',
): BalanceFormulaExpression {
  if (!isRecord(value)) fail(`${label} must be an object`)
  if (value.kind === 'literal') {
    exactKeys(value, ['kind', 'value', 'unitReferenceIndex'], label)
    if (!SAFE_NUMBER(value.value)) fail(`${label}.value must be finite`)
    const unitReferenceIndex = referenceIndex(
      value.unitReferenceIndex,
      referencesLength,
      `${label}.unit`,
    )
    usedReferences.add(unitReferenceIndex)
    return { kind: 'literal', value: value.value, unitReferenceIndex }
  }
  if (value.kind === 'reference') {
    exactKeys(value, ['kind', 'referenceIndex'], label)
    const index = referenceIndex(value.referenceIndex, referencesLength, label)
    usedReferences.add(index)
    return { kind: 'reference', referenceIndex: index }
  }
  if (value.kind === 'negate' || value.kind === 'absolute') {
    exactKeys(value, ['kind', 'operand'], label)
    return {
      kind: value.kind,
      operand: parseExpression(
        value.operand,
        referencesLength,
        usedReferences,
        `${label}.operand`,
      ),
    }
  }
  if (value.kind === 'binary') {
    exactKeys(value, ['kind', 'operator', 'left', 'right'], label)
    if (
      typeof value.operator !== 'string' ||
      !FORMULA_OPERATORS.has(value.operator)
    )
      fail(`${label}.operator is unknown`)
    return {
      kind: 'binary',
      operator: value.operator as BalanceFormulaBinaryOperator,
      left: parseExpression(
        value.left,
        referencesLength,
        usedReferences,
        `${label}.left`,
      ),
      right: parseExpression(
        value.right,
        referencesLength,
        usedReferences,
        `${label}.right`,
      ),
    }
  }
  fail(`${label} has an unknown kind`)
}

function formulaReferenceRule(
  path: string,
): Readonly<{
  path: string
  targetKinds: readonly string[]
  recursive: boolean
}> {
  const policy = BALANCE_DOMAIN_MANIFEST['balance.formula'].referencePolicy
  if (!policy || policy.kind !== 'formula-indexed-references')
    fail('balance.formula has no formula indexed-reference policy')
  const rule = policy.indexedReferences.find(candidate => candidate.path === path)
  if (!rule) fail(`balance.formula policy is missing ${path}`)
  return rule
}

function assertFormulaIndexedReference(
  node: GameIrNode,
  index: number,
  path: string,
): void {
  const rule = formulaReferenceRule(path)
  const reference = node.references[index]
  const received = reference?.targetType ?? '<missing>'
  if (!reference || !rule.targetKinds.includes(reference.targetType))
    fail(
      `node ${node.id} indexed reference at ${path} expects ${rule.targetKinds.join('/')}; received ${received}`,
    )
}

function validateFormulaIndexedReferences(
  node: GameIrNode,
  expression: BalanceFormulaExpression,
  outputUnitReferenceIndex: number,
): void {
  assertFormulaIndexedReference(
    node,
    outputUnitReferenceIndex,
    'value.outputUnitReferenceIndex',
  )
  const visit = (entry: BalanceFormulaExpression): void => {
    if (entry.kind === 'literal') {
      assertFormulaIndexedReference(
        node,
        entry.unitReferenceIndex,
        'value.expression.literal.unitReferenceIndex',
      )
      return
    }
    if (entry.kind === 'reference') {
      assertFormulaIndexedReference(
        node,
        entry.referenceIndex,
        'value.expression.reference.referenceIndex',
      )
      return
    }
    if ('operand' in entry) {
      visit(entry.operand)
      return
    }
    visit(entry.left)
    visit(entry.right)
  }
  visit(expression)
}

function validateReferences(
  node: GameIrNode,
  targets: ReadonlyMap<string, KnownTarget>,
  options: NodeValidationOptions = {},
): void {
  for (const reference of node.references) {
    const target = targets.get(reference.targetId)
    if (!target) {
      if (options.allowUnknownTargets) continue
      fail(
        `node ${node.id} reference targets unknown node ${reference.targetId}`,
      )
    }
    if (target.kind !== reference.targetType)
      fail(
        `node ${node.id} reference target kind does not match ${reference.targetId}`,
      )
  }
  for (const edgeValue of node.edges) {
    const target = targets.get(edgeValue.targetId)
    if (!target) {
      if (options.allowUnknownTargets) continue
      fail(`node ${node.id} edge targets unknown node ${edgeValue.targetId}`)
    }
    if (target.kind !== edgeValue.targetType)
      fail(
        `node ${node.id} edge target kind does not match ${edgeValue.targetId}`,
      )
  }
}

function targetMap(
  nodes: readonly GameIrNode[],
  externalTargets: ReadonlyMap<string, GameIrNode> | undefined,
): Map<string, GameIrNode> {
  const targets = new Map<string, GameIrNode>()
  for (const node of nodes) {
    if (!isRecord(node)) fail('every node must be an object')
    if (targets.has(node.id)) fail(`duplicate node ID ${node.id}`)
    targets.set(node.id, node)
  }
  if (externalTargets) {
    for (const [id, node] of externalTargets) {
      if (id !== node.id)
        fail(`external target key does not match node ${node.id}`)
      if (!node.kind.startsWith('gameplay.'))
        fail(`external target ${id} is not a Gameplay node`)
      if (targets.has(id)) fail(`duplicate node ID ${id}`)
      targets.set(id, node)
    }
  }
  return targets
}

function validateRoles(
  node: GameIrNode,
  targets: ReadonlyMap<string, KnownTarget>,
  options: NodeValidationOptions = {},
): void {
  const manifest = BALANCE_DOMAIN_MANIFEST[
    node.kind as keyof typeof BALANCE_DOMAIN_MANIFEST
  ]?.relationships as
    | Readonly<Record<string, BalanceRelationshipRole>>
    | undefined
  if (!manifest) fail(`node ${node.id} has an unknown kind`)
  const counts = new Map<string, number>()
  const seenEdges = new Set<string>()
  for (const edgeValue of node.edges) {
    const roleRule = manifest[edgeValue.type]
    if (!roleRule)
      fail(`node ${node.id} has unknown relationship role ${edgeValue.type}`)
    if (!roleRule.targetKinds.includes(edgeValue.targetType))
      fail(`node ${node.id} role ${edgeValue.type} has wrong target kind`)
    const edgeKey = `${edgeValue.type}\0${edgeValue.targetId}\0${edgeValue.targetType}`
    if (seenEdges.has(edgeKey))
      fail(`node ${node.id} has duplicate relationship role ${edgeValue.type}`)
    seenEdges.add(edgeKey)
    const count = (counts.get(edgeValue.type) ?? 0) + 1
    if (roleRule.singleton && count > 1)
      fail(
        `node ${node.id} has duplicate singleton relationship role ${edgeValue.type}`,
      )
    counts.set(edgeValue.type, count)
    if (!targets.has(edgeValue.targetId) && !options.allowUnknownTargets)
      fail(`node ${node.id} role target is invalid`)
  }
  for (const [roleName, roleRule] of Object.entries(manifest)) {
    if (roleRule.required && !counts.has(roleName))
      fail(`node ${node.id} is missing required relationship role ${roleName}`)
  }
}

function exactRoleReferences(node: GameIrNode): void {
  const manifest =
    BALANCE_DOMAIN_MANIFEST[
      node.kind as keyof typeof BALANCE_DOMAIN_MANIFEST
    ]
  if (
    !manifest ||
    !('referencePolicy' in manifest) ||
    manifest.referencePolicy?.kind !== 'exact-edge-targets'
  )
    return
  const edgeTargets = node.edges
    .map(edgeValue => edgeValue.targetId)
    .sort(compareCodeUnits)
  const referenceTargets = node.references
    .map(reference => reference.targetId)
    .sort(compareCodeUnits)
  if (
    edgeTargets.length !== referenceTargets.length ||
    edgeTargets.some((targetId, index) => targetId !== referenceTargets[index])
  )
    fail(
      `node ${node.id} relationship references do not match role edges: expected target IDs [${edgeTargets.join(', ')}], received target IDs [${referenceTargets.join(', ')}]`,
    )
}

function parseVariableValue(
  node: GameIrNode,
  manifest: Pick<
    (typeof BALANCE_DOMAIN_MANIFEST)[keyof typeof BALANCE_DOMAIN_MANIFEST],
    'valueJsonSchema'
  >,
): Readonly<Record<string, unknown>> {
  if (!isRecord(node.value)) fail(`node ${node.id} value must be an object`)
  const optionalFields = new Set<string>(
    projectionValueOptionalFields(manifest.valueJsonSchema),
  )
  const fields = projectionValueFields(manifest.valueJsonSchema).filter(
    field => !optionalFields.has(field) || Object.hasOwn(node.value, field),
  )
  exactKeys(node.value, fields, `node ${node.id} value`)
  const label = text(node.value.label, `node ${node.id} label`)
  if (!SAFE_NUMBER(node.value.baseline))
    fail(`node ${node.id} baseline must be finite`)
  const minimum = node.value.minimum
  const maximum = node.value.maximum
  if (minimum !== undefined && !SAFE_NUMBER(minimum))
    fail(`node ${node.id} minimum must be finite`)
  if (maximum !== undefined && !SAFE_NUMBER(maximum))
    fail(`node ${node.id} maximum must be finite`)
  if (minimum !== undefined && maximum !== undefined && minimum > maximum)
    fail(`node ${node.id} minimum cannot exceed maximum`)
  if (minimum !== undefined && node.value.baseline < minimum)
    fail(`node ${node.id} baseline is below minimum`)
  if (maximum !== undefined && node.value.baseline > maximum)
    fail(`node ${node.id} baseline is above maximum`)
  const unitReferenceIndex = node.value.unitReferenceIndex
  return {
    label,
    baseline: node.value.baseline,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    unitReferenceIndex,
  }
}

function validateReferencePolicy(
  node: GameIrNode,
  policy: BalanceReferencePolicy | undefined,
  consumedReferences: Set<number>,
): Set<number> {
  if (!policy) return consumedReferences
  if (policy.kind === 'exact-edge-targets') {
    exactRoleReferences(node)
    for (let index = 0; index < node.references.length; index += 1)
      consumedReferences.add(index)
    return consumedReferences
  }
  if (policy.kind === 'formula-indexed-references') {
    if (!policy.consumesEveryReference)
      fail('formula indexed-reference policy must consume every reference')
    return consumedReferences
  }
  const indexValue = node.value[policy.indexField]
  if (
    node.references.length !== 1 ||
    indexValue !== policy.requiredIndex
  ) {
    const receivedIndex =
      typeof indexValue === 'number' ? String(indexValue) : JSON.stringify(indexValue)
    fail(
      `node ${node.id} unit reference policy requires ${policy.cardinality} ${policy.targetKinds.join('/')} reference at index ${policy.requiredIndex}; received index ${receivedIndex} with ${node.references.length} reference${node.references.length === 1 ? '' : 's'}`,
    )
  }
  const reference = node.references[policy.requiredIndex]
  if (
    !reference ||
    !policy.targetKinds.some(targetKind => targetKind === reference.targetType)
  )
    fail(
      `node ${node.id} unit reference must target ${policy.targetKinds.join('/')}`,
    )
  consumedReferences.add(policy.requiredIndex)
  return consumedReferences
}

function parseFormulaValue(node: GameIrNode): {
  value: Readonly<Record<string, unknown>>
  consumedReferences: Set<number>
} {
  if (!isRecord(node.value)) fail(`node ${node.id} value must be an object`)
  exactKeys(
    node.value,
    projectionValueRequiredFields(
      BALANCE_DOMAIN_MANIFEST['balance.formula'].valueJsonSchema,
    ),
    `node ${node.id} value`,
  )
  const usedReferences = new Set<number>()
  const expression = parseExpression(
    node.value.expression,
    node.references.length,
    usedReferences,
    `node ${node.id} formula expression`,
  )
  const outputUnitReferenceIndex = referenceIndex(
    node.value.outputUnitReferenceIndex,
    node.references.length,
    `node ${node.id} output unit`,
  )
  usedReferences.add(outputUnitReferenceIndex)
  validateFormulaIndexedReferences(
    node,
    expression,
    outputUnitReferenceIndex,
  )
  return {
    value: {
      label: text(node.value.label, `node ${node.id} label`),
      expression,
      outputUnitReferenceIndex,
    },
    consumedReferences: usedReferences,
  }
}

function parsePoints(
  node: GameIrNode,
): readonly Readonly<{ input: number; output: number }>[] {
  if (!Array.isArray(node.value.points) || node.value.points.length === 0)
    fail(`node ${node.id} points must not be empty`)
  const points: Array<Readonly<{ input: number; output: number }>> = []
  let previousInput: number | undefined
  for (let index = 0; index < node.value.points.length; index += 1) {
    const point = node.value.points[index]
    if (!isRecord(point))
      fail(`node ${node.id} point ${index} must be an object`)
    exactKeys(point, ['input', 'output'], `node ${node.id} point ${index}`)
    if (!SAFE_NUMBER(point.input) || !SAFE_NUMBER(point.output))
      fail(`node ${node.id} point ${index} coordinates must be finite`)
    if (previousInput !== undefined && point.input <= previousInput)
      fail(`node ${node.id} progression inputs must be strictly increasing`)
    previousInput = point.input
    points.push({ input: point.input, output: point.output })
  }
  return points
}

function parseValue(node: GameIrNode): {
  value: Readonly<Record<string, unknown>>
  consumedReferences?: Set<number>
} {
  if (!isRecord(node.value)) fail(`node ${node.id} value must be an object`)
  if (node.kind === 'balance.unit') {
    exactKeys(
      node.value,
      projectionValueRequiredFields(
        BALANCE_DOMAIN_MANIFEST['balance.unit'].valueJsonSchema,
      ),
      `node ${node.id} value`,
    )
    return {
      value: parseUnit(
        node.value,
        `node ${node.id} value`,
      ) as unknown as Readonly<Record<string, unknown>>,
    }
  }
  if (node.kind === 'balance.variable' || node.kind === 'balance.parameter') {
    return {
      value: parseVariableValue(
        node,
        BALANCE_DOMAIN_MANIFEST[node.kind],
      ),
    }
  }
  if (node.kind === 'balance.formula') {
    const parsed = parseFormulaValue(node)
    return {
      value: parsed.value,
      consumedReferences: parsed.consumedReferences,
    }
  }
  if (node.kind === 'balance.progression-curve') {
    exactKeys(
      node.value,
      projectionValueRequiredFields(
        BALANCE_DOMAIN_MANIFEST['balance.progression-curve'].valueJsonSchema,
      ),
      `node ${node.id} value`,
    )
    return {
      value: {
        label: text(node.value.label, `node ${node.id} label`),
        points: parsePoints(node),
      },
    }
  }
  const fields =
    BALANCE_DOMAIN_MANIFEST[node.kind as keyof typeof BALANCE_DOMAIN_MANIFEST]
      .valueJsonSchema
  if (!fields) fail(`node ${node.id} has an unknown kind`)
  const fieldNames = projectionValueRequiredFields(fields)
  exactKeys(node.value, fieldNames, `node ${node.id} value`)
  return { value: { label: text(node.value.label, `node ${node.id} label`) } }
}

function assertReferenceConsumption(
  node: GameIrNode,
  consumedReferences: ReadonlySet<number>,
): void {
  for (let index = 0; index < node.references.length; index += 1) {
    if (!consumedReferences.has(index))
      fail(`node ${node.id} has an unused reference at index ${index}`)
  }
}

function assertNoEmbeddedTargetIds(
  value: unknown,
  targetIds: ReadonlySet<string>,
  label: string,
): void {
  if (typeof value === 'string') {
    if (targetIds.has(value)) fail(`${label} embeds target ID in a value`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoEmbeddedTargetIds(entry, targetIds, `${label}[${index}]`),
    )
    return
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value))
      assertNoEmbeddedTargetIds(entry, targetIds, `${label}.${key}`)
  }
}

function dimensionsEqual(
  left: readonly BalanceDimension[],
  right: readonly BalanceDimension[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (dimension, index) =>
        dimension.base === right[index]!.base &&
        dimension.exponent === right[index]!.exponent,
    )
  )
}

function unitsEqual(left: BalanceUnit, right: BalanceUnit): boolean {
  return (
    dimensionsEqual(left.dimensions, right.dimensions) &&
    left.scale.numerator === right.scale.numerator &&
    left.scale.denominator === right.scale.denominator
  )
}

export function combineDimensions(
  left: readonly BalanceDimension[],
  right: readonly BalanceDimension[],
  direction: 1 | -1,
  label = 'inferred dimension exponent is not a finite integer',
): readonly BalanceDimension[] {
  const exponents = new Map<string, number>()
  for (const dimension of left)
    exponents.set(dimension.base, dimension.exponent)
  for (const dimension of right) {
    const exponent =
      (exponents.get(dimension.base) ?? 0) + direction * dimension.exponent
    if (!Number.isSafeInteger(exponent))
      fail(label)
    if (exponent === 0) exponents.delete(dimension.base)
    else exponents.set(dimension.base, exponent)
  }
  return [...exponents.entries()]
    .sort(([leftBase], [rightBase]) => compareCodeUnits(leftBase, rightBase))
    .map(([base, exponent]) => ({ base, exponent }))
}

function combineScale(
  left: BalanceUnit,
  right: BalanceUnit,
  direction: 1 | -1,
  label = 'inferred unit scale is not a finite rational',
): Readonly<{ numerator: number; denominator: number }> {
  const numerator =
    direction === 1
      ? left.scale.numerator * right.scale.numerator
      : left.scale.numerator * right.scale.denominator
  const denominator =
    direction === 1
      ? left.scale.denominator * right.scale.denominator
      : left.scale.denominator * right.scale.numerator
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator === 0
  )
    fail(label)
  return canonicalScale({ numerator, denominator }, label)
}

function unitForNode(
  node: GameIrNode,
  targets: ReadonlyMap<string, GameIrNode>,
  units: ReadonlyMap<string, BalanceUnit>,
  formulas: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  active: Set<string>,
): BalanceUnit {
  if (node.kind === 'balance.unit') return units.get(node.id)!
  if (node.kind === 'balance.variable' || node.kind === 'balance.parameter') {
    const manifest =
      BALANCE_DOMAIN_MANIFEST[node.kind as keyof typeof BALANCE_DOMAIN_MANIFEST]
    const policy =
      'referencePolicy' in manifest ? manifest.referencePolicy : undefined
    if (!policy || policy.kind !== 'exact-single-index-reference')
      fail(`node ${node.id} has no unit reference policy`)
    const reference =
      node.references[node.value[policy.indexField] as number]
    if (!reference) fail(`node ${node.id} has no unit reference`)
    const unit = targets.get(reference.targetId)
    if (
      !unit ||
      !policy.targetKinds.some(targetKind => targetKind === unit.kind)
    )
      fail(`node ${node.id} unit reference is invalid`)
    return units.get(unit.id)!
  }
  if (node.kind !== 'balance.formula')
    fail(`node ${node.id} is not a numeric target`)
  const cached = formulas.get(node.id)
  if (cached) return cached as unknown as BalanceUnit
  if (active.has(node.id)) fail(`formula dependency cycle at ${node.id}`)
  active.add(node.id)
  const value = node.value as Readonly<Record<string, unknown>>
  const expression = value.expression as BalanceFormulaExpression
  const infer = (entry: BalanceFormulaExpression): BalanceUnit => {
    if (entry.kind === 'literal') {
      const reference = node.references[entry.unitReferenceIndex]
      const unit = reference && targets.get(reference.targetId)
      if (!unit || unit.kind !== 'balance.unit')
        fail(`formula ${node.id} literal unit reference is invalid`)
      return units.get(unit.id)!
    }
    if (entry.kind === 'reference') {
      const reference = node.references[entry.referenceIndex]
      const target = reference && targets.get(reference.targetId)
      if (
        !target ||
        !['balance.variable', 'balance.parameter', 'balance.formula'].includes(
          target.kind,
        )
      )
        fail(`formula ${node.id} reference is not numeric`)
      return unitForNode(target, targets, units, formulas, active)
    }
    if (entry.kind === 'negate' || entry.kind === 'absolute')
      return infer(entry.operand)
    const binary = entry as BalanceBinaryExpression
    const left = infer(binary.left)
    const right = infer(binary.right)
    if (
      binary.operator === 'add' ||
      binary.operator === 'subtract' ||
      binary.operator === 'minimum' ||
      binary.operator === 'maximum'
    ) {
      if (!dimensionsEqual(left.dimensions, right.dimensions))
        fail(
          `formula ${node.id} ${binary.operator} has a unit dimension mismatch`,
        )
      return left
    }
    if (binary.operator === 'divide' && isProvenZero(binary.right))
      fail(`formula ${node.id} divides by a proven zero literal`)
    return {
      symbol: '',
      dimensions: combineDimensions(
        left.dimensions,
        right.dimensions,
        binary.operator === 'multiply' ? 1 : -1,
        `node ${node.id} inferred dimension exponent is not a finite integer`,
      ),
      scale: combineScale(
        left,
        right,
        binary.operator === 'multiply' ? 1 : -1,
        `node ${node.id} inferred unit scale is not a finite rational`,
      ),
    }
  }
  const inferred = infer(expression)
  const outputReference =
    node.references[value.outputUnitReferenceIndex as number]
  const outputTarget = outputReference && targets.get(outputReference.targetId)
  if (!outputTarget || outputTarget.kind !== 'balance.unit')
    fail(`formula ${node.id} output unit reference is invalid`)
  const output = units.get(outputTarget.id)!
  if (!unitsEqual(inferred, output))
    fail(`formula ${node.id} output unit does not match inferred unit`)
  active.delete(node.id)
  ;(formulas as Map<string, BalanceUnit>).set(node.id, inferred)
  return inferred
}

function constantValue(
  expression: BalanceFormulaExpression,
): number | undefined {
  if (expression.kind === 'literal') return expression.value
  if (expression.kind === 'reference') return undefined
  if (expression.kind === 'negate' || expression.kind === 'absolute') {
    const value = constantValue(expression.operand)
    return value === undefined
      ? undefined
      : expression.kind === 'negate'
        ? -value
        : Math.abs(value)
  }
  const binary = expression as BalanceBinaryExpression
  const left = constantValue(binary.left)
  const right = constantValue(binary.right)
  if (left === undefined || right === undefined) return undefined
  switch (binary.operator) {
    case 'add':
      return left + right
    case 'subtract':
      return left - right
    case 'multiply':
      return left * right
    case 'divide':
      return right === 0 ? undefined : left / right
    case 'minimum':
      return Math.min(left, right)
    case 'maximum':
      return Math.max(left, right)
  }
}

function isProvenZero(expression: BalanceFormulaExpression): boolean {
  const value = constantValue(expression)
  return value !== undefined && value === 0
}

function assertEconomyUnitCoherence(
  nodes: readonly ParsedNode[],
  targets: ReadonlyMap<string, GameIrNode>,
  units: ReadonlyMap<string, BalanceUnit>,
  formulas: ReadonlyMap<string, BalanceUnit>,
): void {
  for (const node of nodes) {
    if (
      node.kind !== 'balance.economy-source' &&
      node.kind !== 'balance.economy-sink'
    )
      continue
    const amountEdge = node.edges.find(edgeValue => edgeValue.type === 'amount')
    const unitEdge = node.edges.find(edgeValue => edgeValue.type === 'unit')
    const amountTarget = amountEdge && targets.get(amountEdge.targetId)
    const explicitUnit = unitEdge && units.get(unitEdge.targetId)
    if (!amountTarget || !explicitUnit)
      fail(`node ${node.id} economy amount or unit target is invalid`)
    const inferredAmountUnit = unitForNode(
      amountTarget,
      targets,
      units,
      formulas,
      new Set(),
    )
    if (!unitsEqual(inferredAmountUnit, explicitUnit))
      fail(`node ${node.id} economy amount and unit are not coherent`)
  }
}

/**
 * Parses one Balance node through the same value/reference/role rules used by
 * the complete module parser. Aggregate formula/economy closure stays below.
 */
export function parseBalanceProjectionNode(
  node: GameIrNode,
  targets: ReadonlyMap<string, KnownTarget>,
  options: NodeValidationOptions = {},
): ParsedNode {
  if (typeof node.id !== 'string' || node.id.length === 0)
    fail('node has an invalid ID')
  if (typeof node.kind !== 'string' || !NODE_KINDS.has(node.kind))
    fail(`node ${node.id} has an unknown kind`)
  if (!node.kind.startsWith('balance.'))
    fail(`node ${node.id} has an invalid Balance kind`)
  validateReferences(node, targets, options)
  const parsedValue = parseValue(node)
  validateRoles(node, targets, options)
  const consumedReferences = parsedValue.consumedReferences ?? new Set<number>()
  const manifest =
    BALANCE_DOMAIN_MANIFEST[node.kind as keyof typeof BALANCE_DOMAIN_MANIFEST]
  const policy =
    'referencePolicy' in manifest ? manifest.referencePolicy : undefined
  validateReferencePolicy(node, policy, consumedReferences)
  assertReferenceConsumption(node, consumedReferences)
  return {
    ...node,
    value: parsedValue.value,
    references: node.references.map(reference => ({ ...reference })),
    edges: node.edges.map(edgeValue => ({ ...edgeValue })),
    bindings: cloneJson(node.bindings) as GameIrNode['bindings'],
  }
}

export function parseBalanceModule(
  module: GameIrModuleCandidate,
  externalTargets?: ReadonlyMap<string, GameIrNode>,
): GameIrModuleCandidate {
  if (!module || typeof module !== 'object' || module.moduleId !== 'balance')
    fail('module ID must be balance')
  if (!Array.isArray(module.nodes)) fail('module nodes must be an array')
  const localNodes = module.nodes
  const targets = targetMap(localNodes, externalTargets)
  const parsed: ParsedNode[] = []
  for (let index = 0; index < localNodes.length; index += 1) {
    parsed.push(parseBalanceProjectionNode(localNodes[index]!, targets))
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if (compareCodeUnits(parsed[index - 1]!.id, parsed[index]!.id) >= 0)
      fail('node IDs must be unique and sorted')
  }
  const units = new Map<string, BalanceUnit>()
  for (const node of parsed)
    if (node.kind === 'balance.unit')
      units.set(node.id, node.value as unknown as BalanceUnit)
  const formulas = new Map<string, BalanceUnit>()
  for (const node of parsed) {
    if (node.kind !== 'balance.formula') continue
    const value = node.value as Readonly<Record<string, unknown>>
    const expression = value.expression as BalanceFormulaExpression
    const dependencies = new Set<string>()
    const visit = (entry: BalanceFormulaExpression): void => {
      if (entry.kind === 'reference') {
        const reference = node.references[entry.referenceIndex]
        if (!reference) fail(`formula ${node.id} reference is dangling`)
        dependencies.add(reference.targetId)
        return
      }
      if (entry.kind === 'literal') return
      if (entry.kind === 'negate' || entry.kind === 'absolute') {
        visit(entry.operand)
        return
      }
      const binary = entry as BalanceBinaryExpression
      visit(binary.left)
      visit(binary.right)
    }
    visit(expression)
    const edgeDependencies = node.edges
      .filter(edgeValue => edgeValue.type === 'depends-on')
      .map(edgeValue => edgeValue.targetId)
    const sortedDependencies = [...dependencies].sort(compareCodeUnits)
    const sortedEdgeDependencies = [...new Set(edgeDependencies)].sort(
      compareCodeUnits,
    )
    if (
      sortedDependencies.length !== sortedEdgeDependencies.length ||
      sortedDependencies.some(
        (id, index) => id !== sortedEdgeDependencies[index],
      )
    )
      fail(
        `formula ${node.id} dependency edges do not match its AST references`,
      )
  }
  for (const node of parsed) {
    if (node.kind === 'balance.formula')
      unitForNode(node, targets, units, formulas, new Set())
  }
  assertEconomyUnitCoherence(parsed, targets, units, formulas)
  const targetIds = new Set(targets.keys())
  for (const node of parsed)
    assertNoEmbeddedTargetIds(node.value, targetIds, `node ${node.id} value`)
  return deepFreeze({ moduleId: 'balance', nodes: parsed })
}
