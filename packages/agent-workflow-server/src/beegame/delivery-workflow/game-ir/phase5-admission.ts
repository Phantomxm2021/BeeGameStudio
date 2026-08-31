import {
  admitGameIrMechanicalProjectionReceipt,
  assertDisjointDomainTargets,
  buildGameIrDomainSemanticPacket,
  parseGameIrDomainSemanticDiagnosticValue,
  type GameIrDomainSemanticDiagnostic,
  type GameIrDomainSemanticPacket,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainId,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
  parseGameIrModuleCandidate,
  parseGameIrTargetPointer,
  type GameIrModuleCandidate,
  type GameIrReference,
  type GameIrRelationshipEdge,
} from './model'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'

/*
 * This is the only Phase 5 receipt boundary. Domain producers should pass
 * their worker DTOs here and closure assembly should pass receipts here for
 * replay; neither side owns a parser, canonicalizer, or binding writer.
 */

export type Phase5SemanticCandidateNode = Readonly<{
  id: string
  kind: string
  value: Readonly<Record<string, unknown>>
  references: readonly GameIrReference[]
  edges: readonly GameIrRelationshipEdge[]
}>

export type Phase5AdmittedSemanticNode = Phase5SemanticCandidateNode &
  Readonly<{ producerMode: 'semantic' }>

export type GameIrDomainSourceClaim = Readonly<{
  subject: string
  documentPath: FoundationDocumentPath
  sectionId: string
  sourcePointer: string
  literal: string
}>

export type Phase5SemanticReceipt = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-receipt.v1'
  outcome: 'PROJECTED'
  taskId: string
  moduleId: Extract<GameIrDomainId, 'world-scene' | 'presentation'>
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  packetDigest: string
  nodes: readonly Phase5AdmittedSemanticNode[]
  sourceClaims: readonly GameIrDomainSourceClaim[]
  receiptDigest: string
}>

export type Phase5SemanticResult =
  | Phase5SemanticReceipt
  | GameIrDomainSemanticDiagnostic

export type Phase5BoundSemanticModule = Readonly<{
  source: GameIrDomainSourceEnvelope
  module: GameIrModuleCandidate &
    Readonly<{ moduleId: 'world-scene' | 'presentation' }>
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
}>

const PHASE5_MODULE_IDS = ['presentation', 'world-scene'] as const
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SHA256 = /^[a-f0-9]{64}$/
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const FOUNDATION_DOCUMENT_SET = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)

function fail(message: string): never {
  throw new Error(`invalid Game IR Phase 5 admission: ${message}`)
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
  const actual = Reflect.ownKeys(value)
  for (const key of actual) {
    if (typeof key !== 'string') fail(`${label} has a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${label} has a hidden or accessor property`)
  }
  const sorted = (actual as string[]).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    sorted.length !== wanted.length ||
    sorted.some((key, index) => key !== wanted[index])
  )
    fail(`${label} has unknown or missing fields`)
}

function strictArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const length = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !length ||
    !('value' in length) ||
    length.value !== value.length ||
    length.enumerable ||
    length.configurable
  )
    fail(`${label} has an invalid length property`)
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1)
    fail(`${label} must be dense without custom properties`)
  for (const key of keys) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^\d+$/.test(key))
      fail(`${label} has a hidden or symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${label} has a hidden or accessor property`)
  }
  for (let index = 0; index < value.length; index += 1)
    if (!Object.hasOwn(value, String(index))) fail(`${label} must be dense`)
  return value
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    fail(`${label} must be non-empty text`)
  return value
}

function safeId(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SAFE_ID.test(result)) fail(`${label} must be a safe identifier`)
  return result
}

function sha256(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SHA256.test(result)) fail(`${label} must be a SHA-256 digest`)
  return result
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function cloneJson(value: unknown, label: string): unknown {
  try {
    return JSON.parse(canonicalGameIrJson(value))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('invalid Game IR'))
      fail(`${label} contains invalid JSON`)
    fail(`${label} contains invalid JSON`)
  }
}

