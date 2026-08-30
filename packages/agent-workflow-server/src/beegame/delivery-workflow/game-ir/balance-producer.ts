import {
  admitGameIrMechanicalProjectionReceipt,
  assertDisjointDomainTargets,
  buildGameIrDomainSemanticPacket,
  type GameIrDomainSemanticPacket,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  BALANCE_RELATIONSHIP_ROLES,
  parseBalanceModule,
} from './balance-schema'
import {
  compareCodeUnits,
  digestGameIrValue,
  parseGameIrModuleCandidate,
  parseGameIrTargetPointer,
  type GameIrSourceBinding,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'
import type { GameplayModuleProjection } from './gameplay-producer'

const BALANCE_NODE_KINDS = Object.freeze(
  Object.keys(BALANCE_RELATIONSHIP_ROLES).sort(compareCodeUnits),
)
const BALANCE_RELATIONSHIP_TYPES = Object.freeze(
  [
    ...new Set(
      Object.values(BALANCE_RELATIONSHIP_ROLES).flatMap(roles =>
        Object.keys(roles),
      ),
    ),
  ].sort(compareCodeUnits),
)
const BALANCE_DOCUMENTS = new Set(['docs/BALANCE_DESIGN.md', 'docs/GDD.md'])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

type BalanceSemanticNode = Readonly<{
  id: string
  kind: string
  value: Readonly<Record<string, unknown>>
  references: readonly Readonly<{ targetId: string; targetType: string }>[]
  edges: readonly Readonly<{
    type: string
    targetId: string
    targetType: string
  }>[]
}>

type BalanceSemanticClaim = Readonly<{
  subject: string
  documentPath: 'docs/BALANCE_DESIGN.md' | 'docs/GDD.md'
  sectionId: string
  sourcePointer: string
  literal: string
}>

export type GameIrDomainSemanticReceipt = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-receipt.v1'
  taskId: string
  moduleId: 'balance'
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  packetDigest: string
  nodes: readonly (BalanceSemanticNode &
    Readonly<{ producerMode: 'semantic' }>)[]
  sourceClaims: readonly BalanceSemanticClaim[]
  receiptDigest: string
}>

export type BalanceModuleProjection = Readonly<{
  schemaVersion: 'game-ir-balance-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'balance' }>
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  projectionDigest: string
}>

