import {
  compareCodeUnits,
  canonicalGameIrJson,
  digestGameIrValue,
  parseGameIrTargetPointer,
  type GameIrReference,
  type GameIrRelationshipEdge,
  type GameIrNode,
} from './model'
import {
  isGameIrDomainId,
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainId,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import { GAME_IR_DOMAIN_IDS } from './domain-source'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import {
  createSemanticFidelityPrimitives,
  GAME_IR_SEMANTIC_AMBIGUOUS_REASON_CODES,
  GAME_IR_SEMANTIC_FAILURE_REASON_CODES,
  sectionEvidencePointer,
  type GameIrSemanticCandidateNode,
  type GameIrSemanticAmbiguousReasonCode,
  type GameIrSemanticFailureReasonCode,
  type GameIrSemanticSourceClaim,
} from './semantic-fidelity'

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
  allowedEvidencePointers: readonly string[]
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

export type GameIrDomainSemanticDiagnosticValue = Readonly<{
  outcome: 'FAIL' | 'AMBIGUOUS'
  reasonCode: GameIrDomainSemanticDiagnostic['reasonCode']
  actual: string
  missingSubject: string
  expectedProjection: string
  evidencePointers: readonly string[]
}>

export type GameIrDomainSemanticReceipt = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-receipt.v1'
  outcome: 'PROJECTED'
  taskId: string
  moduleId: GameIrDomainId
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  packetDigest: string
  nodes: readonly (GameIrSemanticCandidateNode &
    Readonly<{ producerMode: 'semantic' }>)[]
  sourceClaims: readonly GameIrSemanticSourceClaim[]
  receiptDigest: string
}>

export type GameIrDomainSemanticResult =
  | GameIrDomainSemanticReceipt
  | GameIrDomainSemanticDiagnostic

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

export function parseGameIrDomainSemanticDiagnosticValue(
  value: unknown,
  allowedEvidencePointers: readonly string[],
): GameIrDomainSemanticDiagnosticValue {
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
  const allowed = new Set(
    normalizeTargets(
      allowedEvidencePointers,
      'semantic diagnostic allowedEvidencePointers',
    ),
  )
  for (const evidencePointer of evidencePointers) {
    if (!allowed.has(evidencePointer))
      fail(
        'semantic diagnostic evidence pointer is outside the exact source closure',
      )
  }
  return deepFreeze({
    outcome,
    reasonCode: admittedReasonCode,
    actual: text(value.actual, 'semantic diagnostic actual'),
    missingSubject: canonicalDiagnosticSubject(value.missingSubject),
    expectedProjection: text(
      value.expectedProjection,
      'semantic diagnostic expectedProjection',
    ),
    evidencePointers,
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
  if (!isGameIrDomainId(rawModuleId))
    fail('mechanical receipt moduleId is invalid')
  if (rawModuleId !== validatedSource.moduleId)
    fail('mechanical receipt moduleId does not match source')
  const moduleId = rawModuleId
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
    fail('isolated domain mechanical nodes and verifiedClaims must be empty')
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
    allowedEvidencePointers: Object.freeze(
      source.sectionIndex.map(sectionEvidencePointer).sort(compareCodeUnits),
    ),
    forbiddenTargets: mechanical.ownedTargets,
  }
  return deepFreeze({ ...body, packetDigest: digestGameIrValue(body) })
}

type SemanticResultAdmissionOptions = Readonly<{
  errorPrefix?: string
  allowedModuleIds?: readonly GameIrDomainId[]
  receiptAuthorityDigest: string
}>

const FOUNDATION_DOCUMENT_SET = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)

function semanticResultAdmissionFail(
  errorPrefix: string,
  message: string,
): never {
  throw new Error(`${errorPrefix}: ${message}`)
}

