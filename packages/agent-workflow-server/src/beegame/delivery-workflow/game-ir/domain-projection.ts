import {
  compareCodeUnits,
  digestGameIrValue,
  parseGameIrModuleCandidate,
  type GameIrNode,
} from './model'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainId,
  type GameIrDomainSourceEnvelope,
} from './domain-source'

export type { GameIrDomainId } from './domain-source'

export type GameIrMechanicalProjectionReceipt = Readonly<{
  schemaVersion: 'game-ir-mechanical-projection-receipt.v1'
  taskId: string
  moduleId: GameIrDomainId
  foundationRevision: string
  sourceDigest: string
  nodes: readonly GameIrNode[]
  verifiedClaims: readonly Readonly<{
    subject: string
    sourcePointer: string
    literal: string
  }>[]
  ownedTargets: readonly string[]
  receiptDigest: string
}>

export type GameIrDomainSemanticPacket = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-packet.v1'
  taskId: string
  moduleId: GameIrDomainId
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  allowedNodeKinds: readonly string[]
  allowedRelationshipTypes: readonly string[]
  forbiddenTargets: readonly string[]
  packetDigest: string
}>

type MechanicalReceiptInput = Readonly<{
  source: GameIrDomainSourceEnvelope
  receipt: unknown
}>

type SemanticPacketInput = Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  allowedNodeKinds?: readonly string[]
  allowedRelationshipTypes?: readonly string[]
}>

function fail(message: string): never {
  throw new Error(`invalid Game IR domain projection: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Reflect.ownKeys(value)
  for (const key of keys) {
    if (typeof key !== 'string') fail(`${label} has a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${label} has a hidden or accessor property`)
  }
  const actual = (keys as string[]).sort(compareCodeUnits)
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

function digest(value: unknown, label: string): string {
  const result = text(value, label)
  if (!/^[a-f0-9]{64}$/.test(result))
    fail(`${label} must be a SHA-256 digest`)
  return result
}

function strictArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    lengthDescriptor.value !== value.length ||
    lengthDescriptor.enumerable ||
    lengthDescriptor.configurable
  )
    fail(`${label} has an invalid length property`)
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== value.length + 1)
    fail(`${label} must be a dense array without custom properties`)
  for (const key of ownKeys) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^\d+$/.test(key))
      fail(`${label} has a hidden or symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${label} has a hidden or accessor property`)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, String(index))) fail(`${label} must be dense`)
  }
  return value
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function normalizeNodes(
  value: unknown,
  source: GameIrDomainSourceEnvelope,
): readonly GameIrNode[] {
  const raw = strictArray(value, 'nodes')
  const parsed = parseGameIrModuleCandidate(
    { moduleId: source.moduleId, nodes: raw },
    {
      request: source.compileRequest,
      sections: source.authoritySectionIndex,
      expectedModuleId: source.moduleId,
    },
  )
  if (parsed.nodes.some(node => node.producerMode !== 'mechanical'))
    fail('nodes must be mechanically produced')
  return Object.freeze(parsed.nodes.map(node => deepFreeze(node)))
}

type VerifiedClaim = Readonly<{
  subject: string
  sourcePointer: string
  literal: string
}>

function normalizeClaims(value: unknown): readonly VerifiedClaim[] {
  const raw = strictArray(value, 'verifiedClaims')
  const claims = raw.map((entry, index) => {
    if (!isRecord(entry)) fail(`verifiedClaims[${index}] must be a plain object`)
    exactKeys(entry, ['subject', 'sourcePointer', 'literal'], `verifiedClaims[${index}]`)
    return {
      subject: text(entry.subject, `verifiedClaims[${index}].subject`),
      sourcePointer: text(entry.sourcePointer, `verifiedClaims[${index}].sourcePointer`),
      literal: text(entry.literal, `verifiedClaims[${index}].literal`),
    }
  })
  for (let index = 1; index < claims.length; index += 1) {
    const previous = `${claims[index - 1]!.subject}\0${claims[index - 1]!.sourcePointer}\0${claims[index - 1]!.literal}`
    const current = `${claims[index]!.subject}\0${claims[index]!.sourcePointer}\0${claims[index]!.literal}`
    if (compareCodeUnits(previous, current) >= 0)
      fail('verifiedClaims must be unique and sorted')
  }
  return Object.freeze(claims.map(claim => Object.freeze(claim)))
}

function normalizeTargets(value: unknown, label: string): readonly string[] {
  const raw = strictArray(value, label)
  const targets = raw.map((target, index) => text(target, `${label}[${index}]`))
  for (let index = 1; index < targets.length; index += 1) {
    if (compareCodeUnits(targets[index - 1]!, targets[index]!) >= 0)
      fail(`${label} must be unique and sorted`)
  }
  return Object.freeze([...targets])
}

function mechanicalNodeTargets(
  nodes: readonly GameIrNode[],
): readonly string[] {
  return Object.freeze(
    nodes
      .flatMap(node =>
        Object.keys(node.bindings).map(pointer => `node:${node.id}#${pointer}`),
      )
      .sort(compareCodeUnits),
  )
}

function normalizeAllowed(value: readonly string[] | undefined, label: string): readonly string[] {
  const raw = value === undefined ? [] : strictArray(value, label)
  const output = raw.map((entry, index) => text(entry, `${label}[${index}]`))
  const unique = [...new Set(output)].sort(compareCodeUnits)
  if (unique.length !== output.length)
    fail(`${label} must not contain duplicates`)
  return Object.freeze(unique)
}

function receiptBody(
  receipt: Omit<GameIrMechanicalProjectionReceipt, 'receiptDigest'>,
): Omit<GameIrMechanicalProjectionReceipt, 'receiptDigest'> {
  return receipt
}

