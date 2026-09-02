import {
  compareCodeUnits,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'
import {
  projectionBoolean,
  projectionEnum,
  projectionObject,
  projectionRecursive,
  projectionText,
  projectionValueRequiredFields,
  projectionValueSchema,
} from './projection-schema'

const GAMEPLAY_SCALAR_EXPRESSION_SCHEMA = projectionRecursive('scalar', {
  scalar: {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { const: 'literal' },
          value: {
            anyOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'boolean' },
            ],
          },
        },
        required: ['kind', 'value'],
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
    ],
  },
})
const GAMEPLAY_CONDITION_EXPRESSION_SCHEMA = projectionRecursive('condition', {
  scalar: {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { const: 'literal' },
          value: {
            anyOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'boolean' },
            ],
          },
        },
        required: ['kind', 'value'],
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
    ],
  },
  condition: {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { kind: { const: 'boolean' }, value: { type: 'boolean' } },
        required: ['kind', 'value'],
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
          kind: { const: 'not' },
          operand: { $ref: '#/$defs/condition' },
        },
        required: ['kind', 'operand'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { enum: ['all', 'any'] },
          operands: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/condition' },
          },
        },
        required: ['kind', 'operands'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { const: 'compare' },
          operator: { enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] },
          left: { $ref: '#/$defs/scalar' },
          right: { $ref: '#/$defs/scalar' },
        },
        required: ['kind', 'operator', 'left', 'right'],
      },
    ],
  },
})
const GAMEPLAY_EFFECT_EXPRESSION_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        operation: { enum: ['set', 'add'] },
        targetReferenceIndex: { type: 'integer', minimum: 0 },
        value: {
          anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
        },
      },
      required: ['operation', 'targetReferenceIndex', 'value'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        operation: { enum: ['remove', 'emit'] },
        targetReferenceIndex: { type: 'integer', minimum: 0 },
      },
      required: ['operation', 'targetReferenceIndex'],
    },
  ],
} as const

export type GameplayScalarExpression =
  | Readonly<{
      kind: 'literal'
      value: string | number | boolean
    }>
  | Readonly<{
      kind: 'reference'
      referenceIndex: number
    }>

export type GameplayConditionExpression =
  | Readonly<{ kind: 'boolean'; value: boolean }>
  | Readonly<{ kind: 'reference'; referenceIndex: number }>
  | Readonly<{ kind: 'not'; operand: GameplayConditionExpression }>
  | Readonly<{
      kind: 'all' | 'any'
      operands: readonly GameplayConditionExpression[]
    }>
  | Readonly<{
      kind: 'compare'
      operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'
      left: GameplayScalarExpression
      right: GameplayScalarExpression
    }>

export type GameplayEffectExpression =
  | Readonly<{
      operation: 'set' | 'add'
      targetReferenceIndex: number
      value: string | number | boolean
    }>
  | Readonly<{
      operation: 'remove'
      targetReferenceIndex: number
    }>
  | Readonly<{
      operation: 'emit'
      targetReferenceIndex: number
    }>

export type GameplayRelationshipRole = Readonly<{
  targetKinds: readonly string[]
  required: boolean
  singleton: boolean
}>

const role = (
  targetKinds: readonly string[],
  options: Readonly<{ required?: boolean; singleton?: boolean }> = {},
): GameplayRelationshipRole =>
  Object.freeze({
    targetKinds: Object.freeze([...targetKinds]),
    required: options.required === true,
    singleton: options.singleton === true,
  })