export function gameIrSemanticValueLeafPointers(
  value: Readonly<Record<string, unknown>>,
): readonly string[] {
  const output: string[] = []
  const encode = (segment: string): string =>
    segment.replaceAll('~', '~0').replaceAll('/', '~1')
  const visit = (entry: unknown, pointer: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) output.push(pointer)
      else entry.forEach((child, index) => visit(child, `${pointer}/${index}`))
      return
    }
    if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry as Record<string, unknown>)
      if (entries.length === 0) output.push(pointer)
      else
        entries.forEach(([key, child]) =>
          visit(child, `${pointer}/${encode(key)}`),
        )
      return
    }
    output.push(pointer)
  }
  const entries = Object.entries(value)
  if (entries.length === 0) output.push('/value')
  else entries.forEach(([key, child]) => visit(child, `/value/${encode(key)}`))
  return output
}

export function gameIrSemanticPointerValue(
  node: GameIrSemanticCandidateNode,
  pointer: string,
): unknown {
  if (pointer === '/id') return node.id
  if (pointer === '/value') return node.value
  if (pointer.startsWith('/references/')) {
    const reference =
      node.references[Number(pointer.slice('/references/'.length))]
    return (
      reference && {
        targetId: reference.targetId,
        targetType: reference.targetType,
      }
    )
  }
  if (pointer.startsWith('/edges/')) {
    const edge = node.edges[Number(pointer.slice('/edges/'.length))]
    return (
      edge && {
        type: edge.type,
        targetId: edge.targetId,
        targetType: edge.targetType,
      }
    )
  }
  const segments = pointer
    .slice('/value/'.length)
    .split('/')
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  let current: unknown = node.value
  for (const segment of segments) {
    if (Array.isArray(current)) current = current[Number(segment)]
    else if (isRecord(current)) current = current[segment]
    else return undefined
  }
  return current
}

export function gameIrSemanticTargetPointers(
  nodes: readonly GameIrSemanticCandidateNode[],
): readonly string[] {
  return Object.freeze(
    nodes
      .flatMap(node => [
        `node:${node.id}#/id`,
        ...gameIrSemanticValueLeafPointers(node.value).map(
          pointer => `node:${node.id}#${pointer}`,
        ),
        ...node.references.map(
          (_, index) => `node:${node.id}#/references/${index}`,
        ),
        ...node.edges.map((_, index) => `node:${node.id}#/edges/${index}`),
      ])
      .sort(compareCodeUnits),
  )
}

