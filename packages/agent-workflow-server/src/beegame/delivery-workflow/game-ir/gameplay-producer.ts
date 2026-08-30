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
  GAMEPLAY_RELATIONSHIP_ROLES,
  parseGameplayModule,
} from './gameplay-schema'
import {
  compareCodeUnits,
  digestGameIrValue,
  parseGameIrModuleCandidate,
  parseGameIrTargetPointer,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'

const GAMEPLAY_NODE_KINDS = Object.freeze([
  'gameplay.action',
  'gameplay.capability',
  'gameplay.condition',
  'gameplay.effect',
  'gameplay.entity',
  'gameplay.event',
  'gameplay.objective',
  'gameplay.outcome',
  'gameplay.rule',
  'gameplay.state',
  'gameplay.transition',
] as const)

const GAMEPLAY_RELATIONSHIP_TYPES = Object.freeze(
  [
    ...new Set(
      Object.values(GAMEPLAY_RELATIONSHIP_ROLES).flatMap(roles =>
        Object.keys(roles),
      ),
    ),
  ].sort(compareCodeUnits),
)

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

type GameplaySemanticNode = Readonly<{
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

type GameplayAdmittedNode = GameplaySemanticNode &
  Readonly<{ producerMode: 'semantic' }>

type GameplaySourceClaim = Readonly<{
  subject: string
  documentPath: 'docs/GDD.md'
  sectionId: string
  sourcePointer: string
  literal: string
}>

export type GameIrDomainSemanticReceipt = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-receipt.v1'
  taskId: string
  moduleId: 'gameplay'
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  packetDigest: string
  nodes: readonly GameplayAdmittedNode[]
  sourceClaims: readonly GameplaySourceClaim[]
  receiptDigest: string
}>

export type GameplayModuleProjection = Readonly<{
  schemaVersion: 'game-ir-gameplay-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'gameplay' }>
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  projectionDigest: string
}>

function fail(message: string): never {
  throw new Error(`invalid Game IR Gameplay producer: ${message}`)
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
  const length = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !length ||
    !('value' in length) ||
    length.value !== value.length ||
    length.enumerable ||
    length.configurable
  )
    fail(`${label} has an invalid length property`)
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== value.length + 1)
    fail(`${label} must be dense without custom properties`)
  for (const key of ownKeys) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^\d+$/.test(key))
      fail(`${label} has a hidden or symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
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

function cloneJson(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must be finite`)
    return value
  }
  if (Array.isArray(value)) {
    const output = strictArray(value, path).map((entry, index) =>
      cloneJson(entry, `${path}/${index}`),
    )
    return Object.freeze(output)
  }
  if (!isRecord(value)) fail(`${path} must contain only JSON values`)
  const output: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(`${path} has a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${path}/${key} has a hidden or accessor property`)
    output[key] = cloneJson(descriptor.value, `${path}/${key}`)
  }
  return Object.freeze(output)
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

function normalizeNode(value: unknown, index: number): GameplaySemanticNode {
  if (!isRecord(value)) fail(`nodes[${index}] must be a plain object`)
  exactKeys(
    value,
    ['id', 'kind', 'value', 'references', 'edges'],
    `nodes[${index}]`,
  )
  const id = safeId(value.id, `nodes[${index}].id`)
  const kind = text(value.kind, `nodes[${index}].kind`)
  if (!GAMEPLAY_NODE_KINDS.includes(kind as never))
    fail(`nodes[${index}] has an unknown Gameplay kind`)
  if (!isRecord(value.value)) fail(`nodes[${index}].value must be an object`)
  const normalizedValue = cloneJson(
    value.value,
    `nodes[${index}].value`,
  ) as Readonly<Record<string, unknown>>
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
      const type = text(entry.type, `nodes[${index}].edges[${edgeIndex}].type`)
      const roles = GAMEPLAY_RELATIONSHIP_ROLES[
        kind as keyof typeof GAMEPLAY_RELATIONSHIP_ROLES
      ] as
        | Readonly<Record<string, { targetKinds: readonly string[] }>>
        | undefined
      const role = roles?.[type]
      if (!role || !GAMEPLAY_RELATIONSHIP_TYPES.includes(type as never))
        fail(`nodes[${index}] has an unknown Gameplay relationship role`)
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
  for (let edgeIndex = 1; edgeIndex < edges.length; edgeIndex += 1)
    if (edgeOrder(edges[edgeIndex - 1]!, edges[edgeIndex]!) >= 0)
      fail(`nodes[${index}].edges must be unique and sorted`)
  return Object.freeze({
    id,
    kind,
    value: normalizedValue,
    references: Object.freeze(references),
    edges: Object.freeze(edges),
  })
}