function normalizeSourcePointer(value: unknown, label: string): string {
  const pointer = text(value, label)
  const parts = pointer.split('/')
  if (
    parts.length !== 4 ||
    parts[1] !== 'bytes' ||
    !/^(?:0|[1-9]\d*)$/.test(parts[2]!) ||
    !/^(?:0|[1-9]\d*)$/.test(parts[3]!)
  )
    fail(`${label} must be a canonical /bytes/<start>/<end> range`)
  const start = Number(parts[2])
  const end = Number(parts[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= end
  )
    fail(`${label} must contain a non-empty byte range`)
  return pointer
}

function valueLeafPointers(value: Readonly<Record<string, unknown>>): string[] {
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

function referenceOrder(left: GameIrReference, right: GameIrReference): number {
  return compareCodeUnits(
    `${left.targetId}\0${left.targetType}`,
    `${right.targetId}\0${right.targetType}`,
  )
}

function edgeOrder(
  left: GameIrRelationshipEdge,
  right: GameIrRelationshipEdge,
): number {
  return compareCodeUnits(
    `${left.type}\0${left.targetId}\0${left.targetType}`,
    `${right.type}\0${right.targetId}\0${right.targetType}`,
  )
}

function normalizeNode(
  value: unknown,
  index: number,
  allowedNodeKinds: readonly string[] = [],
  allowedRelationshipTypes: readonly string[] = [],
): Phase5SemanticCandidateNode {
  if (!isRecord(value)) fail(`nodes[${index}] must be an object`)
  exactKeys(
    value,
    ['id', 'kind', 'value', 'references', 'edges'],
    `nodes[${index}]`,
  )
  const id = safeId(value.id, `nodes[${index}].id`)
  const kind = text(value.kind, `nodes[${index}].kind`)
  if (allowedNodeKinds.length > 0 && !allowedNodeKinds.includes(kind))
    fail(`nodes[${index}] has a node kind outside the semantic packet`)
  if (!isRecord(value.value)) fail(`nodes[${index}].value must be an object`)
  const clonedValue = cloneJson(value.value, `nodes[${index}].value`)
  if (!isRecord(clonedValue)) fail(`nodes[${index}].value must be an object`)
  const references = strictArray(
    value.references,
    `nodes[${index}].references`,
  ).map((entry, referenceIndex) => {
    if (!isRecord(entry))
      fail(`nodes[${index}].references[${referenceIndex}] must be an object`)
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
  )
    if (
      referenceOrder(
        references[referenceIndex - 1]!,
        references[referenceIndex]!,
      ) >= 0
    )
      fail(`nodes[${index}].references must be unique and sorted`)
  const edges = strictArray(value.edges, `nodes[${index}].edges`).map(
    (entry, edgeIndex) => {
      if (!isRecord(entry))
        fail(`nodes[${index}].edges[${edgeIndex}] must be an object`)
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
  if (
    allowedRelationshipTypes.length > 0 &&
    edges.some(edge => !allowedRelationshipTypes.includes(edge.type))
  )
    fail(`nodes[${index}] has a relationship type outside the semantic packet`)
  for (let edgeIndex = 1; edgeIndex < edges.length; edgeIndex += 1)
    if (edgeOrder(edges[edgeIndex - 1]!, edges[edgeIndex]!) >= 0)
      fail(`nodes[${index}].edges must be unique and sorted`)
  return Object.freeze({
    id,
    kind,
    value: deepFreeze(clonedValue),
    references: Object.freeze(references),
    edges: Object.freeze(edges),
  })
}

function semanticTargets(
  nodes: readonly Phase5SemanticCandidateNode[],
): readonly string[] {
  return Object.freeze(
    nodes
      .flatMap(node => [
        `node:${node.id}#/id`,
        ...valueLeafPointers(node.value).map(
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

function valueAtSubject(
  node: Phase5SemanticCandidateNode,
  pointer: string,
): unknown {
  if (pointer === '/id') return node.id
  if (pointer.startsWith('/references/')) {
    const index = Number(pointer.slice('/references/'.length))
    const reference = node.references[index]
    return (
      reference && {
        targetId: reference.targetId,
        targetType: reference.targetType,
      }
    )
  }
  if (pointer.startsWith('/edges/')) {
    const index = Number(pointer.slice('/edges/'.length))
    const edge = node.edges[index]
    return (
      edge && {
        type: edge.type,
        targetId: edge.targetId,
        targetType: edge.targetType,
      }
    )
  }
  if (pointer === '/value') return node.value
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

function verifyClaimSemanticLiteral(
  claim: GameIrDomainSourceClaim,
  node: Phase5SemanticCandidateNode,
  pointer: string,
): void {
  const expected = valueAtSubject(node, pointer)
  if (expected === undefined)
    fail(`source claim target ${claim.subject} is absent`)
  if (typeof expected === 'number') {
    if (!JSON_NUMBER.test(claim.literal))
      fail('numeric source literal is not a strict JSON number')
    const numeric = Number(claim.literal)
    if (!Number.isFinite(numeric) || numeric !== expected)
      fail('source literal does not match the semantic record')
    return
  }
  const expectedLiteral =
    typeof expected === 'string' ? expected : canonicalGameIrJson(expected)
  if (claim.literal !== expectedLiteral)
    fail('source literal does not match the semantic record')
}

function normalizeClaims(
  value: unknown,
  nodes: readonly Phase5SemanticCandidateNode[],
  forbiddenTargets: readonly string[],
): readonly GameIrDomainSourceClaim[] {
  const raw = strictArray(value, 'sourceClaims')
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const claims = raw.map((entry, index) => {
    if (!isRecord(entry)) fail(`sourceClaims[${index}] must be an object`)
    exactKeys(
      entry,
      ['subject', 'documentPath', 'sectionId', 'sourcePointer', 'literal'],
      `sourceClaims[${index}]`,
    )
    const subject = text(entry.subject, `sourceClaims[${index}].subject`)
    if (!subject.startsWith('node:'))
      fail(`sourceClaims[${index}].subject must be node-qualified`)
    const separator = subject.indexOf('#')
    if (separator <= 'node:'.length)
      fail(`sourceClaims[${index}].subject must be node-qualified`)
    const nodeId = safeId(
      subject.slice('node:'.length, separator),
      `sourceClaims[${index}].subject node ID`,
    )
    const node = nodeMap.get(nodeId)
    if (!node) fail(`sourceClaims[${index}] refers to an unknown node`)
    const pointerText = subject.slice(separator + 1)
    let pointer: string
    try {
      pointer = parseGameIrTargetPointer(pointerText)
    } catch {
      fail(`sourceClaims[${index}].subject has an invalid target pointer`)
    }
    if (pointer !== pointerText)
      fail(`sourceClaims[${index}].subject is not canonical`)
    const documentPath = text(
      entry.documentPath,
      `sourceClaims[${index}].documentPath`,
    )
    if (!FOUNDATION_DOCUMENT_SET.has(documentPath))
      fail(`sourceClaims[${index}].documentPath is not a Foundation document`)
    const claim = Object.freeze({
      subject: `node:${nodeId}#${pointer}`,
      documentPath: documentPath as FoundationDocumentPath,
      sectionId: safeId(entry.sectionId, `sourceClaims[${index}].sectionId`),
      sourcePointer: normalizeSourcePointer(
        entry.sourcePointer,
        `sourceClaims[${index}].sourcePointer`,
      ),
      literal: text(entry.literal, `sourceClaims[${index}].literal`),
    })
    verifyClaimSemanticLiteral(claim, node!, pointer)
    return claim
  })
  for (let index = 1; index < claims.length; index += 1) {
    const left = `${claims[index - 1]!.subject}\0${claims[index - 1]!.sourcePointer}\0${claims[index - 1]!.literal}`
    const right = `${claims[index]!.subject}\0${claims[index]!.sourcePointer}\0${claims[index]!.literal}`
    if (compareCodeUnits(left, right) >= 0)
      fail('sourceClaims must be unique and sorted')
  }
  const targets = semanticTargets(nodes)
  if (
    claims.length !== targets.length ||
    claims.some((claim, index) => claim.subject !== targets[index])
  )
    fail('sourceClaims must exactly account for every semantic target')
  assertDisjointDomainTargets(forbiddenTargets, targets)
  return Object.freeze(claims)
}

function normalizePacket(
  value: GameIrDomainSemanticPacket,
): GameIrDomainSemanticPacket {
  if (!isRecord(value)) fail('semantic packet must be a plain object')
  exactKeys(
    value,
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
  if (value.schemaVersion !== 'game-ir-domain-semantic-packet.v1')
    fail('semantic packet schemaVersion is invalid')
  if (!PHASE5_MODULE_IDS.includes(value.moduleId as never))
    fail('semantic packet moduleId is not a Phase 5 module')
  const taskId = text(value.taskId, 'semantic packet taskId')
  const moduleId = value.moduleId as Extract<
    GameIrDomainId,
    'world-scene' | 'presentation'
  >
  const foundationRevision = text(
    value.foundationRevision,
    'semantic packet foundationRevision',
  )
  const sourceDigest = sha256(
    value.sourceDigest,
    'semantic packet sourceDigest',
  )
  const mechanicalReceiptDigest = sha256(
    value.mechanicalReceiptDigest,
    'semantic packet mechanicalReceiptDigest',
  )
  const normalizeStrings = (raw: unknown, label: string): readonly string[] => {
    const entries = strictArray(raw, label).map((entry, index) =>
      text(entry, `${label}[${index}]`),
    )
    for (let index = 1; index < entries.length; index += 1)
      if (compareCodeUnits(entries[index - 1]!, entries[index]!) >= 0)
        fail(`${label} must be unique and sorted`)
    return Object.freeze(entries)
  }
  const body = {
    schemaVersion: 'game-ir-domain-semantic-packet.v1' as const,
    taskId,
    moduleId,
    foundationRevision,
    sourceDigest,
    mechanicalReceiptDigest,
    allowedNodeKinds: normalizeStrings(
      value.allowedNodeKinds,
      'semantic packet allowedNodeKinds',
    ),
    allowedRelationshipTypes: normalizeStrings(
      value.allowedRelationshipTypes,
      'semantic packet allowedRelationshipTypes',
    ),
    allowedEvidencePointers: normalizeStrings(
      value.allowedEvidencePointers,
      'semantic packet allowedEvidencePointers',
    ),
    forbiddenTargets: normalizeStrings(
      value.forbiddenTargets,
      'semantic packet forbiddenTargets',
    ),
  } as const
  const packetDigest = sha256(
    value.packetDigest,
    'semantic packet packetDigest',
  )
  if (packetDigest !== digestGameIrValue(body))
    fail('semantic packet digest is stale or invalid')
  return deepFreeze({ ...body, packetDigest })
}

function packetForSource(
  source: GameIrDomainSourceEnvelope,
  mechanicalReceipt: GameIrMechanicalProjectionReceipt,
  packet: GameIrDomainSemanticPacket,
): GameIrDomainSemanticPacket {
  const normalized = normalizePacket(packet)
  const rebuilt = buildGameIrDomainSemanticPacket({
    source,
    mechanical: mechanicalReceipt,
    allowedNodeKinds: normalized.allowedNodeKinds,
    allowedRelationshipTypes: normalized.allowedRelationshipTypes,
  })
  if (canonicalGameIrJson(normalized) !== canonicalGameIrJson(rebuilt))
    fail(
      'semantic packet is stale, relabeled, or detached from source authority',
    )
  return rebuilt
}

function admitDiagnostic(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): GameIrDomainSemanticDiagnostic {
  const diagnostic = parseGameIrDomainSemanticDiagnosticValue(
    value,
    packet.allowedEvidencePointers,
  )
  const body: Omit<GameIrDomainSemanticDiagnostic, 'diagnosticDigest'> = {
    schemaVersion: 'game-ir-domain-semantic-diagnostic.v1',
    taskId: packet.taskId,
    moduleId: packet.moduleId,
    foundationRevision: packet.foundationRevision,
    sourceDigest: packet.sourceDigest,
    mechanicalReceiptDigest: packet.mechanicalReceiptDigest,
    packetDigest: packet.packetDigest,
    ...diagnostic,
  }
  return deepFreeze({ ...body, diagnosticDigest: digestGameIrValue(body) })
}

export function admitPhase5SemanticResult(
  packetInput: GameIrDomainSemanticPacket,
  value: unknown,
): Phase5SemanticResult {
  const packet = normalizePacket(packetInput)
  if (!isRecord(value)) fail('semantic result must be a plain object')
  if (value.outcome === 'FAIL' || value.outcome === 'AMBIGUOUS')
    return admitDiagnostic(packet, value)
  exactKeys(value, ['outcome', 'nodes', 'sourceClaims'], 'semantic result')
  if (value.outcome !== 'PROJECTED')
    fail('semantic result outcome must be PROJECTED, FAIL, or AMBIGUOUS')
  const nodes = Object.freeze(
    strictArray(value.nodes, 'nodes')
      .map((node, index) =>
        normalizeNode(
          node,
          index,
          packet.allowedNodeKinds,
          packet.allowedRelationshipTypes,
        ),
      )
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
  )
  for (let index = 1; index < nodes.length; index += 1)
    if (nodes[index - 1]!.id === nodes[index]!.id)
      fail(`semantic result has duplicate node ID ${nodes[index]!.id}`)
  const sourceClaims = normalizeClaims(
    value.sourceClaims,
    nodes,
    packet.forbiddenTargets,
  )
  const admittedNodes = Object.freeze(
    nodes.map(node =>
      Object.freeze({ ...node, producerMode: 'semantic' as const }),
    ),
  )
  const body: Omit<Phase5SemanticReceipt, 'receiptDigest'> = {
    schemaVersion: 'game-ir-domain-semantic-receipt.v1',
    outcome: 'PROJECTED',
    taskId: packet.taskId,
    moduleId: packet.moduleId as Phase5SemanticReceipt['moduleId'],
    foundationRevision: packet.foundationRevision,
    sourceDigest: packet.sourceDigest,
    mechanicalReceiptDigest: packet.mechanicalReceiptDigest,
    packetDigest: packet.packetDigest,
    nodes: admittedNodes,
    sourceClaims,
  }
  return deepFreeze({ ...body, receiptDigest: digestGameIrValue(body) })
}

function normalizeStoredReceipt(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): Phase5SemanticReceipt {
  if (!isRecord(value)) fail('semantic receipt must be a plain object')
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
  if (
    value.schemaVersion !== 'game-ir-domain-semantic-receipt.v1' ||
    value.outcome !== 'PROJECTED' ||
    value.taskId !== packet.taskId ||
    value.moduleId !== packet.moduleId ||
    value.foundationRevision !== packet.foundationRevision ||
    value.sourceDigest !== packet.sourceDigest ||
    value.mechanicalReceiptDigest !== packet.mechanicalReceiptDigest ||
    value.packetDigest !== packet.packetDigest
  )
    fail('semantic receipt identity is stale or relabeled')
  const nodes = Object.freeze(
    strictArray(value.nodes, 'semantic receipt nodes').map((entry, index) => {
      if (!isRecord(entry))
        fail(`semantic receipt nodes[${index}] must be an object`)
      exactKeys(
        entry,
        ['id', 'kind', 'value', 'references', 'edges', 'producerMode'],
        `semantic receipt nodes[${index}]`,
      )
      if (entry.producerMode !== 'semantic')
        fail(`semantic receipt nodes[${index}] must be semantic`)
      const { producerMode: _producerMode, ...candidate } = entry
      return Object.freeze(
        normalizeNode(
          candidate,
          index,
          packet.allowedNodeKinds,
          packet.allowedRelationshipTypes,
        ),
      )
    }),
  )
  for (let index = 1; index < nodes.length; index += 1)
    if (compareCodeUnits(nodes[index - 1]!.id, nodes[index]!.id) >= 0)
      fail('semantic receipt nodes must be canonical and uniquely sorted')
  const sourceClaims = normalizeClaims(
    value.sourceClaims,
    nodes,
    packet.forbiddenTargets,
  )
  const body: Omit<Phase5SemanticReceipt, 'receiptDigest'> = {
    schemaVersion: 'game-ir-domain-semantic-receipt.v1',
    outcome: 'PROJECTED',
    taskId: packet.taskId,
    moduleId: packet.moduleId as Phase5SemanticReceipt['moduleId'],
    foundationRevision: packet.foundationRevision,
    sourceDigest: packet.sourceDigest,
    mechanicalReceiptDigest: packet.mechanicalReceiptDigest,
    packetDigest: packet.packetDigest,
    nodes: Object.freeze(
      nodes.map(node =>
        Object.freeze({ ...node, producerMode: 'semantic' as const }),
      ),
    ),
    sourceClaims,
  }
  const receiptDigest = sha256(
    value.receiptDigest,
    'semantic receipt receiptDigest',
  )
  if (receiptDigest !== digestGameIrValue(body))
    fail('semantic receipt digest is stale or invalid')
  return deepFreeze({ ...body, receiptDigest })
}

function verifyClaimBytes(
  source: GameIrDomainSourceEnvelope,
  claim: GameIrDomainSourceClaim,
): void {
  const section = source.sectionIndex.find(
    candidate =>
      candidate.documentPath === claim.documentPath &&
      candidate.sectionId === claim.sectionId,
  )
  if (!section)
    fail('source claim lies outside the exact selected source closure')
  const bytesText =
    source.sectionBytes[`${claim.documentPath}#${claim.sectionId}`]
  if (bytesText === undefined) fail('source section bytes are missing')
  const bytes = Buffer.from(bytesText, 'utf8')
  const pointer = normalizeSourcePointer(claim.sourcePointer, 'source pointer')
  const [, , startText, endText] = pointer.split('/')
  const start = Number(startText)
  const end = Number(endText)
  if (end > bytes.length)
    fail('source pointer is outside selected source bytes')
  const boundary = (offset: number): boolean =>
    offset === 0 || offset === bytes.length || (bytes[offset]! & 0xc0) !== 0x80
  if (!boundary(start) || !boundary(end))
    fail('source pointer does not lie on UTF-8 code-point boundaries')
  let literal: string
  try {
    literal = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(start, end),
    )
  } catch {
    fail('source byte range is not valid UTF-8')
  }
  if (literal !== claim.literal)
    fail('source byte range does not exactly match its literal')
}

export function replayAndBindPhase5SemanticReceipt(
  input: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    packet: GameIrDomainSemanticPacket
    semantic: Phase5SemanticReceipt
  }>,
): Phase5BoundSemanticModule {
  if (!isRecord(input)) fail('receipt replay input must be a plain object')
  exactKeys(
    input,
    ['source', 'mechanical', 'packet', 'semantic'],
    'receipt replay input',
  )
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== 'world-scene' && source.moduleId !== 'presentation')
    fail('source moduleId is not a Phase 5 module')
  const mechanical = admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: input.mechanical,
  })
  const packet = packetForSource(source, mechanical, input.packet)
  const semantic = normalizeStoredReceipt(packet, input.semantic)
  const nodesById = new Map(semantic.nodes.map(node => [node.id, node]))
  for (const claim of semantic.sourceClaims) {
    const separator = claim.subject.indexOf('#')
    const node = nodesById.get(claim.subject.slice('node:'.length, separator))
    if (!node) fail('source claim refers to an unknown semantic node')
    const pointer = claim.subject.slice(separator + 1)
    verifyClaimSemanticLiteral(claim, node, pointer)
    verifyClaimBytes(source, claim)
  }
  const claimsBySubject = new Map(
    semantic.sourceClaims.map(claim => [claim.subject, claim]),
  )
  const sectionsByKey = new Map(
    source.sectionIndex.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      section,
    ]),
  )
  const boundNodes = semantic.nodes.map(node => {
    const pointers = [
      '/id',
      ...valueLeafPointers(node.value),
      ...node.references.map((_, index) => `/references/${index}`),
      ...node.edges.map((_, index) => `/edges/${index}`),
    ]
    const bindings: Record<string, unknown> = {}
    for (const pointer of pointers) {
      const claim = claimsBySubject.get(`node:${node.id}#${pointer}`)
      if (!claim)
        fail(`semantic source claim is missing for node:${node.id}#${pointer}`)
      const section = sectionsByKey.get(
        `${claim.documentPath}#${claim.sectionId}`,
      )
      if (!section)
        fail('semantic source claim lies outside exact source closure')
      bindings[pointer] = {
        kind: 'owner',
        documentPath: claim.documentPath,
        sectionId: claim.sectionId,
        sectionDigest: section.digest,
        sourcePointer: claim.sourcePointer,
      }
    }
    return { ...node, bindings }
  })
  assertDisjointDomainTargets(
    mechanical.ownedTargets,
    semanticTargets(semantic.nodes),
  )
  const module = parseGameIrModuleCandidate(
    {
      moduleId: source.moduleId,
      nodes: boundNodes,
    },
    {
      request: source.compileRequest,
      sections: source.authoritySectionIndex,
      expectedModuleId: source.moduleId,
    },
  )
  return deepFreeze({
    source,
    module: module as Phase5BoundSemanticModule['module'],
    mechanicalReceiptDigest: mechanical.receiptDigest,
    semanticReceiptDigest: semantic.receiptDigest,
  })
}