function semanticResultNormalizeNode(
  value: unknown,
  index: number,
  packet: GameIrDomainSemanticPacket,
  primitives: ReturnType<typeof createSemanticFidelityPrimitives>,
  errorPrefix: string,
): GameIrSemanticCandidateNode {
  const { exactKeys, strictArray, text, safeId, deepFreeze } = primitives
  if (!isRecord(value))
    semanticResultAdmissionFail(
      errorPrefix,
      `nodes[${index}] must be an object`,
    )
  exactKeys(
    value,
    ['id', 'kind', 'value', 'references', 'edges'],
    `nodes[${index}]`,
  )
  const id = safeId(value.id, `nodes[${index}].id`)
  const kind = text(value.kind, `nodes[${index}].kind`)
  if (!packet.allowedNodeKinds.includes(kind))
    semanticResultAdmissionFail(
      errorPrefix,
      `nodes[${index}] has a node kind outside the semantic packet`,
    )
  if (!isRecord(value.value))
    semanticResultAdmissionFail(
      errorPrefix,
      `nodes[${index}].value must be an object`,
    )
  let clonedValue: Record<string, unknown>
  try {
    clonedValue = JSON.parse(canonicalGameIrJson(value.value)) as Record<
      string,
      unknown
    >
  } catch {
    semanticResultAdmissionFail(
      errorPrefix,
      `nodes[${index}].value contains invalid JSON`,
    )
  }
  const references = strictArray(
    value.references,
    `nodes[${index}].references`,
  ).map((entry, referenceIndex) => {
    if (!isRecord(entry))
      semanticResultAdmissionFail(
        errorPrefix,
        `nodes[${index}].references[${referenceIndex}] must be an object`,
      )
    exactKeys(
      entry,
      ['targetId', 'targetType'],
      `nodes[${index}].references[${referenceIndex}]`,
    )
    return Object.freeze({
      targetId: safeId(
        entry.targetId,
        `nodes[${index}].references[${referenceIndex}].targetId`,
      ),
      targetType: text(
        entry.targetType,
        `nodes[${index}].references[${referenceIndex}].targetType`,
      ),
    })
  }) as GameIrReference[]
  for (
    let referenceIndex = 1;
    referenceIndex < references.length;
    referenceIndex += 1
  ) {
    const left = `${references[referenceIndex - 1]!.targetId}\0${references[referenceIndex - 1]!.targetType}`
    const right = `${references[referenceIndex]!.targetId}\0${references[referenceIndex]!.targetType}`
    if (compareCodeUnits(left, right) >= 0)
      semanticResultAdmissionFail(
        errorPrefix,
        `nodes[${index}].references must be unique and sorted`,
      )
  }
  const edges = strictArray(value.edges, `nodes[${index}].edges`).map(
    (entry, edgeIndex) => {
      if (!isRecord(entry))
        semanticResultAdmissionFail(
          errorPrefix,
          `nodes[${index}].edges[${edgeIndex}] must be an object`,
        )
      exactKeys(
        entry,
        ['type', 'targetId', 'targetType'],
        `nodes[${index}].edges[${edgeIndex}]`,
      )
      return Object.freeze({
        type: text(entry.type, `nodes[${index}].edges[${edgeIndex}].type`),
        targetId: safeId(
          entry.targetId,
          `nodes[${index}].edges[${edgeIndex}].targetId`,
        ),
        targetType: text(
          entry.targetType,
          `nodes[${index}].edges[${edgeIndex}].targetType`,
        ),
      })
    },
  ) as GameIrRelationshipEdge[]
  if (edges.some(edge => !packet.allowedRelationshipTypes.includes(edge.type)))
    semanticResultAdmissionFail(
      errorPrefix,
      `nodes[${index}] has a relationship type outside the semantic packet`,
    )
  for (let edgeIndex = 1; edgeIndex < edges.length; edgeIndex += 1) {
    const left = `${edges[edgeIndex - 1]!.type}\0${edges[edgeIndex - 1]!.targetId}\0${edges[edgeIndex - 1]!.targetType}`
    const right = `${edges[edgeIndex]!.type}\0${edges[edgeIndex]!.targetId}\0${edges[edgeIndex]!.targetType}`
    if (compareCodeUnits(left, right) >= 0)
      semanticResultAdmissionFail(
        errorPrefix,
        `nodes[${index}].edges must be unique and sorted`,
      )
  }
  return {
    id,
    kind,
    value: deepFreeze(clonedValue),
    references: Object.freeze(references),
    edges: Object.freeze(edges),
  }
}

/**
 * Shared strict admission for semantic worker receipts. Callers own only
 * module-specific packet construction and post-admission manifest rules.
 */