function valueLeafPointers(value: Readonly<Record<string, unknown>>): string[] {
  const leaves: string[] = []
  const encode = (segment: string): string =>
    segment.replaceAll('~', '~0').replaceAll('/', '~1')
  const visit = (entry: unknown, path: string): void => {
    if (Array.isArray(entry)) {
      if (entry.length === 0) leaves.push(path)
      else entry.forEach((child, index) => visit(child, `${path}/${index}`))
      return
    }
    if (entry && typeof entry === 'object') {
      const entries = Object.entries(entry as Record<string, unknown>)
      if (entries.length === 0) leaves.push(path)
      else
        entries.forEach(([key, child]) =>
          visit(child, `${path}/${encode(key)}`),
        )
      return
    }
    leaves.push(path)
  }
  const entries = Object.entries(value)
  if (entries.length === 0) leaves.push('/value')
  else entries.forEach(([key, child]) => visit(child, `/value/${encode(key)}`))
  return leaves
}

function semanticTargets(
  nodes: readonly GameplaySemanticNode[],
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
  if (!pointer.startsWith('/') || pointer.includes('\0'))
    fail(`${label} must be a safe source pointer`)
  if (
    pointer
      .split('/')
      .slice(1)
      .some(
        segment => segment.length === 0 || segment === '.' || segment === '..',
      )
  )
    fail(`${label} must be a safe source pointer`)
  const segments = pointer.slice(1).split('/')
  if (
    segments.some(
      segment =>
        segment.includes('\\') ||
        segment.includes('__proto__') ||
        segment.includes('constructor') ||
        segment.includes('prototype') ||
        /~(?![01])/.test(segment),
    )
  )
    fail(`${label} must be a safe source pointer`)
  return pointer
}

function normalizeClaims(
  value: unknown,
  nodes: readonly GameplaySemanticNode[],
  forbiddenTargets: readonly string[],
): readonly GameplaySourceClaim[] {
  const raw = strictArray(value, 'sourceClaims')
  const nodeIds = new Set(nodes.map(node => node.id))
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
    if (!nodeIds.has(nodeId))
      fail(`sourceClaims[${index}] refers to an unknown node`)
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
    if (documentPath !== 'docs/GDD.md')
      fail('Gameplay source claims must lie in docs/GDD.md')
    return Object.freeze({
      subject: `node:${nodeId}#${pointer}`,
      documentPath: 'docs/GDD.md' as const,
      sectionId: safeId(entry.sectionId, `sourceClaims[${index}].sectionId`),
      sourcePointer: normalizeSourcePointer(
        entry.sourcePointer,
        `sourceClaims[${index}].sourcePointer`,
      ),
      literal: text(entry.literal, `sourceClaims[${index}].literal`),
    })
  })
  for (let index = 1; index < claims.length; index += 1) {
    const previous = `${claims[index - 1]!.subject}\0${claims[index - 1]!.sourcePointer}\0${claims[index - 1]!.literal}`
    const current = `${claims[index]!.subject}\0${claims[index]!.sourcePointer}\0${claims[index]!.literal}`
    if (compareCodeUnits(previous, current) >= 0)
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
  if (packet.schemaVersion !== 'game-ir-domain-semantic-packet.v1')
    fail('semantic packet schemaVersion is invalid')
  if (packet.moduleId !== 'gameplay')
    fail('semantic packet moduleId is not gameplay')
  safeId(packet.taskId, 'semantic packet taskId')
  text(packet.foundationRevision, 'semantic packet foundationRevision')
  sha256(packet.sourceDigest, 'semantic packet sourceDigest')
  sha256(
    packet.mechanicalReceiptDigest,
    'semantic packet mechanicalReceiptDigest',
  )
  const allowedKinds = strictArray(packet.allowedNodeKinds, 'allowedNodeKinds')
  if (
    allowedKinds.length !== GAMEPLAY_NODE_KINDS.length ||
    allowedKinds.some((kind, index) => kind !== GAMEPLAY_NODE_KINDS[index])
  )
    fail('semantic packet allowedNodeKinds is not the Gameplay manifest')
  const allowedRelationships = strictArray(
    packet.allowedRelationshipTypes,
    'allowedRelationshipTypes',
  )
  if (
    allowedRelationships.length !== GAMEPLAY_RELATIONSHIP_TYPES.length ||
    allowedRelationships.some(
      (role, index) => role !== GAMEPLAY_RELATIONSHIP_TYPES[index],
    )
  )
    fail(
      'semantic packet allowedRelationshipTypes is not the Gameplay manifest',
    )
  const forbiddenTargets = strictArray(
    packet.forbiddenTargets,
    'forbiddenTargets',
  )
  for (let index = 0; index < forbiddenTargets.length; index += 1)
    text(forbiddenTargets[index], `forbiddenTargets[${index}]`)
  for (let index = 1; index < forbiddenTargets.length; index += 1)
    if (
      compareCodeUnits(
        String(forbiddenTargets[index - 1]),
        String(forbiddenTargets[index]),
      ) >= 0
    )
      fail('forbiddenTargets must be unique and sorted')
  sha256(packet.packetDigest, 'semantic packet packetDigest')
  if (packet.packetDigest !== digestGameIrValue(packetBody(packet)))
    fail('semantic packet digest is stale or invalid')
  return packet
}