function fail(message: string): never {
  throw new Error(`invalid Game IR Balance producer: ${message}`)
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

function strictArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const descriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !descriptor ||
    !('value' in descriptor) ||
    descriptor.value !== value.length ||
    descriptor.enumerable ||
    descriptor.configurable
  )
    fail(`${label} has an invalid length property`)
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1)
    fail(`${label} must be dense without custom properties`)
  for (const key of keys) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^\d+$/.test(key))
      fail(`${label} has a hidden or symbol property`)
    const item = Object.getOwnPropertyDescriptor(value, key)
    if (!item || !('value' in item) || !item.enumerable)
      fail(`${label} has a hidden or accessor property`)
  }
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
  if (!/^[a-f0-9]{64}$/.test(result)) fail(`${label} must be a SHA-256 digest`)
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
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} must contain a finite number`)
    return value
  }
  if (Array.isArray(value))
    return Object.freeze(
      strictArray(value, label).map((entry, index) =>
        cloneJson(entry, `${label}/${index}`),
      ),
    )
  if (!isRecord(value)) fail(`${label} must contain only JSON values`)
  const result: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(`${label} has a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${label}/${key} has a hidden or accessor property`)
    result[key] = cloneJson(descriptor.value, `${label}/${key}`)
  }
  return Object.freeze(result)
}

function referenceOrder(
  left: { targetId: string; targetType: string },
  right: { targetId: string; targetType: string },
): number {
  return compareCodeUnits(
    `${left.targetId}\0${left.targetType}`,
    `${right.targetId}\0${right.targetType}`,
  )
}

function edgeOrder(
  left: { type: string; targetId: string; targetType: string },
  right: { type: string; targetId: string; targetType: string },
): number {
  return compareCodeUnits(
    `${left.type}\0${left.targetId}\0${left.targetType}`,
    `${right.type}\0${right.targetId}\0${right.targetType}`,
  )
}

function normalizeNode(value: unknown, index: number): BalanceSemanticNode {
  if (!isRecord(value)) fail(`nodes[${index}] must be an object`)
  exactKeys(
    value,
    ['id', 'kind', 'value', 'references', 'edges'],
    `nodes[${index}]`,
  )
  const id = safeId(value.id, `nodes[${index}].id`)
  const kind = text(value.kind, `nodes[${index}].kind`)
  if (!BALANCE_NODE_KINDS.includes(kind))
    fail(`nodes[${index}] has an unknown Balance kind`)
  if (!isRecord(value.value)) fail(`nodes[${index}].value must be an object`)
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
  })
  for (let index = 1; index < references.length; index += 1)
    if (referenceOrder(references[index - 1]!, references[index]!) >= 0)
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
      const type = text(entry.type, `nodes[${index}].edges[${edgeIndex}].type`)
      const roles = BALANCE_RELATIONSHIP_ROLES[
        kind as keyof typeof BALANCE_RELATIONSHIP_ROLES
      ] as Readonly<Record<string, { targetKinds: readonly string[] }>>
      const role = roles[type]
      if (!role)
        fail(`nodes[${index}] has an unknown Balance relationship role`)
      const targetType = text(
        entry.targetType,
        `nodes[${index}].edges[${edgeIndex}].targetType`,
      )
      if (!role.targetKinds.includes(targetType))
        fail(`nodes[${index}] relationship role has the wrong target kind`)
      return Object.freeze({
        type,
        targetId: safeId(
          entry.targetId,
          `nodes[${index}].edges[${edgeIndex}].targetId`,
        ),
        targetType,
      })
    },
  )
  for (let index = 1; index < edges.length; index += 1)
    if (edgeOrder(edges[index - 1]!, edges[index]!) >= 0)
      fail(`nodes[${index}].edges must be unique and sorted`)
  return Object.freeze({
    id,
    kind,
    value: cloneJson(value.value, `nodes[${index}].value`) as Readonly<
      Record<string, unknown>
    >,
    references: Object.freeze(references),
    edges: Object.freeze(edges),
  })
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

function semanticTargets(
  nodes: readonly BalanceSemanticNode[],
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

function byteRange(
  pointer: string,
  byteLength: number,
  label: string,
): { start: number; end: number } {
  const normalized = normalizeSourcePointer(pointer, label)
  const parts = normalized.split('/')
  const start = Number(parts[2])
  const end = Number(parts[3])
  if (end > byteLength) fail(`${label} is outside the selected source bytes`)
  return { start, end }
}

function valueAtSubject(node: BalanceSemanticNode, pointer: string): unknown {
  if (pointer === '/id') return node.id
  if (pointer.startsWith('/references/')) {
    const index = Number(pointer.slice('/references/'.length))
    return node.references[index]?.targetId
  }
  if (pointer.startsWith('/edges/')) {
    const index = Number(pointer.slice('/edges/'.length))
    return node.edges[index]?.targetId
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
  claim: BalanceSemanticClaim,
  node: BalanceSemanticNode,
  pointer: string,
): void {
  const expected = valueAtSubject(node, pointer)
  if (typeof expected === 'number') {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(claim.literal))
      fail('Balance numeric source literal is not a strict JSON number')
    const numeric = Number(claim.literal)
    if (!Number.isFinite(numeric) || numeric !== expected)
      fail('Balance source literal does not match the semantic record')
    return
  }
  if (typeof expected === 'string') {
    if (claim.literal !== expected)
      fail('Balance source literal does not match the semantic record')
    return
  }
  const encoded = expected === null ? 'null' : JSON.stringify(expected)
  if (claim.literal !== encoded)
    fail('Balance source literal does not preserve the semantic value type')
}

function verifyClaimBytes(
  source: GameIrDomainSourceEnvelope,
  claim: BalanceSemanticClaim,
): void {
  const section = source.sectionIndex.find(
    candidate =>
      candidate.documentPath === claim.documentPath &&
      candidate.sectionId === claim.sectionId,
  )
  if (!section || !BALANCE_DOCUMENTS.has(claim.documentPath))
    fail(`Balance source claim lies outside exact source sections`)
  const bytes = source.sectionBytes[`${claim.documentPath}#${claim.sectionId}`]
  if (bytes === undefined) fail('Balance source section bytes are missing')
  const range = byteRange(
    claim.sourcePointer,
    Buffer.byteLength(bytes, 'utf8'),
    'Balance source pointer',
  )
  let literal: string
  try {
    literal = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(bytes, 'utf8').subarray(range.start, range.end),
    )
  } catch {
    fail('Balance source byte range is not valid UTF-8')
  }
  if (literal !== claim.literal)
    fail('Balance source byte range does not exactly match its literal')
}