export function admitGameIrMechanicalProjectionReceipt(
  sourceOrInput: GameIrDomainSourceEnvelope | MechanicalReceiptInput,
  value?: unknown,
): GameIrMechanicalProjectionReceipt {
  const source =
    'source' in sourceOrInput
      ? sourceOrInput.source
      : sourceOrInput
  const raw =
    'source' in sourceOrInput ? sourceOrInput.receipt : value
  if (raw === undefined) fail('mechanical receipt is required')
  const validatedSource = validateGameIrDomainSourceEnvelope(source)
  if (!isRecord(raw)) fail('mechanical receipt must be a plain object')
  exactKeys(
    raw,
    [
      'schemaVersion',
      'taskId',
      'moduleId',
      'foundationRevision',
      'sourceDigest',
      'nodes',
      'verifiedClaims',
      'ownedTargets',
      'receiptDigest',
    ],
    'mechanical receipt',
  )
  if (raw.schemaVersion !== 'game-ir-mechanical-projection-receipt.v1')
    fail('mechanical receipt schemaVersion is invalid')
  const taskId = text(raw.taskId, 'mechanical receipt taskId')
  const rawModuleId = raw.moduleId
  if (rawModuleId !== validatedSource.moduleId)
    fail('mechanical receipt moduleId does not match source')
  const moduleId = rawModuleId as GameIrDomainId
  if (taskId !== validatedSource.taskId)
    fail('mechanical receipt taskId does not match source')
  const foundationRevision = text(
    raw.foundationRevision,
    'mechanical receipt foundationRevision',
  )
  if (foundationRevision !== validatedSource.compileRequest.foundation.foundationRevision)
    fail('mechanical receipt foundationRevision does not match source')
  const sourceDigest = digest(raw.sourceDigest, 'mechanical receipt sourceDigest')
  if (sourceDigest !== validatedSource.sourceDigest)
    fail('mechanical receipt sourceDigest does not match source')
  const nodes = normalizeNodes(raw.nodes, validatedSource)
  const verifiedClaims = normalizeClaims(raw.verifiedClaims)
  const ownedTargets = normalizeTargets(raw.ownedTargets, 'ownedTargets')
  const expectedTargets = mechanicalNodeTargets(nodes)
  if (
    ownedTargets.length !== expectedTargets.length ||
    ownedTargets.some((target, index) => target !== expectedTargets[index])
  )
    fail('ownedTargets must exactly account for every mechanical node target')
  const body: Omit<GameIrMechanicalProjectionReceipt, 'receiptDigest'> = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1',
    taskId,
    moduleId,
    foundationRevision,
    sourceDigest,
    nodes,
    verifiedClaims,
    ownedTargets,
  }
  const receiptDigest = digest(raw.receiptDigest, 'mechanical receipt receiptDigest')
  if (receiptDigest !== digestGameIrValue(receiptBody(body)))
    fail('mechanical receipt digest is stale or invalid')
  return deepFreeze({ ...body, receiptDigest })
}

export function assertDisjointDomainTargets(
  mechanicalTargets: readonly string[],
  semanticTargets: readonly string[],
): void {
  const mechanical = normalizeTargets(mechanicalTargets, 'mechanicalTargets')
  const semantic = normalizeTargets(semanticTargets, 'semanticTargets')
  const owned = new Set(mechanical)
  if (semantic.some(target => owned.has(target)))
    fail('mechanical and semantic domain targets overlap')
}

export function buildGameIrDomainSemanticPacket(
  input: SemanticPacketInput,
): GameIrDomainSemanticPacket
export function buildGameIrDomainSemanticPacket(
  source: GameIrDomainSourceEnvelope,
  mechanical: GameIrMechanicalProjectionReceipt,
): GameIrDomainSemanticPacket
export function buildGameIrDomainSemanticPacket(
  inputOrSource: SemanticPacketInput | GameIrDomainSourceEnvelope,
  mechanicalArgument?: GameIrMechanicalProjectionReceipt,
): GameIrDomainSemanticPacket {
  const input: SemanticPacketInput =
    mechanicalArgument === undefined
      ? (inputOrSource as SemanticPacketInput)
      : {
          source: inputOrSource as GameIrDomainSourceEnvelope,
          mechanical: mechanicalArgument,
        }
  if (!isRecord(input)) fail('semantic packet input must be a plain object')
  const inputKeys = Reflect.ownKeys(input)
  for (const key of inputKeys) {
    if (typeof key !== 'string') fail('semantic packet input has a symbol property')
  }
  const allowedKeys = new Set([
    'source',
    'mechanical',
    'allowedNodeKinds',
    'allowedRelationshipTypes',
  ])
  if (inputKeys.some(key => typeof key === 'string' && !allowedKeys.has(key)))
    fail('semantic packet input has unknown fields')
  const source = validateGameIrDomainSourceEnvelope(input.source)
  const mechanical = admitGameIrMechanicalProjectionReceipt(
    source,
    input.mechanical,
  )
  const body: Omit<GameIrDomainSemanticPacket, 'packetDigest'> = {
    schemaVersion: 'game-ir-domain-semantic-packet.v1',
    taskId: source.taskId,
    moduleId: source.moduleId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    mechanicalReceiptDigest: mechanical.receiptDigest,
    allowedNodeKinds: normalizeAllowed(input.allowedNodeKinds, 'allowedNodeKinds'),
    allowedRelationshipTypes: normalizeAllowed(
      input.allowedRelationshipTypes,
      'allowedRelationshipTypes',
    ),
    forbiddenTargets: mechanical.ownedTargets,
  }
  return deepFreeze({ ...body, packetDigest: digestGameIrValue(body) })
}