export function buildGameplaySemanticPacket(input: {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
}): GameIrDomainSemanticPacket {
  if (!isRecord(input)) fail('semantic packet input must be a plain object')
  exactKeys(input, ['source', 'mechanical'], 'semantic packet input')
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== 'gameplay') fail('source moduleId must be gameplay')
  const mechanical = admitGameIrMechanicalProjectionReceipt(
    source,
    input.mechanical,
  )
  return buildGameIrDomainSemanticPacket({
    source,
    mechanical,
    allowedNodeKinds: GAMEPLAY_NODE_KINDS,
    allowedRelationshipTypes: GAMEPLAY_RELATIONSHIP_TYPES,
  })
}

function receiptBody(
  receipt: Omit<GameIrDomainSemanticReceipt, 'receiptDigest'>,
): Omit<GameIrDomainSemanticReceipt, 'receiptDigest'> {
  return receipt
}

export function admitGameplaySemanticResult(
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
    nodes,
    validatedPacket.forbiddenTargets,
  )
  const admittedNodes = Object.freeze(
    nodes.map(node =>
      Object.freeze({ ...node, producerMode: 'semantic' as const }),
    ),
  )
  const body: Omit<GameIrDomainSemanticReceipt, 'receiptDigest'> = {
    schemaVersion: 'game-ir-domain-semantic-receipt.v1',
    taskId: validatedPacket.taskId,
    moduleId: 'gameplay',
    foundationRevision: validatedPacket.foundationRevision,
    sourceDigest: validatedPacket.sourceDigest,
    mechanicalReceiptDigest: validatedPacket.mechanicalReceiptDigest,
    packetDigest: validatedPacket.packetDigest,
    nodes: admittedNodes,
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
  if (receipt.schemaVersion !== 'game-ir-domain-semantic-receipt.v1')
    fail('semantic receipt schemaVersion is invalid')
  if (
    receipt.taskId !== packet.taskId ||
    receipt.moduleId !== 'gameplay' ||
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
      const node = normalizeNode(rawNode, index)
      return Object.freeze({ ...node, producerMode: 'semantic' as const })
    }),
  )
  for (let index = 1; index < nodes.length; index += 1)
    if (compareCodeUnits(nodes[index - 1]!.id, nodes[index]!.id) >= 0)
      fail('semantic receipt nodes must be canonical and uniquely sorted')
  const claims = normalizeClaims(
    receipt.sourceClaims,
    nodes,
    packet.forbiddenTargets,
  )
  const body: Omit<GameIrDomainSemanticReceipt, 'receiptDigest'> = {
    schemaVersion: receipt.schemaVersion,
    taskId: receipt.taskId,
    moduleId: 'gameplay',
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

function assembleInputKeys(input: Record<string, unknown>): void {
  exactKeys(
    input,
    Object.hasOwn(input, 'externalTargets')
      ? ['source', 'mechanical', 'semantic', 'externalTargets']
      : ['source', 'mechanical', 'semantic'],
    'assembler input',
  )
}

export function assembleGameplayModule(input: {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  semantic: GameIrDomainSemanticReceipt
  externalTargets?: ReadonlyMap<string, GameIrNode>
}): GameplayModuleProjection {
  if (!isRecord(input)) fail('assembler input must be a plain object')
  assembleInputKeys(input)
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== 'gameplay') fail('source moduleId must be gameplay')
  const mechanical = admitGameIrMechanicalProjectionReceipt(
    source,
    input.mechanical,
  )
  const packet = buildGameplaySemanticPacket({ source, mechanical })
  const semantic = validateSemanticReceipt(input.semantic, packet)
  const sourceSections = new Map(
    source.sectionIndex.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      section,
    ]),
  )
  const semanticTargetSet = semanticTargets(semantic.nodes)
  const claimsBySubject = new Map(
    semantic.sourceClaims.map(claim => [claim.subject, claim]),
  )
  const boundSemanticNodes = semantic.nodes.map(node => {
    const bindings: Record<string, unknown> = {}
    const pointers = [
      '/id',
      ...valueLeafPointers(node.value),
      ...node.references.map((_, index) => `/references/${index}`),
      ...node.edges.map((_, index) => `/edges/${index}`),
    ]
    for (const pointer of pointers) {
      const subject = `node:${node.id}#${pointer}`
      const claim = claimsBySubject.get(subject)
      if (!claim) fail(`semantic source claim is missing for ${subject}`)
      const section = sourceSections.get(
        `${claim.documentPath}#${claim.sectionId}`,
      )
      if (!section || claim.documentPath !== 'docs/GDD.md')
        fail(
          `semantic source claim lies outside exact Gameplay source sections`,
        )
      bindings[pointer] = {
        kind: 'owner',
        documentPath: claim.documentPath,
        sectionId: claim.sectionId,
        sectionDigest: section.digest,
        sourcePointer: claim.sourcePointer,
      }
    }
    return {
      ...node,
      producerMode: 'semantic' as const,
      bindings,
    }
  })
  const expectedClaimCount = semanticTargetSet.length
  if (claimsBySubject.size !== expectedClaimCount)
    fail('semantic source claims contain extra targets')
  assertDisjointDomainTargets(mechanical.ownedTargets, semanticTargetSet)
  const ids = new Set<string>()
  for (const node of mechanical.nodes) ids.add(node.id)
  for (const node of boundSemanticNodes) {
    if (ids.has(node.id))
      fail(`duplicate node ID across producer receipts: ${node.id}`)
    ids.add(node.id)
  }
  const mergedNodes = [...mechanical.nodes, ...boundSemanticNodes].sort(
    (left, right) => compareCodeUnits(left.id, right.id),
  )
  const coreAdmitted = parseGameIrModuleCandidate(
    { moduleId: 'gameplay', nodes: mergedNodes },
    {
      request: source.compileRequest,
      sections: source.authoritySectionIndex,
      expectedModuleId: 'gameplay',
    },
  )
  const module = parseGameplayModule(coreAdmitted, input.externalTargets)
  const projectionBody: Omit<GameplayModuleProjection, 'projectionDigest'> = {
    schemaVersion: 'game-ir-gameplay-module.v1',
    taskId: source.taskId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    module: module as GameIrModuleCandidate &
      Readonly<{ moduleId: 'gameplay' }>,
    mechanicalReceiptDigest: mechanical.receiptDigest,
    semanticReceiptDigest: semantic.receiptDigest,
  }
  return Object.freeze({
    ...projectionBody,
    projectionDigest: digestGameIrValue(projectionBody),
  })
}