function normalizeClaims(
  value: unknown,
  source: GameIrDomainSourceEnvelope | undefined,
  nodes: readonly BalanceSemanticNode[],
  forbiddenTargets: readonly string[],
): readonly BalanceSemanticClaim[] {
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
    const documentPath = entry.documentPath
    if (!BALANCE_DOCUMENTS.has(documentPath as string))
      fail(`Balance source claims must lie in the Balance source closure`)
    const claim = Object.freeze({
      subject: `node:${nodeId}#${pointer}`,
      documentPath: documentPath as BalanceSemanticClaim['documentPath'],
      sectionId: safeId(entry.sectionId, `sourceClaims[${index}].sectionId`),
      sourcePointer: normalizeSourcePointer(
        entry.sourcePointer,
        `sourceClaims[${index}].sourcePointer`,
      ),
      literal: text(entry.literal, `sourceClaims[${index}].literal`),
    })
    verifyClaimSemanticLiteral(claim, node!, pointer)
    if (source) verifyClaimBytes(source, claim)
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

function packetBody(
  packet: GameIrDomainSemanticPacket,
): Omit<GameIrDomainSemanticPacket, 'packetDigest'> {
  const { packetDigest: _packetDigest, ...body } = packet
  return body
}

function validatePacket(
  packet: GameIrDomainSemanticPacket,
): GameIrDomainSemanticPacket {
  if (!isRecord(packet)) fail('semantic packet must be a plain object')
  exactKeys(
    packet,
    [
      'schemaVersion',
      'taskId',
      'moduleId',
      'foundationRevision',
      'sourceDigest',
      'mechanicalReceiptDigest',
      'allowedNodeKinds',
      'allowedRelationshipTypes',
      'forbiddenTargets',
      'packetDigest',
    ],
    'semantic packet',
  )
  if (
    packet.schemaVersion !== 'game-ir-domain-semantic-packet.v1' ||
    packet.moduleId !== 'balance'
  )
    fail('semantic packet identity is invalid')
  safeId(packet.taskId, 'semantic packet taskId')
  text(packet.foundationRevision, 'semantic packet foundationRevision')
  sha256(packet.sourceDigest, 'semantic packet sourceDigest')
  sha256(
    packet.mechanicalReceiptDigest,
    'semantic packet mechanicalReceiptDigest',
  )
  const allowedKinds = strictArray(packet.allowedNodeKinds, 'allowedNodeKinds')
  if (
    allowedKinds.length !== BALANCE_NODE_KINDS.length ||
    allowedKinds.some((kind, index) => kind !== BALANCE_NODE_KINDS[index])
  )
    fail('semantic packet allowedNodeKinds is not the Balance manifest')
  const allowedRelationships = strictArray(
    packet.allowedRelationshipTypes,
    'allowedRelationshipTypes',
  )
  if (
    allowedRelationships.length !== BALANCE_RELATIONSHIP_TYPES.length ||
    allowedRelationships.some(
      (role, index) => role !== BALANCE_RELATIONSHIP_TYPES[index],
    )
  )
    fail('semantic packet allowedRelationshipTypes is not the Balance manifest')
  const forbidden = strictArray(packet.forbiddenTargets, 'forbiddenTargets')
  for (let index = 0; index < forbidden.length; index += 1)
    text(forbidden[index], `forbiddenTargets[${index}]`)
  for (let index = 1; index < forbidden.length; index += 1)
    if (
      compareCodeUnits(
        String(forbidden[index - 1]),
        String(forbidden[index]),
      ) >= 0
    )
      fail('forbiddenTargets must be unique and sorted')
  sha256(packet.packetDigest, 'semantic packet packetDigest')
  if (packet.packetDigest !== digestGameIrValue(packetBody(packet)))
    fail('semantic packet digest is stale or invalid')
  return packet
}

function verifyMechanicalClaims(
  receipt: GameIrMechanicalProjectionReceipt,
): void {
  if (receipt.nodes.length !== 0 || receipt.verifiedClaims.length !== 0)
    fail(
      'Balance mechanical output is unauthorized under the current table contract',
    )
}

export function buildBalanceSemanticPacket(input: {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
}): GameIrDomainSemanticPacket {
  if (!isRecord(input)) fail('semantic packet input must be a plain object')
  exactKeys(input, ['source', 'mechanical'], 'semantic packet input')
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== 'balance') fail('source moduleId must be balance')
  const mechanical = admitGameIrMechanicalProjectionReceipt(
    source,
    input.mechanical,
  )
  verifyMechanicalClaims(mechanical)
  return buildGameIrDomainSemanticPacket({
    source,
    mechanical,
    allowedNodeKinds: BALANCE_NODE_KINDS,
    allowedRelationshipTypes: BALANCE_RELATIONSHIP_TYPES,
  })
}