export function normalizeGameIrDomainSemanticPacket(
  packetInput: unknown,
  options: Pick<
    SemanticResultAdmissionOptions,
    'errorPrefix' | 'allowedModuleIds'
  > = {},
): GameIrDomainSemanticPacket {
  const errorPrefix = options.errorPrefix ?? 'invalid Game IR domain projection'
  const primitives = createSemanticFidelityPrimitives(errorPrefix)
  const { exactKeys, strictArray, text, sha256, deepFreeze } = primitives
  if (!isRecord(packetInput))
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic packet must be a plain object',
    )
  exactKeys(
    packetInput,
    [
      'schemaVersion',
      'taskId',
      'moduleId',
      'foundationRevision',
      'sourceDigest',
      'mechanicalReceiptDigest',
      'allowedNodeKinds',
      'allowedRelationshipTypes',
      'allowedEvidencePointers',
      'forbiddenTargets',
      'packetDigest',
    ],
    'semantic packet',
  )
  if (packetInput.schemaVersion !== 'game-ir-domain-semantic-packet.v1')
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic packet schemaVersion is invalid',
    )
  if (!isGameIrDomainId(packetInput.moduleId))
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic packet moduleId is invalid',
    )
  const allowedModules = options.allowedModuleIds ?? GAME_IR_DOMAIN_IDS
  if (!allowedModules.includes(packetInput.moduleId))
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic packet moduleId is outside the admission boundary',
    )
  const normalizeStrings = (raw: unknown, label: string): readonly string[] => {
    const entries = strictArray(raw, label).map((entry, index) =>
      text(entry, `${label}[${index}]`),
    )
    for (let index = 1; index < entries.length; index += 1)
      if (compareCodeUnits(entries[index - 1]!, entries[index]!) >= 0)
        semanticResultAdmissionFail(
          errorPrefix,
          `${label} must be unique and sorted`,
        )
    return Object.freeze(entries)
  }
  const body = {
    schemaVersion: 'game-ir-domain-semantic-packet.v1' as const,
    taskId: text(packetInput.taskId, 'semantic packet taskId'),
    moduleId: packetInput.moduleId,
    foundationRevision: text(
      packetInput.foundationRevision,
      'semantic packet foundationRevision',
    ),
    sourceDigest: sha256(
      packetInput.sourceDigest,
      'semantic packet sourceDigest',
    ),
    mechanicalReceiptDigest: sha256(
      packetInput.mechanicalReceiptDigest,
      'semantic packet mechanicalReceiptDigest',
    ),
    allowedNodeKinds: normalizeStrings(
      packetInput.allowedNodeKinds,
      'semantic packet allowedNodeKinds',
    ),
    allowedRelationshipTypes: normalizeStrings(
      packetInput.allowedRelationshipTypes,
      'semantic packet allowedRelationshipTypes',
    ),
    allowedEvidencePointers: normalizeStrings(
      packetInput.allowedEvidencePointers,
      'semantic packet allowedEvidencePointers',
    ),
    forbiddenTargets: normalizeStrings(
      packetInput.forbiddenTargets,
      'semantic packet forbiddenTargets',
    ),
  } as const
  const packetDigest = sha256(
    packetInput.packetDigest,
    'semantic packet packetDigest',
  )
  if (packetDigest !== digestGameIrValue(body))
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic packet digest is stale or invalid',
    )
  return deepFreeze({ ...body, packetDigest })
}