/** The single schema-owned authority for Gameplay kinds, values, and roles. */
export const GAMEPLAY_DOMAIN_MANIFEST = Object.freeze({
  'gameplay.entity': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('entity label'),
    }),
    relationships: Object.freeze({}),
  }),
  'gameplay.capability': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('capability label'),
    }),
    relationships: Object.freeze({
      'belongs-to': role(['gameplay.entity'], {
        required: true,
        singleton: true,
      }),
    }),
  }),
  'gameplay.action': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('action label'),
    }),
    relationships: Object.freeze({
      requires: role(['gameplay.condition'], { required: true }),
      causes: role(['gameplay.effect', 'gameplay.event'], { required: true }),
    }),
  }),
  'gameplay.rule': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('rule label'),
    }),
    relationships: Object.freeze({
      'triggered-by': role(['gameplay.event'], {
        required: true,
        singleton: true,
      }),
      guards: role(['gameplay.condition'], { singleton: true }),
    }),
  }),
  'gameplay.condition': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      expression: GAMEPLAY_CONDITION_EXPRESSION_SCHEMA,
    }),
    relationships: Object.freeze({}),
  }),
  'gameplay.effect': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      effect: GAMEPLAY_EFFECT_EXPRESSION_SCHEMA,
    }),
    relationships: Object.freeze({}),
  }),
  'gameplay.event': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('event label'),
    }),
    relationships: Object.freeze({}),
  }),
  'gameplay.state': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('state label'),
      initial: projectionBoolean('whether this is the initial state'),
      terminal: projectionEnum(
        ['none', 'success', 'failure'],
        'terminal outcome',
      ),
    }),
    relationships: Object.freeze({}),
  }),
  'gameplay.transition': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('transition label'),
    }),
    relationships: Object.freeze({
      from: role(['gameplay.state'], { required: true, singleton: true }),
      to: role(['gameplay.state'], { required: true, singleton: true }),
      on: role(['gameplay.event', 'gameplay.condition'], { singleton: true }),
    }),
  }),
  'gameplay.objective': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('objective label'),
    }),
    relationships: Object.freeze({
      'succeeds-with': role(['gameplay.outcome'], { singleton: true }),
      'fails-with': role(['gameplay.outcome'], { singleton: true }),
    }),
  }),
  'gameplay.outcome': Object.freeze({
    valueJsonSchema: projectionValueSchema({
      label: projectionText('outcome label'),
      result: projectionEnum(['win', 'loss', 'neutral'], 'outcome result'),
    }),
    relationships: Object.freeze({}),
  }),
} as const)

const NODE_KINDS = new Set(Object.keys(GAMEPLAY_DOMAIN_MANIFEST))
const OUTCOME_RESULTS = new Set(['win', 'loss', 'neutral'])
const COMPARISON_OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte'])
const EFFECT_OPERATIONS = new Set(['set', 'add', 'remove', 'emit'])
const SAFE_NUMBER = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

type RecordValue = Record<string, unknown>

function fail(message: string): never {
  throw new Error(`invalid Gameplay module: ${message}`)
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

function index(value: unknown, length: number, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= length
  )
    fail(`${label} reference index is out of range`)
  return value
}

function scalar(
  value: unknown,
  referencesLength: number,
  label: string,
): GameplayScalarExpression {
  if (!isRecord(value)) fail(`${label} must be an object`)
  if (value.kind === 'literal') {
    exactKeys(value, ['kind', 'value'], label)
    if (
      typeof value.value !== 'string' &&
      typeof value.value !== 'boolean' &&
      !SAFE_NUMBER(value.value)
    )
      fail(`${label} literal value must be a finite scalar`)
    return {
      kind: 'literal',
      value: value.value as string | number | boolean,
    }
  }
  if (value.kind === 'reference') {
    exactKeys(value, ['kind', 'referenceIndex'], label)
    return {
      kind: 'reference',
      referenceIndex: index(value.referenceIndex, referencesLength, label),
    }
  }
  fail(`${label} has an unknown kind`)
}