function receiptBody(
  receipt: Omit<GameIrDomainSemanticReceipt, 'receiptDigest'>,
): Omit<GameIrDomainSemanticReceipt, 'receiptDigest'> {
  return receipt
}

export function admitBalanceSemanticResult(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): GameIrDomainSemanticReceipt {
  const validatedPacket = validatePacket(packet)
  if (!isRecord(value)) fail('semantic result must be a plain object')
  exactKeys(value, ['nodes', 'sourceClaims'], 'semantic result')
  const nodes = Object.freeze(
    strictArray(value.nodes, 'nodes')
      .map((node, index) => normalizeNode(node, index))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
  )
  const ids = new Set<string>()
  for (const node of nodes) {
    if (ids.has(node.id))
      fail(`semantic result has duplicate node ID ${node.id}`)
    ids.add(node.id)
  }
  const sourceClaims = normalizeClaims(
    value.sourceClaims,
    undefined,
    nodes,
    validatedPacket.forbiddenTargets,
  )
  const body: Omit<GameIrDomainSemanticReceipt, 'receiptDigest'> = {
    schemaVersion: 'game-ir-domain-semantic-receipt.v1',
    taskId: validatedPacket.taskId,
    moduleId: 'balance',
    foundationRevision: validatedPacket.foundationRevision,
    sourceDigest: validatedPacket.sourceDigest,
    mechanicalReceiptDigest: validatedPacket.mechanicalReceiptDigest,
    packetDigest: validatedPacket.packetDigest,
    nodes: Object.freeze(
      nodes.map(node =>
        Object.freeze({ ...node, producerMode: 'semantic' as const }),
      ),
    ),
    sourceClaims,
  }
  return Object.freeze({
    ...body,
    receiptDigest: digestGameIrValue(receiptBody(body)),
  })
}