export function admitGameIrDomainSemanticResult(
  packetInput: GameIrDomainSemanticPacket,
  value: unknown,
  options: SemanticResultAdmissionOptions,
): GameIrDomainSemanticResult {
  const errorPrefix = options.errorPrefix ?? 'invalid Game IR domain projection'
  const primitives = createSemanticFidelityPrimitives(errorPrefix)
  const { exactKeys, strictArray, text, safeId, deepFreeze, sha256 } =
    primitives
  const receiptAuthorityDigest = sha256(
    options.receiptAuthorityDigest,
    'semantic result receiptAuthorityDigest',
  )
  const packet = normalizeGameIrDomainSemanticPacket(packetInput, {
    errorPrefix,
    allowedModuleIds: options.allowedModuleIds,
  })
  if (!isRecord(value))
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic result must be a plain object',
    )
  if (value.outcome === 'FAIL' || value.outcome === 'AMBIGUOUS') {
    const diagnostic = parseGameIrDomainSemanticDiagnosticValue(
      value,
      packet.allowedEvidencePointers,
    )
    const diagnosticBody = {
      schemaVersion: 'game-ir-domain-semantic-diagnostic.v1' as const,
      taskId: packet.taskId,
      moduleId: packet.moduleId,
      foundationRevision: packet.foundationRevision,
      sourceDigest: packet.sourceDigest,
      mechanicalReceiptDigest: packet.mechanicalReceiptDigest,
      packetDigest: receiptAuthorityDigest,
      ...diagnostic,
    }
    return deepFreeze({
      ...diagnosticBody,
      diagnosticDigest: digestGameIrValue(diagnosticBody),
    })
  }
  exactKeys(value, ['outcome', 'nodes', 'sourceClaims'], 'semantic result')
  if (value.outcome !== 'PROJECTED')
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic result outcome must be PROJECTED, FAIL, or AMBIGUOUS',
    )
  const nodes = Object.freeze(
    strictArray(value.nodes, 'nodes')
      .map((node, index) =>
        semanticResultNormalizeNode(
          node,
          index,
          packet,
          primitives,
          errorPrefix,
        ),
      )
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
  )
  for (let index = 1; index < nodes.length; index += 1)
    if (nodes[index - 1]!.id === nodes[index]!.id)
      semanticResultAdmissionFail(
        errorPrefix,
        `semantic result has duplicate node ID ${nodes[index]!.id}`,
      )
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const rawClaims = strictArray(value.sourceClaims, 'sourceClaims')
  const claims = rawClaims.map((entry, index) => {
    if (!isRecord(entry))
      semanticResultAdmissionFail(
        errorPrefix,
        `sourceClaims[${index}] must be an object`,
      )
    exactKeys(
      entry,
      ['subject', 'documentPath', 'sectionId', 'sourcePointer', 'literal'],
      `sourceClaims[${index}]`,
    )
    const subject = text(entry.subject, `sourceClaims[${index}].subject`)
    const separator = subject.indexOf('#')
    if (!subject.startsWith('node:') || separator <= 'node:'.length)
      semanticResultAdmissionFail(
        errorPrefix,
        `sourceClaims[${index}].subject must be node-qualified`,
      )
    const nodeId = safeId(
      subject.slice('node:'.length, separator),
      `sourceClaims[${index}].subject node ID`,
    )
    const node = nodeMap.get(nodeId)
    if (!node)
      semanticResultAdmissionFail(
        errorPrefix,
        `sourceClaims[${index}] refers to an unknown node`,
      )
    const pointerText = subject.slice(separator + 1)
    let pointer: string
    try {
      pointer = parseGameIrTargetPointer(pointerText)
    } catch {
      semanticResultAdmissionFail(
        errorPrefix,
        `sourceClaims[${index}].subject has an invalid target pointer`,
      )
    }
    if (pointer !== pointerText)
      semanticResultAdmissionFail(
        errorPrefix,
        `sourceClaims[${index}].subject is not canonical`,
      )
    const documentPath = text(
      entry.documentPath,
      `sourceClaims[${index}].documentPath`,
    )
    if (!FOUNDATION_DOCUMENT_SET.has(documentPath))
      semanticResultAdmissionFail(
        errorPrefix,
        `sourceClaims[${index}].documentPath is not a Foundation document`,
      )
    const claim = Object.freeze({
      subject: `node:${nodeId}#${pointer}`,
      documentPath: documentPath as GameIrSemanticSourceClaim['documentPath'],
      sectionId: safeId(entry.sectionId, `sourceClaims[${index}].sectionId`),
      sourcePointer: primitives.normalizeSourcePointer(
        entry.sourcePointer,
        `sourceClaims[${index}].sourcePointer`,
      ),
      literal: text(entry.literal, `sourceClaims[${index}].literal`),
    })
    return claim
  }) as readonly GameIrSemanticSourceClaim[]
  for (let index = 1; index < claims.length; index += 1) {
    const left = `${claims[index - 1]!.subject}\0${claims[index - 1]!.sourcePointer}\0${claims[index - 1]!.literal}`
    const right = `${claims[index]!.subject}\0${claims[index]!.sourcePointer}\0${claims[index]!.literal}`
    if (compareCodeUnits(left, right) >= 0)
      semanticResultAdmissionFail(
        errorPrefix,
        'sourceClaims must be unique and sorted',
      )
  }
  const targets = gameIrSemanticTargetPointers(nodes)
  if (
    claims.length !== targets.length ||
    claims.some((claim, index) => claim.subject !== targets[index])
  )
    semanticResultAdmissionFail(
      errorPrefix,
      'sourceClaims must exactly account for every semantic target',
    )
  assertDisjointDomainTargets(packet.forbiddenTargets, targets)
  const admittedNodes = Object.freeze(
    nodes.map(node =>
      Object.freeze({ ...node, producerMode: 'semantic' as const }),
    ),
  )
  const receiptBody = {
    schemaVersion: 'game-ir-domain-semantic-receipt.v1' as const,
    outcome: 'PROJECTED' as const,
    taskId: packet.taskId,
    moduleId: packet.moduleId,
    foundationRevision: packet.foundationRevision,
    sourceDigest: packet.sourceDigest,
    mechanicalReceiptDigest: packet.mechanicalReceiptDigest,
    packetDigest: receiptAuthorityDigest,
    nodes: admittedNodes,
    sourceClaims: Object.freeze(claims),
  }
  return deepFreeze({
    ...receiptBody,
    receiptDigest: digestGameIrValue(receiptBody),
  })
}

