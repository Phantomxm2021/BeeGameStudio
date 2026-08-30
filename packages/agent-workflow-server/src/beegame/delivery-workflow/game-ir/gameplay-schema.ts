import {
  compareCodeUnits,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'

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

/** Closed, service-owned relationship role and target-kind manifest. */
export const GAMEPLAY_RELATIONSHIP_ROLES = Object.freeze({
  'gameplay.capability': Object.freeze({
    'belongs-to': role(['gameplay.entity'], {
      required: true,
      singleton: true,
    }),
  }),
  'gameplay.action': Object.freeze({
    requires: role(['gameplay.condition'], { required: true }),
    causes: role(['gameplay.effect', 'gameplay.event'], { required: true }),
  }),
  'gameplay.rule': Object.freeze({
    'triggered-by': role(['gameplay.event'], {
      required: true,
      singleton: true,
    }),
    guards: role(['gameplay.condition'], { singleton: true }),
  }),
  'gameplay.transition': Object.freeze({
    from: role(['gameplay.state'], { required: true, singleton: true }),
    to: role(['gameplay.state'], { required: true, singleton: true }),
    on: role(['gameplay.event', 'gameplay.condition'], { singleton: true }),
  }),
  'gameplay.objective': Object.freeze({
    'succeeds-with': role(['gameplay.outcome'], { singleton: true }),
    'fails-with': role(['gameplay.outcome'], { singleton: true }),
  }),
} as const)

/** Alias kept explicit for consumers that only need singleton role rules. */
export const GAMEPLAY_SINGLETON_ROLES = Object.freeze({
  'gameplay.capability': Object.freeze({
    'belongs-to': Object.freeze(['gameplay.entity']),
  }),
  'gameplay.transition': Object.freeze({
    from: Object.freeze(['gameplay.state']),
    to: Object.freeze(['gameplay.state']),
    on: Object.freeze(['gameplay.event', 'gameplay.condition']),
  }),
  'gameplay.objective': Object.freeze({
    'succeeds-with': Object.freeze(['gameplay.outcome']),
    'fails-with': Object.freeze(['gameplay.outcome']),
  }),
} as const)

const VALUE_FIELDS = Object.freeze({
  'gameplay.entity': Object.freeze(['label']),
  'gameplay.capability': Object.freeze(['label']),
  'gameplay.action': Object.freeze(['label']),
  'gameplay.rule': Object.freeze(['label']),
  'gameplay.condition': Object.freeze(['expression']),
  'gameplay.effect': Object.freeze(['effect']),
  'gameplay.event': Object.freeze(['label']),
  'gameplay.state': Object.freeze(['label', 'initial', 'terminal']),
  'gameplay.transition': Object.freeze(['label']),
  'gameplay.objective': Object.freeze(['label']),
  'gameplay.outcome': Object.freeze(['label', 'result']),
} as const)

const NODE_KINDS = new Set(Object.keys(VALUE_FIELDS))
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
  const fields = VALUE_FIELDS[node.kind as keyof typeof VALUE_FIELDS]
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
  targets: ReadonlyMap<string, GameIrNode>,
): void {
  for (const reference of node.references) {
    const target = targets.get(reference.targetId)
    if (!target)
      fail(
        `node ${node.id} reference targets unknown node ${reference.targetId}`,
      )
    if (target.kind !== reference.targetType)
      fail(
        `node ${node.id} reference target kind does not match ${reference.targetId}`,
      )
  }
  for (const edge of node.edges) {
    const target = targets.get(edge.targetId)
    if (!target)
      fail(`node ${node.id} edge targets unknown node ${edge.targetId}`)
    if (target.kind !== edge.targetType)
      fail(`node ${node.id} edge target kind does not match ${edge.targetId}`)
  }
}

function validateRoles(
  node: GameIrNode,
  targets: ReadonlyMap<string, GameIrNode>,
): void {
  const manifest = GAMEPLAY_RELATIONSHIP_ROLES[
    node.kind as keyof typeof GAMEPLAY_RELATIONSHIP_ROLES
  ] as Readonly<Record<string, GameplayRelationshipRole>> | undefined
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
    if (!target || target.kind !== edge.targetType)
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
      fail(`terminal state ${fromState.id} has an outgoing transition`)
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
    const admittedNode = node as unknown as GameIrNode
    if (typeof admittedNode.id !== 'string' || admittedNode.id.length === 0)
      fail(`node ${nodeIndex} has an invalid ID`)
    if (
      typeof admittedNode.kind !== 'string' ||
      !NODE_KINDS.has(admittedNode.kind)
    )
      fail(`node ${admittedNode.id} has an unknown kind`)
    validateReferences(admittedNode, targets)
    const parsedValue = parseValue(admittedNode)
    assertNoEmbeddedTargetIds(
      parsedValue,
      new Set(targets.keys()),
      `node ${admittedNode.id} value`,
    )
    validateRoles(admittedNode, targets)
    parsed.push({
      ...admittedNode,
      value: parsedValue,
      references: admittedNode.references.map(reference => ({ ...reference })),
      edges: admittedNode.edges.map(edgeValue => ({ ...edgeValue })),
      bindings: cloneJson(admittedNode.bindings) as GameIrNode['bindings'],
    })
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