function validateSemanticReceipt(
  receipt: GameIrDomainSemanticReceipt,
  packet: GameIrDomainSemanticPacket,
  source: GameIrDomainSourceEnvelope,
): GameIrDomainSemanticReceipt {
  if (!isRecord(receipt)) fail('semantic receipt must be a plain object')
  exactKeys(
    receipt,
    [
      'schemaVersion',
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
    receipt.schemaVersion !== 'game-ir-domain-semantic-receipt.v1' ||
    receipt.moduleId !== 'balance'
  )
    fail('semantic receipt schemaVersion or moduleId is invalid')
  if (
    receipt.taskId !== packet.taskId ||
    receipt.foundationRevision !== packet.foundationRevision ||
    receipt.sourceDigest !== packet.sourceDigest ||
    receipt.mechanicalReceiptDigest !== packet.mechanicalReceiptDigest ||
    receipt.packetDigest !== packet.packetDigest
  )
    fail('semantic receipt identity is stale or relabeled')
  const nodes = Object.freeze(
    strictArray(receipt.nodes, 'semantic receipt nodes').map((value, index) => {
      if (!isRecord(value))
        fail(`semantic receipt nodes[${index}] must be an object`)
      exactKeys(
        value,
        ['id', 'kind', 'value', 'references', 'edges', 'producerMode'],
        `semantic receipt nodes[${index}]`,
      )
      if (value.producerMode !== 'semantic')
        fail(`semantic receipt nodes[${index}] must be semantic`)
      const { producerMode: _producerMode, ...rawNode } = value
      return Object.freeze({
        ...normalizeNode(rawNode, index),
        producerMode: 'semantic' as const,
      })
    }),
  )
  for (let index = 1; index < nodes.length; index += 1)
    if (compareCodeUnits(nodes[index - 1]!.id, nodes[index]!.id) >= 0)
      fail('semantic receipt nodes must be canonical and uniquely sorted')
  const claims = normalizeClaims(
    receipt.sourceClaims,
    source,
    nodes,
    packet.forbiddenTargets,
  )
  const body: Omit<GameIrDomainSemanticReceipt, 'receiptDigest'> = {
    schemaVersion: receipt.schemaVersion,
    taskId: receipt.taskId,
    moduleId: 'balance',
    foundationRevision: receipt.foundationRevision,
    sourceDigest: receipt.sourceDigest,
    mechanicalReceiptDigest: receipt.mechanicalReceiptDigest,
    packetDigest: receipt.packetDigest,
    nodes,
    sourceClaims: claims,
  }
  sha256(receipt.receiptDigest, 'semantic receipt receiptDigest')
  if (receipt.receiptDigest !== digestGameIrValue(receiptBody(body)))
    fail('semantic receipt digest is stale or invalid')
  return Object.freeze({ ...body, receiptDigest: receipt.receiptDigest })
}

function gameplayTargets(
  projection: GameplayModuleProjection,
  source: GameIrDomainSourceEnvelope,
): ReadonlyMap<string, GameIrNode> {
  if (!isRecord(projection)) fail('Gameplay projection must be a plain object')
  exactKeys(
    projection,
    [
      'schemaVersion',
      'taskId',
      'foundationRevision',
      'module',
      'mechanicalReceiptDigest',
      'semanticReceiptDigest',
      'projectionDigest',
    ],
    'Gameplay projection',
  )
  if (
    projection.schemaVersion !== 'game-ir-gameplay-module.v1' ||
    projection.taskId !== source.taskId ||
    projection.foundationRevision !==
      source.compileRequest.foundation.foundationRevision
  )
    fail('Gameplay projection identity is stale or relabeled')
  sha256(projection.mechanicalReceiptDigest, 'Gameplay mechanicalReceiptDigest')
  sha256(projection.semanticReceiptDigest, 'Gameplay semanticReceiptDigest')
  const body = {
    schemaVersion: projection.schemaVersion,
    taskId: projection.taskId,
    foundationRevision: projection.foundationRevision,
    module: projection.module,
    mechanicalReceiptDigest: projection.mechanicalReceiptDigest,
    semanticReceiptDigest: projection.semanticReceiptDigest,
  }
  if (projection.projectionDigest !== digestGameIrValue(body))
    fail('Gameplay projection digest is stale or invalid')
  const module = parseGameIrModuleCandidate(projection.module, {
    request: source.compileRequest,
    sections: source.authoritySectionIndex,
    expectedModuleId: 'gameplay',
  })
  return new Map(module.nodes.map(node => [node.id, node]))
}

function bindSemanticNodes(
  source: GameIrDomainSourceEnvelope,
  semantic: GameIrDomainSemanticReceipt,
): GameIrNode[] {
  const sections = new Map(
    source.sectionIndex.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      section,
    ]),
  )
  const claims = new Map(
    semantic.sourceClaims.map(claim => [claim.subject, claim]),
  )
  return semantic.nodes.map(node => {
    const pointers = [
      '/id',
      ...valueLeafPointers(node.value),
      ...node.references.map((_, index) => `/references/${index}`),
      ...node.edges.map((_, index) => `/edges/${index}`),
    ]
    const bindings: Record<string, GameIrSourceBinding> = {}
    for (const pointer of pointers) {
      const claim = claims.get(`node:${node.id}#${pointer}`)
      if (!claim)
        fail(`semantic source claim is missing for node:${node.id}#${pointer}`)
      const section = sections.get(`${claim.documentPath}#${claim.sectionId}`)
      if (!section || !BALANCE_DOCUMENTS.has(claim.documentPath))
        fail('semantic source claim lies outside exact Balance source sections')
      bindings[pointer] = {
        kind: 'owner',
        documentPath: claim.documentPath,
        sectionId: claim.sectionId,
        sectionDigest: section.digest,
        sourcePointer: claim.sourcePointer,
      }
    }
    return { ...node, producerMode: 'semantic' as const, bindings }
  })
}