function condition(
  value: unknown,
  referencesLength: number,
  label = 'condition expression',
): GameplayConditionExpression {
  if (!isRecord(value)) fail(`${label} must be an object`)
  if (value.kind === 'boolean') {
    exactKeys(value, ['kind', 'value'], label)
    if (typeof value.value !== 'boolean')
      fail(`${label} boolean value is invalid`)
    return { kind: 'boolean', value: value.value }
  }
  if (value.kind === 'reference') {
    exactKeys(value, ['kind', 'referenceIndex'], label)
    return {
      kind: 'reference',
      referenceIndex: index(value.referenceIndex, referencesLength, label),
    }
  }
  if (value.kind === 'not') {
    exactKeys(value, ['kind', 'operand'], label)
    return {
      kind: 'not',
      operand: condition(value.operand, referencesLength, `${label}.operand`),
    }
  }
  if (value.kind === 'all' || value.kind === 'any') {
    exactKeys(value, ['kind', 'operands'], label)
    if (!Array.isArray(value.operands) || value.operands.length === 0)
      fail(`${label} operands must not be empty`)
    return {
      kind: value.kind,
      operands: value.operands.map((operand, operandIndex) =>
        condition(
          operand,
          referencesLength,
          `${label}.operands[${operandIndex}]`,
        ),
      ),
    }
  }
  if (value.kind === 'compare') {
    exactKeys(value, ['kind', 'operator', 'left', 'right'], label)
    if (
      typeof value.operator !== 'string' ||
      !COMPARISON_OPERATORS.has(value.operator)
    )
      fail(`${label} has an unknown comparison operator`)
    return {
      kind: 'compare',
      operator: value.operator as 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte',
      left: scalar(value.left, referencesLength, `${label}.left`),
      right: scalar(value.right, referencesLength, `${label}.right`),
    }
  }
  fail(`${label} has an unknown kind`)
}

function effect(
  value: unknown,
  referencesLength: number,
): GameplayEffectExpression {
  if (!isRecord(value)) fail('effect expression must be an object')
  if (
    typeof value.operation !== 'string' ||
    !EFFECT_OPERATIONS.has(value.operation)
  )
    fail('effect expression has an unknown operation')
  if (value.operation === 'set' || value.operation === 'add') {
    exactKeys(
      value,
      ['operation', 'targetReferenceIndex', 'value'],
      'effect expression',
    )
    if (
      typeof value.value !== 'string' &&
      typeof value.value !== 'boolean' &&
      !SAFE_NUMBER(value.value)
    )
      fail('effect expression value must be a finite scalar')
    return {
      operation: value.operation,
      targetReferenceIndex: index(
        value.targetReferenceIndex,
        referencesLength,
        'effect target reference',
      ),
      value: value.value as string | number | boolean,
    }
  }
  exactKeys(value, ['operation', 'targetReferenceIndex'], 'effect expression')
  return {
    operation: value.operation as 'remove' | 'emit',
    targetReferenceIndex: index(
      value.targetReferenceIndex,
      referencesLength,
      'effect target reference',
    ),
  }
}

function label(value: RecordValue, nodeId: string): string {
  return text(value.label, `node ${nodeId} label`)
}

function parseValue(node: GameIrNode): Readonly<Record<string, unknown>> {
  if (!isRecord(node.value)) fail(`node ${node.id} value must be an object`)
  const schema =
    GAMEPLAY_DOMAIN_MANIFEST[node.kind as keyof typeof GAMEPLAY_DOMAIN_MANIFEST]
      .valueJsonSchema
  const fields = projectionValueRequiredFields(schema)
  exactKeys(node.value, fields, `node ${node.id} value`)
  if (fields.length === 1 && fields[0] === 'label')
    return { label: label(node.value, node.id) }
  if (node.kind === 'gameplay.condition')
    return {
      expression: condition(node.value.expression, node.references.length),
    }
  if (node.kind === 'gameplay.effect')
    return { effect: effect(node.value.effect, node.references.length) }
  if (node.kind === 'gameplay.state') {
    const stateLabel = label(node.value, node.id)
    if (typeof node.value.initial !== 'boolean')
      fail(`node ${node.id} initial must be boolean`)
    if (
      typeof node.value.terminal !== 'string' ||
      !['none', 'success', 'failure'].includes(node.value.terminal)
    )
      fail(`node ${node.id} terminal value is invalid`)
    return {
      label: stateLabel,
      initial: node.value.initial,
      terminal: node.value.terminal,
    }
  }
  if (node.kind === 'gameplay.outcome') {
    const outcomeLabel = label(node.value, node.id)
    if (
      typeof node.value.result !== 'string' ||
      !OUTCOME_RESULTS.has(node.value.result)
    )
      fail(`node ${node.id} outcome result must be explicit`)
    return {
      label: outcomeLabel,
      result: node.value.result,
    }
  }
  fail(`node ${node.id} has an unknown kind`)
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
    value.forEach((entry, entryIndex) =>
      assertNoEmbeddedTargetIds(entry, targetIds, `${label}[${entryIndex}]`),
    )
    return
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value))
      assertNoEmbeddedTargetIds(entry, targetIds, `${label}.${key}`)
  }
}

