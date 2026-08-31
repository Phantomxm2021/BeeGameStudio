import {
  compareCodeUnits,
  digestGameIrValue,
  parseGameIrTargetPointer,
  type GameIrNode,
} from './model'
import {
  GAME_IR_SEMANTIC_AMBIGUOUS_REASON_CODES,
  GAME_IR_SEMANTIC_FAILURE_REASON_CODES,
  type GameIrSemanticAmbiguousReasonCode,
  type GameIrSemanticFailureReasonCode,
} from './semantic-admission'
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

export type GameIrDomainSemanticDiagnostic = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-diagnostic.v1'
  outcome: 'FAIL' | 'AMBIGUOUS'
  taskId: string
  moduleId: GameIrDomainId
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  packetDigest: string
  reasonCode:
    | Extract<GameIrSemanticFailureReasonCode, 'missing-projection'>
    | GameIrSemanticAmbiguousReasonCode
  actual: string
  missingSubject: string
  expectedProjection: string
  evidencePointers: readonly string[]
  diagnosticDigest: string
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
  if (!/^[a-f0-9]{64}$/.test(result)) fail(`${label} must be a SHA-256 digest`)
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

type VerifiedClaim = Readonly<{
  subject: string
  sourcePointer: string
  literal: string
}>

function normalizeTargets(value: unknown, label: string): readonly string[] {
  const raw = strictArray(value, label)
  const targets = raw.map((target, index) => text(target, `${label}[${index}]`))
  for (let index = 1; index < targets.length; index += 1) {
    if (compareCodeUnits(targets[index - 1]!, targets[index]!) >= 0)
      fail(`${label} must be unique and sorted`)
  }
  return Object.freeze([...targets])
}

function canonicalDiagnosticSubject(value: unknown): string {
  const subject = text(value, 'semantic diagnostic missingSubject')
  const separator = subject.indexOf('#')
  if (!subject.startsWith('node:') || separator <= 'node:'.length)
    fail('semantic diagnostic missingSubject must be node-qualified')
  const nodeId = subject.slice('node:'.length, separator)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nodeId))
    fail('semantic diagnostic missingSubject has an invalid node ID')
  const pointerText = subject.slice(separator + 1)
  let pointer: string
  try {
    pointer = parseGameIrTargetPointer(pointerText)
  } catch {
    fail('semantic diagnostic missingSubject has an invalid target pointer')
  }
  if (pointer !== pointerText)
    fail('semantic diagnostic missingSubject is not canonical')
  return `node:${nodeId}#${pointer}`
}

export function admitGameIrDomainSemanticDiagnostic(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): GameIrDomainSemanticDiagnostic {
  if (!isRecord(value)) fail('semantic diagnostic must be a plain object')
  exactKeys(
    value,
    [
      'outcome',
      'reasonCode',
      'actual',
      'missingSubject',
      'expectedProjection',
      'evidencePointers',
    ],
    'semantic diagnostic',
  )
  const outcome = value.outcome
  const reasonCode = value.reasonCode
  let admittedReasonCode: GameIrDomainSemanticDiagnostic['reasonCode']
  if (outcome === 'FAIL') {
    if (reasonCode !== GAME_IR_SEMANTIC_FAILURE_REASON_CODES[1])
      fail('semantic diagnostic outcome and reasonCode do not match')
    admittedReasonCode = reasonCode
  } else if (outcome === 'AMBIGUOUS') {
    if (reasonCode !== GAME_IR_SEMANTIC_AMBIGUOUS_REASON_CODES[0])
      fail('semantic diagnostic outcome and reasonCode do not match')
    admittedReasonCode = reasonCode
  } else {
    fail('semantic diagnostic outcome and reasonCode do not match')
  }
  const evidencePointers = normalizeTargets(
    value.evidencePointers,
    'semantic diagnostic evidencePointers',
  )
  if (evidencePointers.length === 0)
    fail('semantic diagnostic evidencePointers must not be empty')
  const body: Omit<GameIrDomainSemanticDiagnostic, 'diagnosticDigest'> = {
    schemaVersion: 'game-ir-domain-semantic-diagnostic.v1',
    outcome,
    taskId: packet.taskId,
    moduleId: packet.moduleId,
    foundationRevision: packet.foundationRevision,
    sourceDigest: packet.sourceDigest,
    mechanicalReceiptDigest: packet.mechanicalReceiptDigest,
    packetDigest: packet.packetDigest,
    reasonCode: admittedReasonCode,
    actual: text(value.actual, 'semantic diagnostic actual'),
    missingSubject: canonicalDiagnosticSubject(value.missingSubject),
    expectedProjection: text(
      value.expectedProjection,
      'semantic diagnostic expectedProjection',
    ),
    evidencePointers,
  }
  return deepFreeze({
    ...body,
    diagnosticDigest: digestGameIrValue(body),
  })
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

function normalizeAllowed(
  value: readonly string[] | undefined,
  label: string,
): readonly string[] {
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
  input: MechanicalReceiptInput,
): GameIrMechanicalProjectionReceipt {
  if (!isRecord(input)) fail('mechanical receipt input must be a plain object')
  exactKeys(input, ['source', 'receipt'], 'mechanical receipt input')
  const validatedSource = validateGameIrDomainSourceEnvelope(input.source)
  const raw = input.receipt
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
  if (
    foundationRevision !==
    validatedSource.compileRequest.foundation.foundationRevision
  )
    fail('mechanical receipt foundationRevision does not match source')
  const sourceDigest = digest(
    raw.sourceDigest,
    'mechanical receipt sourceDigest',
  )
  if (sourceDigest !== validatedSource.sourceDigest)
    fail('mechanical receipt sourceDigest does not match source')
  const rawNodes = strictArray(raw.nodes, 'nodes')
  const rawClaims = strictArray(raw.verifiedClaims, 'verifiedClaims')
  if (rawNodes.length !== 0 || rawClaims.length !== 0)
    fail(
      'Gameplay and Balance mechanical nodes and verifiedClaims must be empty in Phase 4',
    )
  const nodes = Object.freeze([]) as readonly GameIrNode[]
  const verifiedClaims = Object.freeze([]) as readonly VerifiedClaim[]
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
  const receiptDigest = digest(
    raw.receiptDigest,
    'mechanical receipt receiptDigest',
  )
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
): GameIrDomainSemanticPacket {
  if (!isRecord(input)) fail('semantic packet input must be a plain object')
  exactKeys(
    input,
    [
      'source',
      'mechanical',
      ...(Object.hasOwn(input, 'allowedNodeKinds') ? ['allowedNodeKinds'] : []),
      ...(Object.hasOwn(input, 'allowedRelationshipTypes')
        ? ['allowedRelationshipTypes']
        : []),
    ],
    'semantic packet input',
  )
  const source = validateGameIrDomainSourceEnvelope(input.source)
  const mechanical = admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: input.mechanical,
  })
  const body: Omit<GameIrDomainSemanticPacket, 'packetDigest'> = {
    schemaVersion: 'game-ir-domain-semantic-packet.v1',
    taskId: source.taskId,
    moduleId: source.moduleId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    mechanicalReceiptDigest: mechanical.receiptDigest,
    allowedNodeKinds: normalizeAllowed(
      input.allowedNodeKinds,
      'allowedNodeKinds',
    ),
    allowedRelationshipTypes: normalizeAllowed(
      input.allowedRelationshipTypes,
      'allowedRelationshipTypes',
    ),
    forbiddenTargets: mechanical.ownedTargets,
  }
  return deepFreeze({ ...body, packetDigest: digestGameIrValue(body) })
}