export function assembleBalanceModule(input: {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  semantic: GameIrDomainSemanticReceipt
  gameplay?: GameplayModuleProjection
}): BalanceModuleProjection {
  if (!isRecord(input)) fail('assembler input must be a plain object')
  exactKeys(
    input,
    Object.hasOwn(input, 'gameplay')
      ? ['source', 'mechanical', 'semantic', 'gameplay']
      : ['source', 'mechanical', 'semantic'],
    'assembler input',
  )
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== 'balance') fail('source moduleId must be balance')
  const mechanical = admitGameIrMechanicalProjectionReceipt(
    source,
    input.mechanical,
  )
  verifyMechanicalClaims(mechanical)
  const packet = buildBalanceSemanticPacket({ source, mechanical })
  const semantic = validateSemanticReceipt(input.semantic, packet, source)
  const semanticNodes = bindSemanticNodes(source, semantic)
  const ids = new Set(mechanical.nodes.map(node => node.id))
  for (const node of semanticNodes) {
    if (ids.has(node.id))
      fail(`duplicate node ID across producer receipts: ${node.id}`)
    ids.add(node.id)
  }
  const mergedNodes = [...mechanical.nodes, ...semanticNodes].sort(
    (left, right) => compareCodeUnits(left.id, right.id),
  )
  const coreAdmitted = parseGameIrModuleCandidate(
    { moduleId: 'balance', nodes: mergedNodes },
    {
      request: source.compileRequest,
      sections: source.authoritySectionIndex,
      expectedModuleId: 'balance',
    },
  )
  const targets = input.gameplay
    ? gameplayTargets(input.gameplay, source)
    : undefined
  const module = parseBalanceModule(coreAdmitted, targets)
  const body: Omit<BalanceModuleProjection, 'projectionDigest'> = {
    schemaVersion: 'game-ir-balance-module.v1',
    taskId: source.taskId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    module: module as GameIrModuleCandidate & Readonly<{ moduleId: 'balance' }>,
    mechanicalReceiptDigest: mechanical.receiptDigest,
    semanticReceiptDigest: semantic.receiptDigest,
  }
  return deepFreeze({ ...body, projectionDigest: digestGameIrValue(body) })
}