type ParsedNode = GameIrNode & { value: Readonly<Record<string, unknown>> }
type KnownTarget = Pick<GameIrNode, 'id' | 'kind'>
type NodeValidationOptions = Readonly<{ allowUnknownTargets?: boolean }>

function targetMap(
  nodes: readonly GameIrNode[],
  externalTargets: ReadonlyMap<string, GameIrNode> | undefined,
): Map<string, GameIrNode> {
  const targets = new Map<string, GameIrNode>()
  for (const node of nodes) {
    if (targets.has(node.id)) fail(`duplicate node ID ${node.id}`)
    targets.set(node.id, node)
  }
  if (externalTargets) {
    for (const [id, node] of externalTargets) {
      if (id !== node.id)
        fail(`external target key does not match node ${node.id}`)
      if (!node.kind.startsWith('balance.'))
        fail(`external target ${id} is not a Balance node`)
      if (targets.has(id)) fail(`duplicate node ID ${id}`)
      targets.set(id, node)
    }
  }
  return targets
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
  for (const edge of node.edges) {
    const target = targets.get(edge.targetId)
    if (!target) {
      if (options.allowUnknownTargets) continue
      fail(`node ${node.id} edge targets unknown node ${edge.targetId}`)
    }
    if (target.kind !== edge.targetType)
      fail(`node ${node.id} edge target kind does not match ${edge.targetId}`)
  }
}

function validateRoles(
  node: GameIrNode,
  targets: ReadonlyMap<string, KnownTarget>,
  options: NodeValidationOptions = {},
): void {
  const manifest = GAMEPLAY_DOMAIN_MANIFEST[
    node.kind as keyof typeof GAMEPLAY_DOMAIN_MANIFEST
  ]?.relationships as
    | Readonly<Record<string, GameplayRelationshipRole>>
    | undefined
  const counts = new Map<string, number>()
  const seenEdges = new Set<string>()
  for (const edge of node.edges) {
    const roleRule = manifest?.[edge.type]
    if (!roleRule)
      fail(`node ${node.id} has unknown relationship role ${edge.type}`)
    if (!roleRule.targetKinds.includes(edge.targetType))
      fail(`node ${node.id} role ${edge.type} has wrong target kind`)
    const edgeKey = `${edge.type}\0${edge.targetId}\0${edge.targetType}`
    if (seenEdges.has(edgeKey))
      fail(`node ${node.id} has duplicate relationship role ${edge.type}`)
    seenEdges.add(edgeKey)
    const count = (counts.get(edge.type) ?? 0) + 1
    if (roleRule.singleton && count > 1)
      fail(
        `node ${node.id} has duplicate singleton relationship role ${edge.type}`,
      )
    counts.set(edge.type, count)
    const target = targets.get(edge.targetId)
    if ((!target && !options.allowUnknownTargets) || (target && target.kind !== edge.targetType))
      fail(`node ${node.id} role target is invalid`)
  }
  if (manifest) {
    for (const [roleName, roleRule] of Object.entries(manifest)) {
      if (roleRule.required && !counts.has(roleName))
        fail(
          `node ${node.id} is missing required relationship role ${roleName}`,
        )
    }
  }
  if (
    node.kind === 'gameplay.objective' &&
    !counts.has('succeeds-with') &&
    !counts.has('fails-with')
  )
    fail(`objective ${node.id} must reach an explicit outcome`)
}

