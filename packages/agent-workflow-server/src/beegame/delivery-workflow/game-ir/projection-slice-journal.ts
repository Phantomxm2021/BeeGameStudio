import Ajv from 'ajv'
import type { ValidateFunction } from 'ajv'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { durableWrite } from '../run-store'
import type { DeliveryRun, GameIrCompilationIdentity } from '../types'
import {
  GameIrStageCheckpointLoader,
  type GameIrProtocolStep,
} from './stage-checkpoint'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
  type GameIrReference,
  type GameIrRelationshipEdge,
  type GameIrNode,
} from './model'
import { parseGameplayProjectionNode } from './gameplay-schema'
import { parseBalanceProjectionNode } from './balance-schema'
import { parseWorldSceneProjectionNode } from './world-scene-schema'
import { parsePresentationProjectionNode } from './presentation-schema'
import { parseResourceRealizationProjectionNode } from './resource-realization-schema'
import { parseImplementationVerificationProjectionNode } from './implementation-verification-schema'
import { normalizeGameIrDomainSemanticPacket } from './domain-projection'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  deriveGameIrSemanticSourceClaims,
  sectionEvidencePointer,
  type GameIrSemanticCandidateNode,
  type GameIrSourceEvidenceGroup,
} from './semantic-fidelity'
import {
  buildGameIrProjectionContract,
  type GameIrProjectionContract,
} from './projection-contract'
import {
  admitGameIrSemanticObligationValidationResult,
  buildGameIrSemanticObligationValidationAuthority,
  normalizeGameIrSemanticObligationValidationReceipt,
  type GameIrSemanticObligationValidationAuthority,
  type GameIrSemanticObligationValidationReceipt,
  type GameIrSemanticObligationValidationResult,
} from './semantic-obligation-validation'
import type { GameIrSemanticObligationInventory } from './semantic-obligation-inventory'
import {
  buildGameIrProjectionSliceAdmissionJsonSchema,
  buildGameIrEvidenceFragmentCatalog,
  deriveProjectionSlicePlan,
  resolveGameIrEvidenceFragment,
  type GameIrProjectionSliceContext,
  type GameIrProjectionSlice,
  type GameIrProjectionSlicePlan,
  type GameIrProjectionRetryDiagnostic,
} from './projection-slices'
import type { GameIrProjectionNodeRecord } from './projection-record-stream'

export const GAME_IR_PROJECTION_SLICE_JOURNAL_SCHEMA_VERSION =
  'game-ir-projection-slice-journal.v3' as const

const SHA256 = /^[a-f0-9]{64}$/
const GENESIS_DIGEST = '0'.repeat(64)
const ajv = new Ajv({ allErrors: true, strict: true })
const sliceValidators = new Map<string, ValidateFunction>()

export type GameIrProjectionSliceNode = Readonly<{
  id: string
  kind: string
  value: Readonly<Record<string, unknown>>
  references: readonly GameIrReference[]
  edges: readonly GameIrRelationshipEdge[]
}>

export type GameIrProjectionSliceCompletion = Readonly<{
  status: 'completed'
  sliceId: string
  semantic: Readonly<{
    nodes: readonly GameIrProjectionSliceNode[]
    sourceEvidenceGroups: readonly Readonly<{
      nodeIds: readonly string[]
      fragmentId: string
    }>[]
  }>
}>

export type GameIrProjectionPendingSlice = Readonly<{
  sliceId: string
  predecessorDigest: string
  records: readonly Readonly<{
    fragmentId: string
    node: GameIrProjectionSliceNode
    recordDigest: string
  }>[]
  pendingDigest: string
}>

type GameIrProjectionSliceSemantic = Readonly<{
  nodes: readonly GameIrProjectionSliceNode[]
  sourceEvidenceGroups: readonly GameIrSourceEvidenceGroup[]
}>

/** The exact parsed shape shared by every canonical projection operation packet. */
export type GameIrProjectionOperationPacket = Readonly<{
  schemaVersion: string
  source: GameIrDomainSourceEnvelope
  semanticPacket: unknown
  projectionContract: GameIrProjectionContract
  dependencies: Readonly<Record<string, unknown>>
  packetDigest: string
}>

export type GameIrProjectionSliceJournalInput = Readonly<{
  journalPath: string
  identity: GameIrCompilationIdentity
  operationStep: GameIrProtocolStep
  packet: GameIrProjectionOperationPacket
  slicePlan: GameIrProjectionSlicePlan
}>

export type GameIrProjectionSlicePreflightDiagnostic = Readonly<
  Extract<GameIrSemanticObligationValidationResult, { outcome: 'FAIL' }>
>

export type GameIrProjectionSliceJournalPreflight = Readonly<{
  inventory: GameIrSemanticObligationInventory | null
  validationReceipt: GameIrSemanticObligationValidationReceipt | null
  diagnostic: GameIrProjectionSlicePreflightDiagnostic | null
}>

const PROJECTION_OPERATION_STEPS = new Set<GameIrProtocolStep>([
  'phase4/gameplay/projection',
  'phase4/balance/projection',
  'phase5/world-scene/projection',
  'phase5/presentation/projection',
  'phase6/resource-realization/projection',
  'phase7/implementation-verification/projection',
])

/**
 * Returns the sole service-owned staging path for one projection operation.
 * The filename is a digest, so neither run identity nor protocol text can
 * introduce path traversal or escape the private Game IR directory.
 */
export function gameIrProjectionSliceJournalPath(input: {
  workspacePath: string
  identity: GameIrCompilationIdentity
  operationStep: GameIrProtocolStep
}): string {
  if (!PROJECTION_OPERATION_STEPS.has(input.operationStep))
    throw new Error(
      'projection journal path requires an exact projection operation step',
    )
  const key = digestGameIrValue({
    identity: input.identity,
    operationStep: input.operationStep,
  })
  return resolve(
    input.workspacePath,
    '.beegame',
    '.game-ir-private',
    'projection-slices',
    `${key}.json`,
  )
}

export type GameIrProjectionSliceJournalEntry = Readonly<{
  sliceId: string
  predecessorDigest: string
  resultDigest: string
  semantic: GameIrProjectionSliceSemantic
  entryDigest: string
}>

export type GameIrProjectionSliceJournalSnapshot = Readonly<{
  schemaVersion: typeof GAME_IR_PROJECTION_SLICE_JOURNAL_SCHEMA_VERSION
  identity: GameIrCompilationIdentity
  operationStep: string
  operationPacketDigest: string
  slicePlan: GameIrProjectionSlicePlan
  slicePlanDigest: string
  preflight: GameIrProjectionSliceJournalPreflight
  retryDiagnostic: GameIrProjectionRetryDiagnostic | null
  entries: readonly GameIrProjectionSliceJournalEntry[]
  pendingSlice: GameIrProjectionPendingSlice | null
  journalDigest: string
}>

type PacketAuthority = Readonly<{
  packet: GameIrProjectionOperationPacket
  source: GameIrDomainSourceEnvelope
  semanticPacket: unknown
}>

type Authority = Readonly<PacketAuthority & {
  validation?: GameIrSemanticObligationValidationAuthority
}>

/**
 * Supplies the domain-owned targets needed for locally decidable node
 * semantics. Record admission may defer unknown targets; slice completion and
 * reload validate against the complete prior/current target boundary, while
 * graph-wide closure remains the final parser's responsibility.
 */
function knownTargets(
  authority: Authority,
  nodes: readonly GameIrProjectionSliceNode[],
): ReadonlyMap<string, GameIrNode> {
  const targets = new Map<string, GameIrNode>()
  for (const node of nodes) targets.set(node.id, node as unknown as GameIrNode)
  const addDescriptors = (value: unknown): void => {
    if (!Array.isArray(value)) return
    for (const candidate of value) {
      if (!isRecord(candidate)) continue
      if (typeof candidate.id !== 'string' || typeof candidate.kind !== 'string')
        continue
      const existing = targets.get(candidate.id)
      if (existing && existing.kind !== candidate.kind)
        fail(`known target ${candidate.id} has conflicting kinds`)
      if (!existing)
        targets.set(candidate.id, { id: candidate.id, kind: candidate.kind } as GameIrNode)
    }
  }
  if (isRecord(authority.packet.dependencies)) {
    for (const value of Object.values(authority.packet.dependencies))
      addDescriptors(value)
  }
  if (isRecord(authority.semanticPacket))
    addDescriptors(authority.semanticPacket.allowedPriorNodeTargets)
  if (isRecord(authority.semanticPacket) &&
      Array.isArray(authority.semanticPacket.presentationRequirements)) {
    addDescriptors(
      authority.semanticPacket.presentationRequirements.map(requirement =>
        isRecord(requirement) && typeof requirement.requirementId === 'string'
          ? {
              id: `resource.requirement.${requirement.requirementId}`,
              kind: 'resource-realization.logical-resource',
            }
          : requirement,
      ),
    )
  }
  return targets
}

function validateIntrinsicNodeSemantics(
  node: GameIrProjectionSliceNode,
  authority: Authority,
  priorNodes: readonly GameIrProjectionSliceNode[],
  allowUnknownTargets: boolean,
): void {
  const canonicalNode = node as unknown as GameIrNode
  const targets = knownTargets(authority, [...priorNodes, node])
  const options = { allowUnknownTargets }
  switch (authority.source.moduleId) {
    case 'gameplay':
      parseGameplayProjectionNode(canonicalNode, targets, options)
      return
    case 'balance':
      parseBalanceProjectionNode(canonicalNode, targets, options)
      return
    case 'world-scene':
      parseWorldSceneProjectionNode(canonicalNode, targets, options)
      return
    case 'presentation':
      parsePresentationProjectionNode(canonicalNode, targets, options)
      return
    case 'resource-realization':
      parseResourceRealizationProjectionNode(
        canonicalNode,
        {
          moduleId: 'resource-realization',
          nodes: [...priorNodes, node] as unknown as readonly GameIrNode[],
        },
        targets,
        { allowUnknownTargets },
      )
      return
    case 'implementation-verification':
      parseImplementationVerificationProjectionNode(canonicalNode, targets, {
        allowUnknownTargets,
      })
      return
  }
}