export function normalizeGameIrDomainSemanticReceipt(
  packetInput: GameIrDomainSemanticPacket,
  value: unknown,
  options: Pick<
    SemanticResultAdmissionOptions,
    'errorPrefix' | 'allowedModuleIds' | 'receiptAuthorityDigest'
  >,
): GameIrDomainSemanticReceipt {
  const errorPrefix = options.errorPrefix ?? 'invalid Game IR domain projection'
  const primitives = createSemanticFidelityPrimitives(errorPrefix)
  const { exactKeys, strictArray, deepFreeze, sha256 } = primitives
  if (!isRecord(value))
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic receipt must be a plain object',
    )
  exactKeys(
    value,
    [
      'schemaVersion',
      'outcome',
      'taskId',
      'moduleId',
      'foundationRevision',
      'sourceDigest',
      'mechanicalReceiptDigest',
      'packetDigest',
      'nodes',
      'sourceClaims',
      'receiptDigest',
    ],
    'semantic receipt',
  )
  const packet = normalizeGameIrDomainSemanticPacket(packetInput, {
    errorPrefix,
    allowedModuleIds: options.allowedModuleIds,
  })
  if (
    value.schemaVersion !== 'game-ir-domain-semantic-receipt.v1' ||
    value.outcome !== 'PROJECTED' ||
    value.taskId !== packet.taskId ||
    value.moduleId !== packet.moduleId ||
    value.foundationRevision !== packet.foundationRevision ||
    value.sourceDigest !== packet.sourceDigest ||
    value.mechanicalReceiptDigest !== packet.mechanicalReceiptDigest ||
    value.packetDigest !== options.receiptAuthorityDigest
  )
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic receipt identity is stale or relabeled',
    )
  const rawNodes = strictArray(value.nodes, 'semantic receipt nodes')
  const nodes = rawNodes.map((entry, index) => {
    if (!isRecord(entry))
      semanticResultAdmissionFail(
        errorPrefix,
        `semantic receipt nodes[${index}] must be an object`,
      )
    exactKeys(
      entry,
      ['id', 'kind', 'value', 'references', 'edges', 'producerMode'],
      `semantic receipt nodes[${index}]`,
    )
    if (entry.producerMode !== 'semantic')
      semanticResultAdmissionFail(
        errorPrefix,
        `semantic receipt nodes[${index}] must be semantic`,
      )
    const { producerMode: _producerMode, ...candidate } = entry
    return candidate
  })
  const admitted = admitGameIrDomainSemanticResult(
    packet,
    { outcome: 'PROJECTED', nodes, sourceClaims: value.sourceClaims },
    {
      errorPrefix,
      allowedModuleIds: options.allowedModuleIds,
      receiptAuthorityDigest: options.receiptAuthorityDigest,
    },
  )
  if (admitted.outcome !== 'PROJECTED')
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic receipt must be PROJECTED',
    )
  const body = {
    schemaVersion: admitted.schemaVersion,
    outcome: admitted.outcome,
    taskId: admitted.taskId,
    moduleId: admitted.moduleId,
    foundationRevision: admitted.foundationRevision,
    sourceDigest: admitted.sourceDigest,
    mechanicalReceiptDigest: admitted.mechanicalReceiptDigest,
    packetDigest: admitted.packetDigest,
    nodes: admitted.nodes,
    sourceClaims: admitted.sourceClaims,
  }
  const receiptDigest = sha256(
    value.receiptDigest,
    'semantic receipt receiptDigest',
  )
  if (receiptDigest !== digestGameIrValue(body))
    semanticResultAdmissionFail(
      errorPrefix,
      'semantic receipt digest is stale or invalid',
    )
  return deepFreeze({ ...body, receiptDigest })
}