function validateGraph(nodes: readonly ParsedNode[]): void {
  const states = new Map<string, ParsedNode>()
  const transitions: Array<{ node: ParsedNode; from: string; to: string }> = []
  const initial = new Set<string>()
  for (const node of nodes) {
    if (node.kind === 'gameplay.state') {
      states.set(node.id, node)
      if (node.value.initial === true) initial.add(node.id)
    }
  }
  if (states.size === 0) fail('gameplay module must declare at least one state')
  if (initial.size === 0) fail('gameplay module must declare an initial state')
  for (const node of nodes) {
    if (node.kind !== 'gameplay.transition') continue
    const from = node.edges.find(edge => edge.type === 'from')
    const to = node.edges.find(edge => edge.type === 'to')
    if (!from || !to) fail(`transition ${node.id} is missing an endpoint`)
    const fromState = states.get(from.targetId)
    const toState = states.get(to.targetId)
    if (!fromState || !toState)
      fail(`transition ${node.id} endpoint is not a state`)
    transitions.push({ node, from: from.targetId, to: to.targetId })
    if (fromState.value.terminal !== 'none')
      fail(
        `transition ${node.id} leaves terminal state ${fromState.id}`,
      )
  }
  const reachable = new Set(initial)
  const outgoing = new Map<string, string[]>()
  for (const transition of transitions) {
    const next = outgoing.get(transition.from) ?? []
    next.push(transition.to)
    outgoing.set(transition.from, next)
  }
  const queue = [...initial]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const next of outgoing.get(queue[cursor]!) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next)
        queue.push(next)
      }
    }
  }
  for (const state of states.values()) {
    if (!state.value.initial && !reachable.has(state.id))
      fail(`unreachable state ${state.id}`)
  }
  for (const node of nodes) {
    if (node.kind !== 'gameplay.objective') continue
    for (const relationship of node.edges) {
      if (
        relationship.type !== 'succeeds-with' &&
        relationship.type !== 'fails-with'
      )
        continue
      const outcome = nodes.find(
        candidate => candidate.id === relationship.targetId,
      )
      if (!outcome || outcome.kind !== 'gameplay.outcome')
        fail(`objective ${node.id} has an invalid outcome`)
      const expected = relationship.type === 'succeeds-with' ? 'win' : 'loss'
      if (outcome.value.result !== expected)
        fail(
          `objective ${node.id} ${relationship.type} must use an explicit ${expected} outcome`,
        )
    }
  }
}

/**
 * Parses one Gameplay node through the same local semantic rules used by the
 * complete module parser. Aggregate state reachability stays below.
 */
export function parseGameplayProjectionNode(
  node: GameIrNode,
  targets: ReadonlyMap<string, KnownTarget>,
  options: NodeValidationOptions = {},
): ParsedNode {
  if (!isRecord(node)) fail(`node must be an object`)
  if (typeof node.id !== 'string' || node.id.length === 0)
    fail(`node has an invalid ID`)
  if (typeof node.kind !== 'string' || !NODE_KINDS.has(node.kind))
    fail(`node ${node.id} has an unknown kind`)
  validateReferences(node, targets, options)
  const parsedValue = parseValue(node)
  assertNoEmbeddedTargetIds(
    parsedValue,
    new Set(targets.keys()),
    `node ${node.id} value`,
  )
  validateRoles(node, targets, options)
  return {
    ...node,
    value: parsedValue,
    references: node.references.map(reference => ({ ...reference })),
    edges: node.edges.map(edgeValue => ({ ...edgeValue })),
    bindings: cloneJson(node.bindings) as GameIrNode['bindings'],
  }
}

export function parseGameplayModule(
  module: GameIrModuleCandidate,
  externalTargets?: ReadonlyMap<string, GameIrNode>,
): GameIrModuleCandidate {
  if (!module || typeof module !== 'object' || module.moduleId !== 'gameplay')
    fail('module ID must be gameplay')
  if (!Array.isArray(module.nodes)) fail('module nodes must be an array')
  const localNodes = module.nodes
  const targets = targetMap(localNodes, externalTargets)
  const parsed: ParsedNode[] = []
  for (let nodeIndex = 0; nodeIndex < localNodes.length; nodeIndex += 1) {
    const node = localNodes[nodeIndex]!
    if (!isRecord(node)) fail(`node ${nodeIndex} must be an object`)
    parsed.push(parseGameplayProjectionNode(node as unknown as GameIrNode, targets))
  }
  for (let nodeIndex = 1; nodeIndex < parsed.length; nodeIndex += 1) {
    if (compareCodeUnits(parsed[nodeIndex - 1]!.id, parsed[nodeIndex]!.id) >= 0)
      fail('node IDs must be unique and sorted')
  }
  validateGraph(parsed)
  return deepFreeze({
    moduleId: 'gameplay',
    nodes: parsed,
  })
}