function fail(message: string): never {
  throw new Error(`invalid Game IR projection slice journal: ${message}`)
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

function sha256(value: unknown, label: string): string {
  const valueText = text(value, label)
  if (!SHA256.test(valueText)) fail(`${label} must be a SHA-256 digest`)
  return valueText
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function same(left: unknown, right: unknown): boolean {
  return canonicalGameIrJson(left) === canonicalGameIrJson(right)
}

function normalizeIdentity(value: unknown): GameIrCompilationIdentity {
  if (!isRecord(value)) fail('identity must be a plain object')
  exactKeys(
    value,
    [
      'runId',
      'taskId',
      'publicationId',
      'confirmedBriefDigest',
      'foundationRevision',
      'foundationReadyReceiptDigest',
    ],
    'identity',
  )
  const identity = {
    runId: text(value.runId, 'identity.runId'),
    taskId: text(value.taskId, 'identity.taskId'),
    publicationId: text(value.publicationId, 'identity.publicationId'),
    confirmedBriefDigest: sha256(
      value.confirmedBriefDigest,
      'identity.confirmedBriefDigest',
    ),
    foundationRevision: text(
      value.foundationRevision,
      'identity.foundationRevision',
    ),
    foundationReadyReceiptDigest: sha256(
      value.foundationReadyReceiptDigest,
      'identity.foundationReadyReceiptDigest',
    ),
  }
  return deepFreeze(identity)
}

function bindIdentity(
  identity: GameIrCompilationIdentity,
  authority: Authority,
): void {
  const foundation = authority.source.compileRequest.foundation
  if (
    identity.taskId !== authority.source.taskId ||
    identity.publicationId !== authority.source.compileRequest.publicationId ||
    identity.confirmedBriefDigest !== foundation.confirmedBriefDigest ||
    identity.foundationRevision !== foundation.foundationRevision ||
    identity.foundationReadyReceiptDigest !== foundation.receiptDigest
  )
    fail(
      'compilation identity is detached from the canonical operation packet source',
    )
}

function bindProjectionStep(
  operationStep: string,
  planModuleId: GameIrProjectionSlicePlan['moduleId'],
  packetModuleId: GameIrDomainSourceEnvelope['moduleId'],
): GameIrProtocolStep {
  const expected = [...PROJECTION_OPERATION_STEPS].find(
    step => step.split('/')[1] === planModuleId,
  )
  if (planModuleId !== packetModuleId || operationStep !== expected)
    fail(
      'operation step is not the exact projection step for the packet and slice plan module',
    )
  return operationStep as GameIrProtocolStep
}

function normalizePlan(value: unknown): GameIrProjectionSlicePlan {
  if (!isRecord(value)) fail('slicePlan must be a plain object')
  if (typeof value.moduleId !== 'string' || !Array.isArray(value.slices))
    fail('slicePlan is invalid')
  let canonical: GameIrProjectionSlicePlan
  try {
    canonical = deriveProjectionSlicePlan(value.moduleId as never)
  } catch {
    fail('slicePlan module is invalid')
  }
  if (!same(value, canonical)) fail('slicePlan is stale or forged')
  return clone(canonical)
}

function normalizePacket(value: unknown): PacketAuthority {
  if (!isRecord(value)) fail('operation packet must be a plain object')
  exactKeys(
    value,
    [
      'schemaVersion',
      'source',
      'semanticPacket',
      'projectionContract',
      'dependencies',
      'packetDigest',
    ],
    'operation packet',
  )
  const source = validateGameIrDomainSourceEnvelope(value.source)
  const expectedSchema = `game-ir-${source.moduleId}-projection-operation-packet.v1`
  if (value.schemaVersion !== expectedSchema)
    fail('operation packet schemaVersion is invalid')
  if (!isRecord(value.semanticPacket))
    fail('operation packet semanticPacket must be a plain object')
  const candidate = value.semanticPacket as Record<string, unknown>
  let semanticPacket: unknown
  if (source.moduleId === 'resource-realization') {
    exactKeys(
      candidate,
      [
        'schemaVersion',
        'taskId',
        'moduleId',
        'foundationRevision',
        'sourceDigest',
        'mechanicalReceiptDigest',
        'presentationRequirements',
        'presentationRequirementsDigest',
        'allowedPriorNodeTargets',
        'sourceSections',
        'allowedNodeKinds',
        'allowedRelationshipTypes',
        'forbiddenPresentationRequirementIds',
        'forbiddenTargets',
        'packetDigest',
      ],
      'resource-realization semantic packet',
    )
    if (
      candidate.schemaVersion !==
      'game-ir-resource-realization-semantic-projection-packet.v1'
    )
      fail('resource-realization semantic packet schemaVersion is invalid')
    if (
      candidate.taskId !== source.taskId ||
      candidate.moduleId !== source.moduleId ||
      candidate.foundationRevision !==
        source.compileRequest.foundation.foundationRevision ||
      candidate.sourceDigest !== source.sourceDigest
    )
      fail('operation packet semantic packet is detached from source')
    sha256(
      candidate.packetDigest,
      'operation packet semanticPacket.packetDigest',
    )
    const { packetDigest: _packetDigest, ...body } = candidate
    if (candidate.packetDigest !== digestGameIrValue(body))
      fail('resource-realization semantic packet digest is stale or invalid')
    semanticPacket = clone(candidate)
  } else {
    semanticPacket = normalizeGameIrDomainSemanticPacket(candidate, {
      errorPrefix: 'invalid Game IR projection operation packet',
      allowedModuleIds: [source.moduleId],
    })
  }
  if (
    !isRecord(semanticPacket) ||
    semanticPacket.taskId !== source.taskId ||
    semanticPacket.moduleId !== source.moduleId ||
    semanticPacket.foundationRevision !==
      source.compileRequest.foundation.foundationRevision ||
    semanticPacket.sourceDigest !== source.sourceDigest
  )
    fail('operation packet semantic packet is detached from source')
  const contract = buildGameIrProjectionContract(source.moduleId)
  if (!same(value.projectionContract, contract))
    fail('operation packet projection contract is forged')
  if (!isRecord(value.dependencies))
    fail('operation packet dependencies must be a plain object')
  const expectedKinds = contract.nodes.map(node => node.kind)
  const expectedRelationships = [
    ...new Set(contract.relationships.map(relationship => relationship.role)),
  ].sort(compareCodeUnits)
  const expectedEvidence = source.sectionIndex
    .map(sectionEvidencePointer)
    .sort(compareCodeUnits)
  if (
    source.moduleId !== 'resource-realization' &&
    (!same(semanticPacket.allowedNodeKinds, expectedKinds) ||
      !same(semanticPacket.allowedRelationshipTypes, expectedRelationships) ||
      !same(semanticPacket.allowedEvidencePointers, expectedEvidence))
  )
    fail('operation packet semantic scope is not canonical')
  const body = {
    schemaVersion: expectedSchema,
    source,
    semanticPacket,
    projectionContract: contract,
    dependencies: clone(value.dependencies),
  }
  const packetDigest = sha256(
    value.packetDigest,
    'operation packet packetDigest',
  )
  if (packetDigest !== digestGameIrValue(body))
    fail('operation packet digest is stale or invalid')
  const packet = deepFreeze({ ...body, packetDigest })
  return { packet, source, semanticPacket }
}

function validationFor(
  source: GameIrDomainSourceEnvelope,
  inventory: GameIrSemanticObligationInventory,
): GameIrSemanticObligationValidationAuthority {
  return buildGameIrSemanticObligationValidationAuthority({ source, inventory })
}

function requireValidation(authority: Authority): GameIrSemanticObligationValidationAuthority {
  if (!authority.validation)
    fail('projection requires an admitted obligation validation PASS receipt')
  return authority.validation
}

function normalizeGroups(
  value: unknown,
  authority: GameIrDomainSourceEnvelope,
): readonly GameIrSourceEvidenceGroup[] {
  if (!Array.isArray(value)) fail('sourceEvidenceGroups must be an array')
  const catalog = buildGameIrEvidenceFragmentCatalog({
    sectionIndex: authority.sectionIndex,
    sectionBytes: authority.sectionBytes,
  })
  let previousGroupKey: string | undefined
  const groups = value.map((raw, index) => {
    if (!isRecord(raw))
      fail(`sourceEvidenceGroups[${index}] must be a plain object`)
    exactKeys(raw, ['nodeIds', 'fragmentId'], `sourceEvidenceGroups[${index}]`)
    if (
      !Array.isArray(raw.nodeIds) ||
      raw.nodeIds.length === 0 ||
      raw.nodeIds.some(
        nodeId => typeof nodeId !== 'string' || nodeId.trim().length === 0,
      )
    )
      fail(`sourceEvidenceGroups[${index}].nodeIds is invalid`)
    const fragmentId = text(
      raw.fragmentId,
      `sourceEvidenceGroups[${index}].fragmentId`,
    )
    let fragment
    try {
      fragment = resolveGameIrEvidenceFragment(catalog, fragmentId)
    } catch {
      fail(`sourceEvidenceGroups[${index}].fragmentId is outside authority`)
    }
    const nodeIds = raw.nodeIds as string[]
    const sortedNodeIds = [...nodeIds].sort(compareCodeUnits)
    if (
      sortedNodeIds.some(
        (nodeId, nodeIndex) =>
          nodeId !== nodeIds[nodeIndex] ||
          (nodeIndex > 0 && nodeId === sortedNodeIds[nodeIndex - 1]),
      )
    )
      fail(`sourceEvidenceGroups[${index}].nodeIds must be unique and sorted`)
    const groupKey = `${fragmentId}\0${nodeIds.join('\0')}`
    if (
      previousGroupKey !== undefined &&
      compareCodeUnits(previousGroupKey, groupKey) >= 0
    )
      fail('sourceEvidenceGroups must be unique and sorted')
    previousGroupKey = groupKey
    return {
      subjects: nodeIds.map(nodeId => `node:${nodeId}#/`),
      documentPath: fragment.documentPath,
      sectionId: fragment.sectionId,
      excerpt: fragment.excerpt,
    }
  })
  return groups.sort((left, right) =>
    compareCodeUnits(
      `${left.documentPath}\0${left.sectionId}\0${left.excerpt}\0${left.subjects.join('\0')}`,
      `${right.documentPath}\0${right.sectionId}\0${right.excerpt}\0${right.subjects.join('\0')}`,
    ),
  )
}

function normalizePersistedGroups(
  value: unknown,
): readonly GameIrSourceEvidenceGroup[] {
  if (!Array.isArray(value))
    fail('persisted sourceEvidenceGroups must be an array')
  const groups = value.map((raw, index) => {
    if (!isRecord(raw))
      fail(`persisted sourceEvidenceGroups[${index}] must be a plain object`)
    exactKeys(
      raw,
      ['subjects', 'documentPath', 'sectionId', 'excerpt'],
      `persisted sourceEvidenceGroups[${index}]`,
    )
    if (
      !Array.isArray(raw.subjects) ||
      raw.subjects.length === 0 ||
      raw.subjects.some(
        subject => typeof subject !== 'string' || subject.trim().length === 0,
      )
    )
      fail(`persisted sourceEvidenceGroups[${index}].subjects is invalid`)
    const subjects = raw.subjects as string[]
    const sortedSubjects = [...subjects].sort(compareCodeUnits)
    if (
      sortedSubjects.some(
        (subject, subjectIndex) =>
          subject !== subjects[subjectIndex] ||
          (subjectIndex > 0 && subject === sortedSubjects[subjectIndex - 1]),
      )
    )
      fail(
        `persisted sourceEvidenceGroups[${index}].subjects must be unique and sorted`,
      )
    return {
      subjects: [...subjects],
      documentPath: text(
        raw.documentPath,
        `persisted sourceEvidenceGroups[${index}].documentPath`,
      ) as GameIrSourceEvidenceGroup['documentPath'],
      sectionId: text(
        raw.sectionId,
        `persisted sourceEvidenceGroups[${index}].sectionId`,
      ),
      excerpt: text(
        raw.excerpt,
        `persisted sourceEvidenceGroups[${index}].excerpt`,
      ),
    }
  })
  const sorted = [...groups].sort((left, right) =>
    compareCodeUnits(
      `${left.documentPath}\0${left.sectionId}\0${left.excerpt}\0${left.subjects.join('\0')}`,
      `${right.documentPath}\0${right.sectionId}\0${right.excerpt}\0${right.subjects.join('\0')}`,
    ),
  )
  if (sorted.some((group, index) => group !== groups[index]))
    fail('persisted sourceEvidenceGroups must be sorted')
  return groups
}

type NormalizedSemantic = Readonly<{
  semantic: GameIrProjectionSliceSemantic
  evidenceSubjects: readonly string[]
}>

function nodeTargetKey(target: { id: string; kind: string }): string {
  return `${target.id}\0${target.kind}`
}

function serviceOwnedTargetIds(authority: Authority): ReadonlySet<string> {
  if (!isRecord(authority.semanticPacket)) return new Set()
  const raw = authority.semanticPacket.forbiddenTargets
  if (!Array.isArray(raw)) return new Set()
  return new Set(
    raw.filter(
      (target): target is string =>
        typeof target === 'string' && !target.startsWith('node:'),
    ),
  )
}

function admitCanonicalNodeCollections(
  value: readonly GameIrProjectionSliceNode[],
): readonly GameIrProjectionSliceNode[] {
  const nodes = value.map(node => {
    const references = [...node.references].sort((left, right) =>
      compareCodeUnits(
        `${left.targetId}\0${left.targetType}`,
        `${right.targetId}\0${right.targetType}`,
      ),
    )
    for (let index = 1; index < references.length; index += 1)
      if (
        references[index - 1]!.targetId === references[index]!.targetId &&
        references[index - 1]!.targetType === references[index]!.targetType
      )
        fail(`node ${node.id} contains duplicate references`)
    const edges = [...node.edges].sort((left, right) =>
      compareCodeUnits(
        `${left.type}\0${left.targetId}\0${left.targetType}`,
        `${right.type}\0${right.targetId}\0${right.targetType}`,
      ),
    )
    for (let index = 1; index < edges.length; index += 1)
      if (
        edges[index - 1]!.type === edges[index]!.type &&
        edges[index - 1]!.targetId === edges[index]!.targetId &&
        edges[index - 1]!.targetType === edges[index]!.targetType
      )
        fail(`node ${node.id} contains duplicate edges`)
    if (!same(node.references, references) || !same(node.edges, edges))
      fail(`node ${node.id} collections must be unique and sorted`)
    return Object.freeze({
      ...node,
      references: Object.freeze([...node.references]),
      edges: Object.freeze([...node.edges]),
    })
  })
  const sortedNodes = [...nodes].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  )
  if (sortedNodes.some((node, index) => node !== nodes[index]))
    fail('slice nodes must be sorted by id')
  for (let index = 1; index < nodes.length; index += 1)
    if (nodes[index - 1]!.id === nodes[index]!.id)
      fail(`slice contains duplicate node ID ${nodes[index]!.id}`)
  return Object.freeze(nodes)
}

function sliceContext(
  entries: readonly GameIrProjectionSliceJournalEntry[],
  slice: GameIrProjectionSlice | undefined,
  authority: Authority,
  pendingSlice: GameIrProjectionPendingSlice | null = null,
): GameIrProjectionSliceContext {
  if (!slice)
    return Object.freeze({
      availablePriorNodes: Object.freeze([]),
      requiredCurrentNodes: Object.freeze([]),
      admittedCurrentNodes: Object.freeze([]),
    })
  const currentKinds = new Set(slice.nodeKinds)
  const priorNodes = entries.flatMap(entry => entry.semantic.nodes)
  const required = requireValidation(authority).inventory.obligations
    .filter(obligation => obligation.ownerSliceId === slice.sliceId)
    .map(obligation => ({ id: obligation.targetId, kind: obligation.targetKind }))
    .filter(target => currentKinds.has(target.kind))
  const availablePriorNodes = priorNodes
    .map(node => ({ id: node.id, kind: node.kind, value: node.value }))
    .sort((left, right) =>
      compareCodeUnits(nodeTargetKey(left), nodeTargetKey(right)),
    )
  const requiredCurrentNodes = [...required.values()].sort((left, right) =>
    compareCodeUnits(nodeTargetKey(left), nodeTargetKey(right)),
  )
  const admittedCurrentNodes = (pendingSlice?.records ?? [])
    .map(record => ({ id: record.node.id, kind: record.node.kind }))
    .sort((left, right) =>
      compareCodeUnits(nodeTargetKey(left), nodeTargetKey(right)),
    )
  return deepFreeze({
    availablePriorNodes,
    requiredCurrentNodes,
    admittedCurrentNodes,
  })
}

function assertObligationCoverage(
  entries: readonly GameIrProjectionSliceJournalEntry[],
  slice: GameIrProjectionSlice,
  nodes: readonly GameIrProjectionSliceNode[],
  authority: Authority,
  sourceEvidenceGroups: readonly GameIrSourceEvidenceGroup[],
): void {
  const obligations = requireValidation(authority).inventory.obligations.filter(
    obligation => obligation.ownerSliceId === slice.sliceId,
  )
  const byId = new Map(obligations.map(obligation => [obligation.targetId, obligation]))
  const actual = new Map<string, GameIrProjectionSliceNode>()
  for (const node of nodes) {
    const obligation = byId.get(node.id)
    if (!obligation)
      fail(`slice ${slice.sliceId} contains undeclared node ${node.id}`)
    if (obligation.targetKind !== node.kind)
      fail(
        `slice ${slice.sliceId} node ${node.id} has wrong kind ${node.kind}; expected ${obligation.targetKind}`,
      )
    if (actual.has(node.id)) fail(`slice ${slice.sliceId} contains duplicate obligation ${node.id}`)
    actual.set(node.id, node)
  }
  if (actual.size !== obligations.length)
    fail(`slice ${slice.sliceId} does not cover every admitted obligation`)

  const catalog = buildGameIrEvidenceFragmentCatalog({
    sectionIndex: authority.source.sectionIndex,
    sectionBytes: authority.source.sectionBytes,
  })
  const fragmentsByNode = new Map<string, string>()
  for (const group of sourceEvidenceGroups) {
    const fragment = catalog.fragments.find(
      candidate =>
        candidate.documentPath === group.documentPath &&
        candidate.sectionId === group.sectionId &&
        candidate.excerpt === group.excerpt,
    )
    if (!fragment) fail(`slice ${slice.sliceId} evidence fragment is outside authority`)
    for (const subject of group.subjects) {
      const match = /^node:(.+)#\/$/u.exec(subject)
      if (match) {
        if (fragmentsByNode.has(match[1]!))
          fail(`slice ${slice.sliceId} has duplicate evidence for ${match[1]}`)
        fragmentsByNode.set(match[1]!, fragment.fragmentId)
      }
    }
  }
  for (const obligation of obligations) {
    if (fragmentsByNode.get(obligation.targetId) !== obligation.fragmentId)
      fail(
        `slice ${slice.sliceId} evidence for ${obligation.targetId} is not bound to ${obligation.fragmentId}`,
      )
  }
}

function assertRelationshipCardinality(
  slice: GameIrProjectionSlice,
  nodes: readonly GameIrProjectionSliceNode[],
): void {
  const contracts = new Map(slice.nodes.map(node => [node.kind, node]))
  for (const node of nodes) {
    const contract = contracts.get(node.kind)
    if (!contract) fail(`node ${node.id} kind is outside its slice`)
    for (const relationship of contract.relationships) {
      const count = node.edges.filter(
        edge => edge.type === relationship.role,
      ).length
      if (relationship.required && count === 0)
        fail(
          `node ${node.id} is missing required relationship ${relationship.role}`,
        )
      if (relationship.singleton && count > 1)
        fail(
          `node ${node.id} exceeds singleton relationship ${relationship.role}`,
        )
    }
  }
}

function assertLocalTargetClosure(
  entries: readonly GameIrProjectionSliceJournalEntry[],
  plan: GameIrProjectionSlicePlan,
  slice: GameIrProjectionSlice,
  nodes: readonly GameIrProjectionSliceNode[],
  authority: Authority,
): void {
  const kindIndex = new Map(
    plan.slices.flatMap((candidate, index) =>
      candidate.nodeKinds.map(kind => [kind, index] as const),
    ),
  )
  const currentIndex = plan.slices.findIndex(
    candidate => candidate.sliceId === slice.sliceId,
  )
  const admitted = new Map(
    entries.flatMap(entry =>
      entry.semantic.nodes.map(node => [node.id, node.kind] as const),
    ),
  )
  const current = new Map(nodes.map(node => [node.id, node.kind] as const))
  const serviceOwned = serviceOwnedTargetIds(authority)
  for (const node of nodes) {
    for (const target of [...node.references, ...node.edges]) {
      const targetIndex = kindIndex.get(target.targetType)
      if (
        targetIndex === undefined ||
        targetIndex > currentIndex ||
        serviceOwned.has(target.targetId)
      )
        continue
      const actualKind =
        targetIndex < currentIndex
          ? admitted.get(target.targetId)
          : current.get(target.targetId)
      if (actualKind !== target.targetType)
        fail(
          `node ${node.id} has unresolved local target ${target.targetId} (${target.targetType})`,
        )
    }
  }
}

function normalizeCompletion(
  value: unknown,
  slice: GameIrProjectionSlice,
  authority: Authority,
  priorNodes: readonly GameIrProjectionSliceNode[],
): NormalizedSemantic {
  if (!isRecord(value)) fail('slice completion must be a plain object')
  exactKeys(value, ['status', 'sliceId', 'semantic'], 'slice completion')
  if (
    value.status !== 'completed' ||
    value.sliceId !== slice.sliceId ||
    !isRecord(value.semantic)
  )
    fail('slice completion identity is stale or relabeled')
  exactKeys(value.semantic, ['nodes', 'sourceEvidenceGroups'], 'slice semantic')
  const candidate = {
    status: 'completed',
    sliceId: slice.sliceId,
    semantic: {
      nodes: value.semantic.nodes,
      sourceEvidenceGroups: value.semantic.sourceEvidenceGroups,
    },
  }
  const validatorKey = `${authority.source.moduleId}\0${slice.sliceId}`
  let validate = sliceValidators.get(validatorKey)
  if (!validate) {
    validate = ajv.compile(
      buildGameIrProjectionSliceAdmissionJsonSchema(
        authority.source.moduleId,
        slice,
      ),
    )
    sliceValidators.set(validatorKey, validate)
  }
  if (!validate(candidate))
    fail(`slice schema is invalid: ${ajv.errorsText(validate.errors)}`)
  if (!Array.isArray(candidate.semantic.nodes))
    fail('slice nodes must be an array')
  const nodes = admitCanonicalNodeCollections(
    clone(candidate.semantic.nodes) as GameIrProjectionSliceNode[],
  )
  for (const node of nodes)
    validateIntrinsicNodeSemantics(node, authority, [...priorNodes, ...nodes], false)
  const sourceEvidenceGroups = normalizeGroups(
    candidate.semantic.sourceEvidenceGroups,
    authority.source,
  )
  const sourceClaims = deriveGameIrSemanticSourceClaims(
    {
      sectionIndex: authority.source.sectionIndex,
      sectionBytes: authority.source.sectionBytes,
    },
    nodes as readonly GameIrSemanticCandidateNode[],
    sourceEvidenceGroups,
    'invalid Game IR projection slice source evidence',
  )
  return {
    semantic: deepFreeze({
      nodes: Object.freeze(nodes),
      sourceEvidenceGroups: Object.freeze(clone(sourceEvidenceGroups)),
    }),
    evidenceSubjects: Object.freeze(sourceClaims.map(claim => claim.subject)),
  }
}

function normalizePersistedSemantic(
  value: unknown,
  slice: GameIrProjectionSlice,
  authority: Authority,
  priorNodes: readonly GameIrProjectionSliceNode[],
): NormalizedSemantic {
  if (!isRecord(value)) fail('persisted slice semantic must be a plain object')
  exactKeys(
    value,
    ['nodes', 'sourceEvidenceGroups'],
    'persisted slice semantic',
  )
  const validatorKey = `${authority.source.moduleId}\0${slice.sliceId}`
  let validate = sliceValidators.get(validatorKey)
  if (!validate) {
    validate = ajv.compile(
      buildGameIrProjectionSliceAdmissionJsonSchema(
        authority.source.moduleId,
        slice,
      ),
    )
    sliceValidators.set(validatorKey, validate)
  }
  const nodeCandidate = {
    status: 'completed',
    sliceId: slice.sliceId,
    semantic: { nodes: value.nodes, sourceEvidenceGroups: [] },
  }
  if (!validate(nodeCandidate))
    fail(
      `persisted slice node schema is invalid: ${ajv.errorsText(validate.errors)}`,
    )
  const nodes = admitCanonicalNodeCollections(
    clone(value.nodes as readonly GameIrProjectionSliceNode[]),
  )
  for (const node of nodes)
    validateIntrinsicNodeSemantics(node, authority, [...priorNodes, ...nodes], false)
  const sourceEvidenceGroups = normalizePersistedGroups(
    value.sourceEvidenceGroups,
  )
  const sourceClaims = deriveGameIrSemanticSourceClaims(
    {
      sectionIndex: authority.source.sectionIndex,
      sectionBytes: authority.source.sectionBytes,
    },
    nodes,
    sourceEvidenceGroups,
    'invalid persisted Game IR projection slice source evidence',
  )
  return {
    semantic: deepFreeze({
      nodes: Object.freeze(nodes),
      sourceEvidenceGroups: Object.freeze(sourceEvidenceGroups),
    }),
    evidenceSubjects: Object.freeze(sourceClaims.map(claim => claim.subject)),
  }
}

function normalizeRecordNode(
  record: GameIrProjectionNodeRecord,
  slice: GameIrProjectionSlice,
  authority: Authority,
  priorNodes: readonly GameIrProjectionSliceNode[],
): GameIrProjectionNodeRecord {
  const fragmentId = text(record.fragmentId, 'record fragmentId')
  try {
    resolveGameIrEvidenceFragment(
      buildGameIrEvidenceFragmentCatalog({
        sectionIndex: authority.source.sectionIndex,
        sectionBytes: authority.source.sectionBytes,
      }),
      fragmentId,
    )
  } catch {
    fail(`record ${record.node?.id ?? '<unknown>'} fragmentId is outside authority`)
  }
  const candidate = {
    status: 'completed',
    sliceId: slice.sliceId,
    semantic: { nodes: [record.node], sourceEvidenceGroups: [] },
  }
  const validatorKey = `${authority.source.moduleId}\0${slice.sliceId}`
  let validate = sliceValidators.get(validatorKey)
  if (!validate) {
    validate = ajv.compile(
      buildGameIrProjectionSliceAdmissionJsonSchema(
        authority.source.moduleId,
        slice,
      ),
    )
    sliceValidators.set(validatorKey, validate)
  }
  if (!validate(candidate))
    fail(
      `record node is outside the slice schema: ${ajv.errorsText(validate.errors)}`,
    )
  const node = admitCanonicalNodeCollections(
    clone([record.node]) as GameIrProjectionSliceNode[],
  )[0]!
  validateIntrinsicNodeSemantics(node, authority, priorNodes, true)
  return Object.freeze({ fragmentId, node })
}

function planDigest(plan: GameIrProjectionSlicePlan): string {
  return digestGameIrValue(plan)
}

function entryBody(
  entry: Omit<GameIrProjectionSliceJournalEntry, 'entryDigest'>,
): Omit<GameIrProjectionSliceJournalEntry, 'entryDigest'> {
  return entry
}

function snapshotBody(
  snapshot: Omit<GameIrProjectionSliceJournalSnapshot, 'journalDigest'>,
): Omit<GameIrProjectionSliceJournalSnapshot, 'journalDigest'> {
  return snapshot
}

function pendingBody(
  pending: Omit<GameIrProjectionPendingSlice, 'pendingDigest'>,
): Omit<GameIrProjectionPendingSlice, 'pendingDigest'> {
  return pending
}

function pendingDigest(
  pending: Omit<GameIrProjectionPendingSlice, 'pendingDigest'>,
): string {
  return digestGameIrValue(pendingBody(pending))
}

function normalizeRetryDiagnostic(
  value: unknown,
  entries: readonly GameIrProjectionSliceJournalEntry[],
  slicePlan: GameIrProjectionSlicePlan,
  authority: Authority,
): GameIrProjectionRetryDiagnostic | null {
  if (value === null) return null
  if (!isRecord(value)) fail('journal retryDiagnostic must be an object or null')
  if (value.scope === 'slice') {
    exactKeys(value, ['scope', 'sliceId', 'reason'], 'journal retryDiagnostic')
    const sliceId = text(value.sliceId, 'journal retryDiagnostic.sliceId')
    if (!slicePlan.slices.some(slice => slice.sliceId === sliceId))
      fail('journal retryDiagnostic slice is outside the slice plan')
    const currentSlice = slicePlan.slices[entries.length]?.sliceId
    const persistedEntry = entries.some(entry => entry.sliceId === sliceId)
    if (sliceId !== currentSlice && !persistedEntry)
      fail('journal retryDiagnostic slice is detached from the journal cursor')
    return deepFreeze({
      scope: 'slice',
      sliceId,
      reason: text(value.reason, 'journal retryDiagnostic.reason'),
    })
  }
  if (value.scope === 'record') {
    exactKeys(
      value,
      ['scope', 'sliceId', 'recordId', 'fragmentId', 'reason'],
      'journal retryDiagnostic',
    )
    const sliceId = text(value.sliceId, 'journal retryDiagnostic.sliceId')
    const recordId = text(value.recordId, 'journal retryDiagnostic.recordId')
    const fragmentId = text(value.fragmentId, 'journal retryDiagnostic.fragmentId')
    try {
      resolveGameIrEvidenceFragment(
        buildGameIrEvidenceFragmentCatalog({
          sectionIndex: authority.source.sectionIndex,
          sectionBytes: authority.source.sectionBytes,
        }),
        fragmentId,
      )
    } catch {
      fail('journal retryDiagnostic fragment is outside source authority')
    }
    if (!slicePlan.slices.some(slice => slice.sliceId === sliceId))
      fail('journal retryDiagnostic slice is outside the slice plan')
    const currentSlice = slicePlan.slices[entries.length]?.sliceId
    const persistedEntry = entries.find(entry => entry.sliceId === sliceId)
    if (sliceId !== currentSlice && !persistedEntry)
      fail('journal retryDiagnostic slice is detached from the journal cursor')
    if (
      persistedEntry &&
      !persistedEntry.semantic.nodes.some(node => node.id === recordId)
    )
      fail('journal retryDiagnostic record is detached from its slice')
    return deepFreeze({
      scope: 'record',
      sliceId,
      recordId,
      fragmentId,
      reason: text(value.reason, 'journal retryDiagnostic.reason'),
    })
  }
  fail('journal retryDiagnostic scope is invalid')
}

export type GameIrProjectionSliceRollbackInput = Readonly<{
  ownerSliceId: string
  obligationId: string
  fragmentId: string
  recordId?: string
  diagnosticDigest?: string
  expectedJournalDigest?: string
}>

function normalizePendingSlice(
  value: unknown,
  entries: readonly GameIrProjectionSliceJournalEntry[],
  slicePlan: GameIrProjectionSlicePlan,
  authority: Authority,
): GameIrProjectionPendingSlice | null {
  if (value === null) return null
  if (!isRecord(value)) fail('pendingSlice must be a plain object or null')
  exactKeys(
    value,
    ['sliceId', 'predecessorDigest', 'records', 'pendingDigest'],
    'pendingSlice',
  )
  const slice = slicePlan.slices[entries.length]
  if (!slice) fail('pendingSlice exists after every slice is admitted')
  const sliceId = text(value.sliceId, 'pendingSlice.sliceId')
  if (sliceId !== slice.sliceId) fail('pendingSlice slice identity is stale')
  const predecessorDigest = sha256(
    value.predecessorDigest,
    'pendingSlice.predecessorDigest',
  )
  const expectedPredecessor = entries.at(-1)?.entryDigest ?? GENESIS_DIGEST
  if (predecessorDigest !== expectedPredecessor)
    fail('pendingSlice predecessor chain is invalid')
  if (!Array.isArray(value.records)) fail('pendingSlice.records must be an array')
  const rawRecords = value.records as readonly unknown[]
  const nodeIds = new Set(
    entries.flatMap(entry => entry.semantic.nodes.map(node => node.id)),
  )
  let previousId: string | undefined
  const records = rawRecords.map((raw, index) => {
    if (!isRecord(raw)) fail(`pendingSlice.records[${index}] is invalid`)
    exactKeys(
      raw,
      ['fragmentId', 'node', 'recordDigest'],
      `pendingSlice.records[${index}]`,
    )
    const normalized = normalizeRecordNode(
      {
        fragmentId: raw.fragmentId as string,
        node: raw.node as GameIrProjectionSliceNode,
      },
      slice,
      authority,
      [
        ...entries.flatMap(entry => entry.semantic.nodes),
        ...rawRecords
          .slice(0, index)
          .map(candidate => (candidate as Record<string, unknown>).node as GameIrProjectionSliceNode),
      ],
    )
    if (
      previousId !== undefined &&
      compareCodeUnits(previousId, normalized.node.id) >= 0
    )
      fail('pendingSlice records must have strictly increasing node IDs')
    previousId = normalized.node.id
    if (nodeIds.has(normalized.node.id))
      fail(`journal contains cross-slice duplicate node ID ${normalized.node.id}`)
    nodeIds.add(normalized.node.id)
    const body = {
      fragmentId: normalized.fragmentId,
      node: normalized.node,
    }
    const recordDigest = sha256(
      raw.recordDigest,
      `pendingSlice.records[${index}].recordDigest`,
    )
    if (recordDigest !== digestGameIrValue(body))
      fail(`pendingSlice.records[${index}] digest mismatch`)
    return deepFreeze({ ...body, recordDigest })
  })
  const body = { sliceId, predecessorDigest, records: Object.freeze(records) }
  const digest = sha256(value.pendingDigest, 'pendingSlice.pendingDigest')
  if (digest !== pendingDigest(body)) fail('pendingSlice digest mismatch')
  return deepFreeze({ ...body, pendingDigest: digest })
}

function normalizePreflightDiagnostic(
  value: unknown,
): GameIrProjectionSlicePreflightDiagnostic | null {
  if (value === null) return null
  if (!isRecord(value)) fail('preflight diagnostic must be an object or null')
  exactKeys(
    value,
    [
      'outcome',
      'reasonCode',
      'targetId',
      'expectedKind',
      'semanticRole',
      'fragmentId',
      'obligationId',
      'ownerSliceId',
      'evidence',
    ],
    'preflight diagnostic',
  )
  if (value.outcome !== 'FAIL' || value.reasonCode !== 'missing-obligation')
    fail('preflight diagnostic must be a missing-obligation failure')
  return deepFreeze({
    outcome: 'FAIL',
    reasonCode: 'missing-obligation',
    targetId: text(value.targetId, 'preflight diagnostic.targetId'),
    expectedKind: text(value.expectedKind, 'preflight diagnostic.expectedKind'),
    semanticRole: text(value.semanticRole, 'preflight diagnostic.semanticRole'),
    fragmentId: text(value.fragmentId, 'preflight diagnostic.fragmentId'),
    obligationId: text(value.obligationId, 'preflight diagnostic.obligationId'),
    ownerSliceId: text(value.ownerSliceId, 'preflight diagnostic.ownerSliceId'),
    evidence: clone(value.evidence) as GameIrProjectionSlicePreflightDiagnostic['evidence'],
  })
}

function normalizePersistedPreflight(
  value: unknown,
  source: GameIrDomainSourceEnvelope,
): {
  preflight: GameIrProjectionSliceJournalPreflight
  validation?: GameIrSemanticObligationValidationAuthority
} {
  if (!isRecord(value)) fail('journal preflight must be a plain object')
  exactKeys(value, ['inventory', 'validationReceipt', 'diagnostic'], 'journal preflight')
  const diagnostic = normalizePreflightDiagnostic(value.diagnostic)
  if (value.inventory === null) {
    if (value.validationReceipt !== null)
      fail('journal validation receipt requires a persisted inventory')
    return {
      preflight: deepFreeze({ inventory: null, validationReceipt: null, diagnostic }),
    }
  }
  const validation = validationFor(
    source,
    value.inventory as GameIrSemanticObligationInventory,
  )
  const inventory = validation.inventory
  const validationReceipt =
    value.validationReceipt === null
      ? null
      : normalizeGameIrSemanticObligationValidationReceipt(
          validation,
          value.validationReceipt,
        )
  return {
    preflight: deepFreeze({ inventory, validationReceipt, diagnostic }),
    ...(validationReceipt ? { validation } : {}),
  }
}

function normalizeSnapshot(
  value: unknown,
  input: GameIrProjectionSliceJournalInput,
  authority: Authority,
): GameIrProjectionSliceJournalSnapshot {
  if (!isRecord(value)) fail('journal is not a plain object')
  exactKeys(
    value,
    [
      'schemaVersion',
      'identity',
      'operationStep',
      'operationPacketDigest',
      'slicePlan',
      'slicePlanDigest',
      'preflight',
      'retryDiagnostic',
      'entries',
      'pendingSlice',
      'journalDigest',
    ],
    'journal',
  )
  if (value.schemaVersion !== GAME_IR_PROJECTION_SLICE_JOURNAL_SCHEMA_VERSION)
    fail('unknown journal schema')
  const identity = normalizeIdentity(value.identity)
  bindIdentity(identity, authority)
  bindProjectionStep(
    input.operationStep,
    input.slicePlan.moduleId,
    authority.source.moduleId,
  )
  if (
    !same(identity, input.identity) ||
    value.operationStep !== input.operationStep ||
    value.operationPacketDigest !== authority.packet.packetDigest
  )
    fail('journal identity or operation binding is stale')
  sha256(value.operationPacketDigest, 'journal operationPacketDigest')
  const slicePlan = normalizePlan(value.slicePlan)
  if (!same(slicePlan, input.slicePlan)) fail('journal slice plan is stale')
  const persisted = normalizePersistedPreflight(value.preflight, authority.source)
  authority = persisted.validation
    ? { ...authority, validation: persisted.validation }
    : authority
  if (value.entries && Array.isArray(value.entries) && value.entries.length > 0)
    requireValidation(authority)
  const slicePlanDigest = sha256(
    value.slicePlanDigest,
    'journal slicePlanDigest',
  )
  if (slicePlanDigest !== planDigest(slicePlan))
    fail('journal slice plan digest mismatch')
  if (!Array.isArray(value.entries)) fail('journal entries must be an array')
  const entries: GameIrProjectionSliceJournalEntry[] = []
  const nodeIds = new Set<string>()
  const evidenceSubjects = new Set<string>()
  for (let index = 0; index < value.entries.length; index += 1) {
    const slice = slicePlan.slices[index]
    if (!slice) fail('journal contains entries beyond the declared slice plan')
    const raw = value.entries[index]
    if (!isRecord(raw)) fail(`journal entry ${index} is invalid`)
    exactKeys(
      raw,
      [
        'sliceId',
        'predecessorDigest',
        'resultDigest',
        'semantic',
        'entryDigest',
      ],
      `journal entry ${index}`,
    )
    const predecessorDigest = sha256(
      raw.predecessorDigest,
      `journal entry ${index} predecessorDigest`,
    )
    const expectedPredecessor = entries.at(-1)?.entryDigest ?? GENESIS_DIGEST
    if (predecessorDigest !== expectedPredecessor)
      fail('journal predecessor chain is invalid')
    if (raw.sliceId !== slice.sliceId)
      fail(`journal entry ${index} slice identity is stale or relabeled`)
    const normalized = normalizePersistedSemantic(
      raw.semantic,
      slice,
      authority,
      entries.flatMap(entry => entry.semantic.nodes),
    )
    assertRelationshipCardinality(slice, normalized.semantic.nodes)
    assertObligationCoverage(
      entries,
      slice,
      normalized.semantic.nodes,
      authority,
      normalized.semantic.sourceEvidenceGroups,
    )
    assertLocalTargetClosure(
      entries,
      slicePlan,
      slice,
      normalized.semantic.nodes,
      authority,
    )
    for (const node of normalized.semantic.nodes) {
      if (nodeIds.has(node.id))
        fail(`journal contains cross-slice duplicate node ID ${node.id}`)
      nodeIds.add(node.id)
    }
    for (const subject of normalized.evidenceSubjects) {
      if (evidenceSubjects.has(subject))
        fail(
          `journal contains cross-slice duplicate evidence subject ${subject}`,
        )
      evidenceSubjects.add(subject)
    }
    const resultDigest = sha256(
      raw.resultDigest,
      `journal entry ${index} resultDigest`,
    )
    if (resultDigest !== digestGameIrValue(normalized.semantic))
      fail('journal result digest mismatch')
    const body = {
      sliceId: slice.sliceId,
      predecessorDigest,
      resultDigest,
      semantic: normalized.semantic,
    }
    const entryDigest = sha256(
      raw.entryDigest,
      `journal entry ${index} entryDigest`,
    )
    if (entryDigest !== digestGameIrValue(entryBody(body)))
      fail('journal entry digest mismatch')
    entries.push(deepFreeze({ ...body, entryDigest }))
  }
  const pendingSlice = normalizePendingSlice(
    value.pendingSlice,
    entries,
    slicePlan,
    authority,
  )
  if (pendingSlice && !persisted.validation)
    fail('pending projection requires an admitted obligation validation PASS receipt')
  const retryDiagnostic = normalizeRetryDiagnostic(
    value.retryDiagnostic,
    entries,
    slicePlan,
    authority,
  )
  const body = {
    schemaVersion: GAME_IR_PROJECTION_SLICE_JOURNAL_SCHEMA_VERSION,
    identity,
    operationStep: input.operationStep,
    operationPacketDigest: authority.packet.packetDigest,
    slicePlan,
    slicePlanDigest,
    preflight: persisted.preflight,
    retryDiagnostic,
    entries: Object.freeze(entries),
    pendingSlice,
  }
  const journalDigest = sha256(value.journalDigest, 'journal journalDigest')
  if (journalDigest !== digestGameIrValue(snapshotBody(body)))
    fail('journal digest mismatch')
  return deepFreeze({ ...body, journalDigest })
}

async function persist(
  path: string,
  state: Omit<GameIrProjectionSliceJournalSnapshot, 'journalDigest'>,
): Promise<GameIrProjectionSliceJournalSnapshot> {
  const { journalDigest: _staleDigest, ...bodyWithoutDigest } = state as Omit<
    GameIrProjectionSliceJournalSnapshot,
    'journalDigest'
  > & { journalDigest?: string }
  const body = {
    ...bodyWithoutDigest,
    journalDigest: digestGameIrValue(snapshotBody(bodyWithoutDigest)),
  }
  await durableWrite(path, `${canonicalGameIrJson(body)}\n`)
  return clone(body)
}

function hydrateAuthority(
  authority: Authority,
  preflight: GameIrProjectionSliceJournalPreflight,
): Authority {
  return preflight.inventory && preflight.validationReceipt
    ? { ...authority, validation: validationFor(authority.source, preflight.inventory) }
    : authority
}

export class GameIrProjectionSliceJournal {
  private constructor(
    private readonly path: string,
    private authority: Authority,
    private state: GameIrProjectionSliceJournalSnapshot,
  ) {}

  static async create(
    input: GameIrProjectionSliceJournalInput,
  ): Promise<GameIrProjectionSliceJournal> {
    const identity = normalizeIdentity(input.identity)
    const slicePlan = normalizePlan(input.slicePlan)
    const authority = normalizePacket(input.packet)
    bindIdentity(identity, authority)
    const operationStep = bindProjectionStep(
      input.operationStep,
      slicePlan.moduleId,
      authority.source.moduleId,
    )
    try {
      const raw = await readFile(input.journalPath, 'utf8')
      const snapshot = normalizeSnapshot(
        JSON.parse(raw),
        { ...input, identity, operationStep, slicePlan, packet: authority.packet },
        authority,
      )
      return new GameIrProjectionSliceJournal(
        input.journalPath,
        hydrateAuthority(authority, snapshot.preflight),
        snapshot,
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const state = await persist(input.journalPath, {
      schemaVersion: GAME_IR_PROJECTION_SLICE_JOURNAL_SCHEMA_VERSION,
      identity,
      operationStep,
      operationPacketDigest: authority.packet.packetDigest,
      slicePlan,
      slicePlanDigest: planDigest(slicePlan),
      preflight: { inventory: null, validationReceipt: null, diagnostic: null },
      retryDiagnostic: null,
      entries: [],
      pendingSlice: null,
    })
    return new GameIrProjectionSliceJournal(input.journalPath, authority, state)
  }

  static async load(
    input: GameIrProjectionSliceJournalInput,
  ): Promise<GameIrProjectionSliceJournal> {
    const authority = normalizePacket(input.packet)
    bindIdentity(normalizeIdentity(input.identity), authority)
    bindProjectionStep(
      input.operationStep,
      input.slicePlan.moduleId,
      authority.source.moduleId,
    )
    const raw = await readFile(input.journalPath, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      fail('journal is not valid JSON')
    }
    const snapshot = normalizeSnapshot(parsed, input, authority)
    return new GameIrProjectionSliceJournal(
      input.journalPath,
      hydrateAuthority(authority, snapshot.preflight),
      snapshot,
    )
  }

  get journalPath(): string {
    return this.path
  }
  get identity(): GameIrCompilationIdentity {
    return clone(this.state.identity)
  }
  get operationStep(): string {
    return this.state.operationStep
  }
  get operationPacketDigest(): string {
    return this.state.operationPacketDigest
  }
  get slicePlan(): GameIrProjectionSlicePlan {
    return clone(this.state.slicePlan)
  }
  get preflightMode(): 'obligation-inventory' | 'obligation-validation' | 'projection' {
    if (!this.state.preflight.inventory) return 'obligation-inventory'
    if (!this.state.preflight.validationReceipt) return 'obligation-validation'
    return 'projection'
  }
  get obligationInventory(): GameIrSemanticObligationInventory | undefined {
    return this.state.preflight.inventory
      ? clone(this.state.preflight.inventory)
      : undefined
  }
  get validationReceipt(): GameIrSemanticObligationValidationReceipt | undefined {
    return this.state.preflight.validationReceipt
      ? clone(this.state.preflight.validationReceipt)
      : undefined
  }
  get retryDiagnostic(): GameIrProjectionRetryDiagnostic | undefined {
    return this.state.retryDiagnostic
      ? clone(this.state.retryDiagnostic)
      : undefined
  }
  get entries(): readonly GameIrProjectionSliceJournalEntry[] {
    return clone(this.state.entries)
  }
  get snapshot(): GameIrProjectionSliceJournalSnapshot {
    return clone(this.state)
  }
  get completedSnapshot(): GameIrProjectionSliceJournalSnapshot {
    requireValidation(this.authority)
    if (this.state.entries.length !== this.state.slicePlan.slices.length)
      fail('cannot read a completed snapshot before every slice is admitted')
    return clone(this.state)
  }
  get nextSlice(): GameIrProjectionSlice | undefined {
    requireValidation(this.authority)
    return clone(this.state.slicePlan.slices[this.state.entries.length])
  }

  async admitObligationInventory(
    inventory: GameIrSemanticObligationInventory,
  ): Promise<GameIrProjectionSliceJournal> {
    if (this.state.entries.length > 0)
      fail('cannot admit obligation inventory after projection entries exist')
    if (this.state.preflight.validationReceipt)
      fail('cannot replace an admitted obligation validation PASS receipt')
    const validation = validationFor(this.authority.source, inventory)
    this.authority = { ...this.authority, validation: undefined }
    this.state = await persist(this.path, {
      ...this.state,
      retryDiagnostic: null,
      preflight: {
        inventory: validation.inventory,
        validationReceipt: null,
        diagnostic: null,
      },
    })
    return this
  }

  async admitObligationValidationReceipt(
    receipt: GameIrSemanticObligationValidationReceipt,
  ): Promise<GameIrProjectionSliceJournal> {
    if (this.state.entries.length > 0)
      fail('cannot admit obligation validation after projection entries exist')
    const inventory = this.state.preflight.inventory
    if (!inventory)
      fail('cannot admit obligation validation without a persisted inventory')
    const validation = validationFor(this.authority.source, inventory)
    const validationReceipt = normalizeGameIrSemanticObligationValidationReceipt(
      validation,
      receipt,
    )
    this.authority = { ...this.authority, validation }
    this.state = await persist(this.path, {
      ...this.state,
      retryDiagnostic: null,
      preflight: { inventory, validationReceipt, diagnostic: null },
    })
    return this
  }

  async invalidateObligationPreflight(
    diagnostic: GameIrProjectionSlicePreflightDiagnostic,
  ): Promise<GameIrProjectionSliceJournal> {
    if (this.state.entries.length > 0)
      fail('cannot invalidate obligation preflight after projection entries exist')
    const inventory = this.state.preflight.inventory
    if (!inventory) fail('cannot invalidate absent obligation preflight')
    const validation = validationFor(this.authority.source, inventory)
    const admitted = admitGameIrSemanticObligationValidationResult({
      authority: validation,
      result: {
        outcome: 'FAIL',
        moduleId: validation.moduleId,
        reasonCode: 'missing-obligation',
        targetId: diagnostic.targetId,
        expectedKind: diagnostic.expectedKind,
        semanticRole: diagnostic.semanticRole,
        fragmentId: diagnostic.fragmentId,
      },
    })
    if (admitted.outcome !== 'FAIL')
      fail('obligation preflight diagnostic is not a validated missing obligation')
    this.authority = { ...this.authority, validation: undefined }
    this.state = await persist(this.path, {
      ...this.state,
      retryDiagnostic: null,
      preflight: { inventory: null, validationReceipt: null, diagnostic },
    })
    return this
  }

  async setRetryDiagnostic(
    diagnostic: GameIrProjectionRetryDiagnostic,
  ): Promise<GameIrProjectionSliceJournal> {
    requireValidation(this.authority)
    const normalized = normalizeRetryDiagnostic(
      diagnostic,
      this.state.entries,
      this.state.slicePlan,
      this.authority,
    )
    if (!normalized) fail('retry diagnostic cannot be null')
    this.state = await persist(this.path, {
      ...this.state,
      retryDiagnostic: normalized,
    })
    return this
  }

  async clearRetryDiagnostic(): Promise<GameIrProjectionSliceJournal> {
    if (!this.state.retryDiagnostic) return this
    this.state = await persist(this.path, {
      ...this.state,
      retryDiagnostic: null,
    })
    return this
  }
  get currentSliceRecordPrefix(): readonly Readonly<{ id: string; kind: string }>[] {
    requireValidation(this.authority)
    return clone(
      (this.state.pendingSlice?.records ?? []).map(record => ({
        id: record.node.id,
        kind: record.node.kind,
      })),
    )
  }
  get currentSliceRecordDigests(): readonly string[] {
    requireValidation(this.authority)
    return clone(
      (this.state.pendingSlice?.records ?? []).map(record => record.recordDigest),
    )
  }
  get nextSliceContext(): GameIrProjectionSliceContext {
    requireValidation(this.authority)
    return clone(
      sliceContext(
        this.state.entries,
        this.state.slicePlan.slices[this.state.entries.length],
        this.authority,
        this.state.pendingSlice,
      ),
    )
  }

  /** Truncates a validated obligation owner and all of its successors atomically. */
  async rollbackOwnerForDiagnostic(
    input: GameIrProjectionSliceRollbackInput,
  ): Promise<GameIrProjectionRetryDiagnostic | undefined> {
    if (input.diagnosticDigest !== undefined)
      sha256(input.diagnosticDigest, 'rollback diagnosticDigest')
    if (input.expectedJournalDigest !== undefined)
      sha256(input.expectedJournalDigest, 'rollback expectedJournalDigest')
    const obligation = requireValidation(this.authority).inventory.index[input.obligationId]
    if (!obligation) fail('rollback obligation is outside the admitted inventory')
    if (obligation.ownerSliceId !== input.ownerSliceId)
      fail('rollback owner slice is detached from the admitted obligation')
    if (obligation.fragmentId !== input.fragmentId)
      fail('rollback fragment is detached from the admitted obligation')
    if (input.recordId !== undefined && input.recordId !== obligation.targetId)
      fail('rollback record is detached from the admitted obligation')
    if (
      input.expectedJournalDigest !== undefined &&
      input.expectedJournalDigest !== this.state.journalDigest
    )
      fail('rollback journal digest is stale')

    const reason = input.diagnosticDigest
      ? `structured projection diagnostic ${input.diagnosticDigest}`
      : 'structured projection diagnostic'
    const pending = this.state.pendingSlice
    if (pending?.sliceId === input.ownerSliceId) {
      const ownerIndex = pending.records.findIndex(
        record => record.node.id === obligation.targetId,
      )
      if (ownerIndex < 0) return undefined
      const owner = pending.records[ownerIndex]!
      if (owner.fragmentId !== obligation.fragmentId)
        fail('rollback pending record evidence is detached')
      const prefixRecords = Object.freeze([...pending.records.slice(0, ownerIndex)])
      const nextPending = prefixRecords.length
        ? {
            sliceId: pending.sliceId,
            predecessorDigest: pending.predecessorDigest,
            records: prefixRecords,
          }
        : null
      this.state = await persist(this.path, {
        ...this.state,
        retryDiagnostic: {
          scope: 'record',
          sliceId: pending.sliceId,
          recordId: obligation.targetId,
          fragmentId: obligation.fragmentId,
          reason,
        },
        pendingSlice: nextPending
          ? { ...nextPending, pendingDigest: pendingDigest(nextPending) }
          : null,
      })
      return {
        scope: 'record',
        sliceId: pending.sliceId,
        recordId: obligation.targetId,
        fragmentId: obligation.fragmentId,
        reason,
      }
    }

    const ownerEntryIndex = this.state.entries.findIndex(
      entry => entry.sliceId === input.ownerSliceId,
    )
    if (ownerEntryIndex < 0) return undefined
    const ownerEntry = this.state.entries[ownerEntryIndex]!
    const ownerNode = ownerEntry.semantic.nodes.find(
      node => node.id === obligation.targetId,
    )
    if (!ownerNode) return undefined
    this.state = await persist(this.path, {
      ...this.state,
      retryDiagnostic: {
        scope: 'record',
        sliceId: ownerEntry.sliceId,
        recordId: obligation.targetId,
        fragmentId: obligation.fragmentId,
        reason,
      },
      entries: this.state.entries.slice(0, ownerEntryIndex),
      pendingSlice: null,
    })
    return {
      scope: 'record',
      sliceId: ownerEntry.sliceId,
      recordId: obligation.targetId,
      fragmentId: obligation.fragmentId,
      reason,
    }
  }

  async appendRecords(
    records: readonly GameIrProjectionNodeRecord[],
    sliceId?: string,
  ): Promise<{
    acceptedCount: number
    replayed?: boolean
    diagnostic?: GameIrProjectionRetryDiagnostic
  }> {
    requireValidation(this.authority)
    const targetIndex = sliceId
      ? this.state.slicePlan.slices.findIndex(
          candidate => candidate.sliceId === sliceId,
        )
      : this.state.entries.length
    if (targetIndex < 0) fail(`cannot append records for unknown slice ${sliceId}`)
    if (targetIndex > this.state.entries.length)
      fail(`cannot append records for stale slice ${sliceId}`)
    if (targetIndex < this.state.entries.length) {
      const entry = this.state.entries[targetIndex]!
      const targetSlice = this.state.slicePlan.slices[targetIndex]!
      const normalized: GameIrProjectionNodeRecord[] = []
      for (const candidate of records) {
        try {
          const node = normalizeRecordNode(
            candidate,
            targetSlice,
            this.authority,
            [
              ...this.state.entries
                .slice(0, targetIndex)
                .flatMap(entry => entry.semantic.nodes),
              ...entry.semantic.nodes,
            ],
          )
          normalized.push(node)
        } catch (error) {
          const raw = candidate as unknown as Record<string, unknown>
          const node = raw?.node as Record<string, unknown> | undefined
          return {
            acceptedCount: 0,
            diagnostic: {
              scope: 'record',
              sliceId: targetSlice.sliceId,
              recordId: typeof node?.id === 'string' ? node.id : '<unknown>',
              fragmentId:
                typeof raw?.fragmentId === 'string'
                  ? raw.fragmentId
                  : '<unknown>',
              reason: error instanceof Error ? error.message : 'record is invalid',
            },
          }
        }
      }
      const catalog = buildGameIrEvidenceFragmentCatalog({
        sectionIndex: this.authority.source.sectionIndex,
        sectionBytes: this.authority.source.sectionBytes,
      })
      const fragmentForNode = new Map<string, string>()
      for (const group of entry.semantic.sourceEvidenceGroups) {
        const fragment = catalog.fragments.find(
          candidate =>
            candidate.documentPath === group.documentPath &&
            candidate.sectionId === group.sectionId &&
            candidate.excerpt === group.excerpt,
        )
        if (!fragment) return { acceptedCount: 0 }
        for (const subject of group.subjects) {
          const match = /^node:(.+)#\/$/.exec(subject)
          if (match) fragmentForNode.set(match[1]!, fragment.fragmentId)
        }
      }
      const expected = entry.semantic.nodes.map(node =>
        digestGameIrValue({
          fragmentId: fragmentForNode.get(node.id),
          node,
        }),
      )
      const actual = normalized.map(record =>
        digestGameIrValue({ fragmentId: record.fragmentId, node: record.node }),
      )
      if (
        expected.length !== actual.length ||
        expected.some((digest, index) => digest !== actual[index])
      ) {
        const first = records[0]
        return {
          acceptedCount: 0,
          diagnostic: {
            scope: 'record',
            sliceId: targetSlice.sliceId,
            recordId:
              typeof first?.node?.id === 'string' ? first.node.id : '<unknown>',
            fragmentId:
              typeof first?.fragmentId === 'string'
                ? first.fragmentId
                : '<unknown>',
            reason: `record replay conflicts with completed slice ${targetSlice.sliceId}`,
          },
        }
      }
      return { acceptedCount: records.length, replayed: true }
    }
    const slice = this.state.slicePlan.slices[this.state.entries.length]
    if (!slice) fail('all slices are already completed')
    const previous = this.state.pendingSlice
    const predecessorDigest = this.state.entries.at(-1)?.entryDigest ?? GENESIS_DIGEST
    if (
      previous &&
      (previous.sliceId !== slice.sliceId ||
        previous.predecessorDigest !== predecessorDigest)
    )
      fail('pendingSlice is detached from the journal cursor')
    let pendingRecords = [...(previous?.records ?? [])]
    let acceptedCount = 0
    for (const candidate of records) {
      let normalized: GameIrProjectionNodeRecord
      try {
        normalized = normalizeRecordNode(
          candidate,
          slice,
          this.authority,
          [
            ...this.state.entries.flatMap(entry => entry.semantic.nodes),
            ...pendingRecords.map(record => record.node),
          ],
        )
      } catch (error) {
        const raw = candidate as unknown as Record<string, unknown>
        const node = raw?.node as Record<string, unknown> | undefined
        const recordId = typeof node?.id === 'string' ? node.id : '<unknown>'
        const fragmentId =
          typeof raw?.fragmentId === 'string' ? raw.fragmentId : '<unknown>'
        return {
          acceptedCount,
          diagnostic: {
            scope: 'record',
            sliceId: slice.sliceId,
            recordId,
            fragmentId,
            reason: error instanceof Error ? error.message : 'record is invalid',
          },
        }
      }
      const index = pendingRecords.findIndex(
        record => record.node.id === normalized.node.id,
      )
      if (index >= 0) {
        const existing = pendingRecords[index]!
        if (same(existing, { ...normalized, recordDigest: existing.recordDigest })) {
          acceptedCount += 1
          continue
        }
        return {
          acceptedCount,
          diagnostic: {
            scope: 'record',
            sliceId: slice.sliceId,
            recordId: normalized.node.id,
            fragmentId: normalized.fragmentId,
            reason: `record ${normalized.node.id} conflicts with its persisted prefix`,
          },
        }
      }
      const lastId = pendingRecords.at(-1)?.node.id
      if (lastId !== undefined && compareCodeUnits(lastId, normalized.node.id) >= 0)
        return {
          acceptedCount,
          diagnostic: {
            scope: 'record',
            sliceId: slice.sliceId,
            recordId: normalized.node.id,
            fragmentId: normalized.fragmentId,
            reason: `record IDs must be strictly increasing after ${lastId}`,
          },
        }
      const existingEntryNode = this.state.entries.some(entry =>
        entry.semantic.nodes.some(node => node.id === normalized.node.id),
      )
      if (existingEntryNode)
        return {
          acceptedCount,
          diagnostic: {
            scope: 'record',
            sliceId: slice.sliceId,
            recordId: normalized.node.id,
            fragmentId: normalized.fragmentId,
            reason: `record ${normalized.node.id} duplicates a completed node`,
          },
        }
      const body = { fragmentId: normalized.fragmentId, node: normalized.node }
      const record = {
        ...body,
        recordDigest: digestGameIrValue(body),
      }
      pendingRecords = [...pendingRecords, record]
      const pending = {
        sliceId: slice.sliceId,
        predecessorDigest,
        records: Object.freeze([...pendingRecords]),
      }
      this.state = await persist(this.path, {
        ...this.state,
        pendingSlice: {
          ...pending,
          pendingDigest: pendingDigest(pending),
        },
        ...(this.state.retryDiagnostic?.scope === 'record' &&
        this.state.retryDiagnostic.sliceId === slice.sliceId &&
        this.state.retryDiagnostic.recordId === normalized.node.id &&
        this.state.retryDiagnostic.fragmentId === normalized.fragmentId
          ? { retryDiagnostic: null }
          : {}),
      })
      acceptedCount += 1
    }
    return { acceptedCount }
  }

  async completeCurrentSlice(): Promise<GameIrProjectionSliceJournal> {
    requireValidation(this.authority)
    const slice = this.state.slicePlan.slices[this.state.entries.length]
    if (!slice) fail('all slices are already completed')
    const pending = this.state.pendingSlice
    const grouped = new Map<string, string[]>()
    for (const record of pending?.records ?? []) {
      const ids = grouped.get(record.fragmentId) ?? []
      ids.push(record.node.id)
      grouped.set(record.fragmentId, ids)
    }
    const sourceEvidenceGroups = [...grouped.entries()]
      .map(([fragmentId, nodeIds]) => ({
        fragmentId,
        nodeIds: [...nodeIds].sort(compareCodeUnits),
      }))
      .sort((left, right) =>
        compareCodeUnits(
          `${left.fragmentId}\0${left.nodeIds.join('\0')}`,
          `${right.fragmentId}\0${right.nodeIds.join('\0')}`,
        ),
      )
    await this.append({
      status: 'completed',
      sliceId: slice.sliceId,
      semantic: {
        nodes: (pending?.records ?? []).map(record => record.node),
        sourceEvidenceGroups,
      },
    })
    return this
  }

  async append(
    completion: GameIrProjectionSliceCompletion,
  ): Promise<GameIrProjectionSliceJournal> {
    requireValidation(this.authority)
    const authority = this.authority
    const slice = this.state.slicePlan.slices[this.state.entries.length]
    if (!slice) fail('all slices are already completed')
    if (this.state.entries.some(entry => entry.sliceId === completion.sliceId))
      fail(`duplicate slice ${completion.sliceId}`)
    if (completion.sliceId !== slice.sliceId)
      fail(
        `slice ${completion.sliceId} is not the exact next slice ${slice.sliceId}`,
      )
    const normalized = normalizeCompletion(
      completion,
      slice,
      authority,
      this.state.entries.flatMap(entry => entry.semantic.nodes),
    )
    assertRelationshipCardinality(slice, normalized.semantic.nodes)
    assertObligationCoverage(
      this.state.entries,
      slice,
      normalized.semantic.nodes,
      authority,
      normalized.semantic.sourceEvidenceGroups,
    )
    assertLocalTargetClosure(
      this.state.entries,
      this.state.slicePlan,
      slice,
      normalized.semantic.nodes,
      authority,
    )
    const nodeIds = new Set(
      this.state.entries.flatMap(entry =>
        entry.semantic.nodes.map(node => node.id),
      ),
    )
    for (const node of normalized.semantic.nodes)
      if (nodeIds.has(node.id))
        fail(`journal contains cross-slice duplicate node ID ${node.id}`)
    const evidenceSubjects = new Set(
      this.state.entries.flatMap(entry =>
        entry.semantic.sourceEvidenceGroups.flatMap(group => group.subjects),
      ),
    )
    for (const subject of normalized.evidenceSubjects)
      if (evidenceSubjects.has(subject))
        fail(`journal contains duplicate evidence subject ${subject}`)
    const predecessorDigest =
      this.state.entries.at(-1)?.entryDigest ?? GENESIS_DIGEST
    const resultDigest = digestGameIrValue(normalized.semantic)
    const body = {
      sliceId: slice.sliceId,
      predecessorDigest,
      resultDigest,
      semantic: normalized.semantic,
    }
    const entry = { ...body, entryDigest: digestGameIrValue(entryBody(body)) }
    this.state = await persist(this.path, {
      ...this.state,
      retryDiagnostic: null,
      entries: [...this.state.entries, entry],
      pendingSlice: null,
    })
    return this
  }

  async invalidate(sliceId: string): Promise<GameIrProjectionSliceJournal> {
    const index = this.state.slicePlan.slices.findIndex(
      slice => slice.sliceId === sliceId,
    )
    if (index < 0) fail(`cannot invalidate unknown slice ${sliceId}`)
    this.state = await persist(this.path, {
      ...this.state,
      retryDiagnostic: null,
      entries: this.state.entries.slice(0, index),
      pendingSlice: null,
    })
    return this
  }
}

export async function createGameIrProjectionSliceJournal(
  input: GameIrProjectionSliceJournalInput,
): Promise<GameIrProjectionSliceJournal> {
  return GameIrProjectionSliceJournal.create(input)
}

export function loadGameIrProjectionSliceJournal(
  input: GameIrProjectionSliceJournalInput,
): Promise<GameIrProjectionSliceJournal> {
  return GameIrProjectionSliceJournal.load(input)
}

/**
 * Remove staging only after the persisted run points at a loader-verified
 * canonical operation manifest. A path existing on disk is never authority.
 */
export async function cleanupGameIrProjectionSliceJournalAfterCheckpoint(input: {
  workspacePath: string
  identity: GameIrCompilationIdentity
  operationStep: GameIrProtocolStep
  deliveryRun: DeliveryRun
}): Promise<void> {
  if (
    input.deliveryRun.gameIrState?.status !== 'compiling' ||
    !same(input.deliveryRun.gameIrState.identity, input.identity)
  )
    fail('journal cleanup requires the exact persisted compiling identity')
  const loaded = await new GameIrStageCheckpointLoader().load({
    workspacePath: input.workspacePath,
    deliveryRun: input.deliveryRun,
  })
  if (loaded.step !== input.operationStep)
    fail('journal cleanup requires the loader-verified operation manifest')
  const journalPath = gameIrProjectionSliceJournalPath({
    workspacePath: input.workspacePath,
    identity: input.identity,
    operationStep: input.operationStep,
  })
  await rm(journalPath, { force: true })
}
