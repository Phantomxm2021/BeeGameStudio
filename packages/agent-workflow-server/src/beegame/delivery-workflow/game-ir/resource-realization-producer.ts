import {
  admitGameIrMechanicalProjectionReceipt,
  admitGameIrDomainSemanticResult,
  normalizeGameIrDomainSemanticReceipt,
  type GameIrDomainSemanticPacket,
  type GameIrDomainSemanticReceipt,
  type GameIrDomainSemanticDiagnostic,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  assembleWorldPresentationClosure,
  type WorldPresentationAssemblyAuthority,
} from './world-presentation-assembler'
import {
  RESOURCE_REALIZATION_DOMAIN_MANIFEST,
  type ResourceRealizationResourceKind,
} from './resource-realization-schema'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  canonicalizeGameIrSourceSections,
  digestGameIrValue,
  type GameIrNode,
  type GameIrSourceSection,
} from './model'
import { createSemanticFidelityPrimitives } from './semantic-fidelity'
import { sectionEvidencePointer } from './semantic-admission'

const fidelity = createSemanticFidelityPrimitives(
  'invalid Resource Realization producer',
)
const { exactKeys, strictArray, text, safeId, sha256, deepFreeze } = fidelity

type RecordValue = Record<string, unknown>

export type ResourceRealizationPresentationRequirement = Readonly<{
  requirementId: string
  kind: string
  runtimeRole: string
  ownerNodeId: string
  ownerNodeKind: string
  requirementIdPointer: string
  kindPointer: string
  runtimeRolePointer: string
  evidence: RequirementEvidenceSet
}>

type RequirementEvidence = Readonly<{
  documentPath: string
  sectionId: string
  sectionDigest: string
  sourcePointer: string
}>

/*
 * Every Presentation requirement leaf is independently source-bound. Keeping
 * this as a fixed three-key record prevents a caller from collapsing the
 * authority into one ambiguous evidence pointer.
 */
type RequirementEvidenceSet = Readonly<{
  requirementId: RequirementEvidence
  kind: RequirementEvidence
  runtimeRole: RequirementEvidence
}>

export type ResourceRealizationPriorTarget = Readonly<{
  id: string
  kind: string
}>

export type ResourceRealizationSemanticProjectionPacket = Readonly<{
  schemaVersion: 'game-ir-resource-realization-semantic-projection-packet.v1'
  taskId: string
  moduleId: 'resource-realization'
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  presentationRequirements: readonly ResourceRealizationPresentationRequirement[]
  presentationRequirementsDigest: string
  allowedPriorNodeTargets: readonly ResourceRealizationPriorTarget[]
  sourceSections: readonly GameIrSourceSection[]
  allowedNodeKinds: readonly string[]
  allowedRelationshipTypes: readonly string[]
  forbiddenPresentationRequirementIds: readonly string[]
  forbiddenTargets: readonly string[]
  packetDigest: string
}>

export type ResourceRealizationSemanticProjectionAuthority = Readonly<{
  phase5Authority: WorldPresentationAssemblyAuthority
  resourceRealization: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
  }>
}>

export type ResourceRealizationSemanticReceipt = GameIrDomainSemanticReceipt &
  Readonly<{ moduleId: 'resource-realization' }>

export type ResourceRealizationSemanticResult =
  | ResourceRealizationSemanticReceipt
  | GameIrDomainSemanticDiagnostic

function fail(message: string): never {
  throw new Error(`invalid Resource Realization producer: ${message}`)
}

function isRecord(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function digest(value: unknown, label: string): string {
  return sha256(value, label)
}

function manifestNodeKinds(): readonly string[] {
  return Object.freeze(
    Object.keys(RESOURCE_REALIZATION_DOMAIN_MANIFEST).sort(compareCodeUnits),
  )
}

function manifestRelationshipTypes(): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        Object.values(RESOURCE_REALIZATION_DOMAIN_MANIFEST).flatMap(entry =>
          Object.keys(entry.relationships),
        ),
      ),
    ].sort(compareCodeUnits),
  )
}

function sourceIdentity(
  source: GameIrDomainSourceEnvelope,
): Readonly<Record<string, string>> {
  return {
    taskId: source.taskId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    foundationReceiptDigest: source.compileRequest.foundation.receiptDigest,
    compileRequestDigest: digestGameIrValue(source.compileRequest),
    authoritySectionIndexDigest: digestGameIrValue(
      source.authoritySectionIndex,
    ),
  }
}

function closureIdentity(
  closure: ReturnType<typeof assembleWorldPresentationClosure>,
): Readonly<Record<string, string>> {
  return {
    taskId: closure.taskId,
    foundationRevision: closure.foundationRevision,
    foundationReceiptDigest: closure.foundationReceiptDigest,
    compileRequestDigest: closure.compileRequestDigest,
    authoritySectionIndexDigest: closure.authoritySectionIndexDigest,
  }
}

function sameIdentity(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  return digestGameIrValue(left) === digestGameIrValue(right)
}

function validateAuthorityShape(
  value: unknown,
): asserts value is ResourceRealizationSemanticProjectionAuthority {
  if (!isRecord(value)) fail('authority must be a plain object')
  exactKeys(value, ['phase5Authority', 'resourceRealization'], 'authority')
  if (!isRecord(value.resourceRealization))
    fail('resourceRealization must be a plain object')
  exactKeys(
    value.resourceRealization,
    ['source', 'mechanical'],
    'resourceRealization authority',
  )
}

function requirementEvidence(
  node: Pick<GameIrNode, 'bindings'>,
  pointer: string,
  requirementId: string,
  source: GameIrDomainSourceEnvelope,
): RequirementEvidence {
  const binding = node.bindings[pointer]
  if (!binding || binding.kind !== 'owner')
    fail(
      `Presentation requirement ${requirementId} is missing evidence for ${pointer}`,
    )
  const section = source.authoritySectionIndex.find(
    entry =>
      entry.documentPath === binding.documentPath &&
      entry.sectionId === binding.sectionId,
  )
  if (!section || section.digest !== binding.sectionDigest)
    fail(
      `Presentation requirement ${requirementId} evidence for ${pointer} is outside authority`,
    )
  return {
    documentPath: binding.documentPath,
    sectionId: binding.sectionId,
    sectionDigest: binding.sectionDigest,
    sourcePointer: binding.sourcePointer,
  }
}

function presentationRequirements(
  closure: ReturnType<typeof assembleWorldPresentationClosure>,
  source: GameIrDomainSourceEnvelope,
): readonly ResourceRealizationPresentationRequirement[] {
  const output: ResourceRealizationPresentationRequirement[] = []
  for (const node of closure.presentation.module.nodes) {
    const requirements = node.value.requirements
    if (!Array.isArray(requirements)) continue
    for (const [index, raw] of requirements.entries()) {
      if (!isRecord(raw)) fail('Presentation requirement must be an object')
      exactKeys(
        raw,
        ['requirementId', 'kind', 'runtimeRole'],
        'Presentation requirement',
      )
      const requirementId = safeId(
        raw.requirementId,
        'Presentation requirementId',
      )
      const requirementIdPointer = `/value/requirements/${index}/requirementId`
      const kindPointer = `/value/requirements/${index}/kind`
      const runtimeRolePointer = `/value/requirements/${index}/runtimeRole`
      const evidence: RequirementEvidenceSet = {
        requirementId: requirementEvidence(
          node,
          requirementIdPointer,
          requirementId,
          source,
        ),
        kind: requirementEvidence(node, kindPointer, requirementId, source),
        runtimeRole: requirementEvidence(
          node,
          runtimeRolePointer,
          requirementId,
          source,
        ),
      }
      output.push({
        requirementId,
        kind: text(raw.kind, `Presentation requirement ${requirementId} kind`),
        runtimeRole: text(
          raw.runtimeRole,
          `Presentation requirement ${requirementId} runtimeRole`,
        ),
        ownerNodeId: node.id,
        ownerNodeKind: node.kind,
        requirementIdPointer,
        kindPointer,
        runtimeRolePointer,
        evidence,
      })
    }
  }
  output.sort((left, right) =>
    compareCodeUnits(left.requirementId, right.requirementId),
  )
  for (let index = 1; index < output.length; index += 1)
    if (output[index - 1]!.requirementId === output[index]!.requirementId)
      fail(
        `Presentation requirement ${output[index]!.requirementId} is duplicated`,
      )
  return Object.freeze(output.map(entry => deepFreeze(entry)))
}

function priorTargets(
  closure: ReturnType<typeof assembleWorldPresentationClosure>,
): readonly ResourceRealizationPriorTarget[] {
  const nodes = [
    ...closure.phase4.gameplay.module.nodes,
    ...closure.phase4.balance.module.nodes,
    ...closure.worldScene.module.nodes,
    ...closure.presentation.module.nodes,
  ]
  const ids = new Set<string>()
  const output: ResourceRealizationPriorTarget[] = []
  for (const node of nodes) {
    if (ids.has(node.id)) fail(`duplicate prior target ${node.id}`)
    ids.add(node.id)
    output.push({ id: node.id, kind: node.kind })
  }
  output.sort((left, right) => compareCodeUnits(left.id, right.id))
  return Object.freeze(output.map(entry => Object.freeze(entry)))
}

function packetDigestBody(
  packet: ResourceRealizationSemanticProjectionPacket,
): Omit<ResourceRealizationSemanticProjectionPacket, 'packetDigest'> {
  const { packetDigest: _packetDigest, ...body } = packet
  return body
}

function validatePacketSourceSections(
  value: unknown,
): readonly GameIrSourceSection[] {
  const sections = strictArray(value, 'semantic packet sourceSections').map(
    (entry, index) => {
      if (!isRecord(entry))
        fail(`semantic packet sourceSections[${index}] must be an object`)
      exactKeys(
        entry,
        [
          'documentPath',
          'sectionId',
          'heading',
          'startLine',
          'endLine',
          'digest',
        ],
        `semantic packet sourceSections[${index}]`,
      )
      const startLine = entry.startLine
      const endLine = entry.endLine
      if (
        typeof startLine !== 'number' ||
        !Number.isInteger(startLine) ||
        startLine < 1 ||
        typeof endLine !== 'number' ||
        !Number.isInteger(endLine) ||
        endLine < startLine
      )
        fail(
          `semantic packet sourceSections[${index}] has an invalid line range`,
        )
      return {
        documentPath: text(
          entry.documentPath,
          `semantic packet sourceSections[${index}].documentPath`,
        ) as GameIrSourceSection['documentPath'],
        sectionId: safeId(
          entry.sectionId,
          `semantic packet sourceSections[${index}].sectionId`,
        ),
        heading: text(
          entry.heading,
          `semantic packet sourceSections[${index}].heading`,
        ),
        startLine,
        endLine,
        digest: sha256(
          entry.digest,
          `semantic packet sourceSections[${index}].digest`,
        ),
      }
    },
  )
  const canonical = canonicalizeGameIrSourceSections(sections)
  if (
    canonical.length !== sections.length ||
    canonical.some((entry, index) => entry !== sections[index])
  )
    fail('semantic packet sourceSections must use canonical order')
  return sections
}

function validatePacketRequirements(
  value: unknown,
): readonly ResourceRealizationPresentationRequirement[] {
  const requirements = strictArray(
    value,
    'semantic packet presentationRequirements',
  ).map((entry, index) => {
    if (!isRecord(entry))
      fail(
        `semantic packet presentationRequirements[${index}] must be an object`,
      )
    exactKeys(
      entry,
      [
        'requirementId',
        'kind',
        'runtimeRole',
        'ownerNodeId',
        'ownerNodeKind',
        'requirementIdPointer',
        'kindPointer',
        'runtimeRolePointer',
        'evidence',
      ],
      `semantic packet presentationRequirements[${index}]`,
    )
    if (!isRecord(entry.evidence))
      fail(
        `semantic packet presentationRequirements[${index}].evidence must be an object`,
      )
    const evidenceRecord = entry.evidence
    const requirementId = safeId(
      entry.requirementId,
      `semantic packet presentationRequirements[${index}].requirementId`,
    )
    const requirementIdPointer = text(
      entry.requirementIdPointer,
      `semantic packet presentationRequirements[${index}].requirementIdPointer`,
    )
    const kindPointer = text(
      entry.kindPointer,
      `semantic packet presentationRequirements[${index}].kindPointer`,
    )
    const runtimeRolePointer = text(
      entry.runtimeRolePointer,
      `semantic packet presentationRequirements[${index}].runtimeRolePointer`,
    )
    const pointerPattern = (leaf: string): RegExp =>
      new RegExp(`^\\/value\\/requirements\\/(?:0|[1-9]\\d*)\\/${leaf}$`)
    if (
      !pointerPattern('requirementId').test(requirementIdPointer) ||
      !pointerPattern('kind').test(kindPointer) ||
      !pointerPattern('runtimeRole').test(runtimeRolePointer)
    )
      fail(
        `semantic packet presentationRequirements[${index}] has a noncanonical requirement pointer`,
      )
    const evidence = (leaf: 'requirementId' | 'kind' | 'runtimeRole') => {
      const rawEvidence = evidenceRecord[leaf]
      if (!isRecord(rawEvidence))
        fail(
          `semantic packet presentationRequirements[${index}].evidence.${leaf} must be an object`,
        )
      exactKeys(
        rawEvidence,
        ['documentPath', 'sectionId', 'sectionDigest', 'sourcePointer'],
        `semantic packet presentationRequirements[${index}].evidence.${leaf}`,
      )
      return {
        documentPath: text(
          rawEvidence.documentPath,
          `semantic packet presentationRequirements[${index}].evidence.${leaf}.documentPath`,
        ),
        sectionId: safeId(
          rawEvidence.sectionId,
          `semantic packet presentationRequirements[${index}].evidence.${leaf}.sectionId`,
        ),
        sectionDigest: sha256(
          rawEvidence.sectionDigest,
          `semantic packet presentationRequirements[${index}].evidence.${leaf}.sectionDigest`,
        ),
        sourcePointer: text(
          rawEvidence.sourcePointer,
          `semantic packet presentationRequirements[${index}].evidence.${leaf}.sourcePointer`,
        ),
      }
    }
    return {
      requirementId,
      kind: text(
        entry.kind,
        `semantic packet presentationRequirements[${index}].kind`,
      ),
      runtimeRole: text(
        entry.runtimeRole,
        `semantic packet presentationRequirements[${index}].runtimeRole`,
      ),
      ownerNodeId: safeId(
        entry.ownerNodeId,
        `semantic packet presentationRequirements[${index}].ownerNodeId`,
      ),
      ownerNodeKind: text(
        entry.ownerNodeKind,
        `semantic packet presentationRequirements[${index}].ownerNodeKind`,
      ),
      requirementIdPointer,
      kindPointer,
      runtimeRolePointer,
      evidence: {
        requirementId: evidence('requirementId'),
        kind: evidence('kind'),
        runtimeRole: evidence('runtimeRole'),
      },
    }
  })
  for (let index = 1; index < requirements.length; index += 1)
    if (
      compareCodeUnits(
        requirements[index - 1]!.requirementId,
        requirements[index]!.requirementId,
      ) >= 0
    )
      fail('semantic packet presentationRequirements must be unique and sorted')
  return requirements
}

function validateSemanticTargets(
  packet: ResourceRealizationSemanticProjectionPacket,
  nodes: readonly {
    id: string
    kind: string
    references: readonly { targetId: string; targetType: string }[]
    edges: readonly { targetId: string; targetType: string }[]
  }[],
): void {
  const targets = new Map<string, string>()
  for (const target of packet.allowedPriorNodeTargets) {
    if (targets.has(target.id))
      fail(`semantic result target catalog duplicates ${target.id}`)
    targets.set(target.id, target.kind)
  }
  for (const requirement of packet.presentationRequirements) {
    const descriptorId = `resource.requirement.${requirement.requirementId}`
    if (targets.has(descriptorId))
      fail(`semantic result target catalog overlaps ${descriptorId}`)
    targets.set(descriptorId, 'resource-realization.logical-resource')
  }
  for (const node of nodes) {
    if (targets.has(node.id))
      fail(`semantic result target ID overlaps an existing target ${node.id}`)
    targets.set(node.id, node.kind)
  }
  for (const node of nodes) {
    for (const reference of node.references) {
      const expectedType = targets.get(reference.targetId)
      if (!expectedType)
        fail(
          `semantic result reference ${node.id} targets an unknown node ${reference.targetId}`,
        )
      if (expectedType !== reference.targetType)
        fail(
          `semantic result reference ${node.id} has a mismatched target type`,
        )
    }
    for (const edge of node.edges) {
      const expectedType = targets.get(edge.targetId)
      if (!expectedType)
        fail(
          `semantic result edge ${node.id} targets an unknown node ${edge.targetId}`,
        )
      if (expectedType !== edge.targetType)
        fail(`semantic result edge ${node.id} has a mismatched target type`)
    }
  }
}

function validateAdmittedSemanticResult<
  Result extends ResourceRealizationSemanticResult,
>(packet: ResourceRealizationSemanticProjectionPacket, result: Result): Result {
  if (result.outcome !== 'PROJECTED') return result
  validateSemanticTargets(packet, result.nodes)
  for (const node of result.nodes) {
    if (packet.forbiddenTargets.includes(node.id))
      fail(
        `semantic result targets a forbidden Presentation logical ID ${node.id}`,
      )
    if (
      node.kind === 'resource-realization.logical-resource' &&
      typeof node.value.requirementId === 'string' &&
      packet.forbiddenPresentationRequirementIds.includes(
        node.value.requirementId,
      )
    )
      fail(
        `semantic result shadows Presentation requirement ${node.value.requirementId}`,
      )
  }
  return result
}

function buildPacket(
  closure: ReturnType<typeof assembleWorldPresentationClosure>,
  source: GameIrDomainSourceEnvelope,
  mechanical: GameIrMechanicalProjectionReceipt,
): ResourceRealizationSemanticProjectionPacket {
  const requirements = presentationRequirements(closure, source)
  const forbiddenIds = requirements.map(
    requirement => requirement.requirementId,
  )
  const forbiddenTargets = requirements
    .flatMap(requirement => [
      `resource.requirement.${requirement.requirementId}`,
      `node:resource.requirement.${requirement.requirementId}#/id`,
    ])
    .sort(compareCodeUnits)
  const body = {
    schemaVersion:
      'game-ir-resource-realization-semantic-projection-packet.v1' as const,
    taskId: source.taskId,
    moduleId: 'resource-realization' as const,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    mechanicalReceiptDigest: mechanical.receiptDigest,
    presentationRequirements: requirements,
    presentationRequirementsDigest: digestGameIrValue(requirements),
    allowedPriorNodeTargets: priorTargets(closure),
    sourceSections: Object.freeze([...source.sectionIndex]),
    allowedNodeKinds: manifestNodeKinds(),
    allowedRelationshipTypes: manifestRelationshipTypes(),
    forbiddenPresentationRequirementIds: Object.freeze(
      [...forbiddenIds].sort(compareCodeUnits),
    ),
    forbiddenTargets: Object.freeze(forbiddenTargets),
  }
  return deepFreeze({
    ...body,
    packetDigest: digestGameIrValue(body),
  })
}

export function prepareResourceRealizationSemanticProjectionPacket(
  authority: ResourceRealizationSemanticProjectionAuthority,
): ResourceRealizationSemanticProjectionPacket {
  validateAuthorityShape(authority)
  const closure = assembleWorldPresentationClosure(authority.phase5Authority)
  const source = validateGameIrDomainSourceEnvelope(
    authority.resourceRealization.source,
  )
  if (source.moduleId !== 'resource-realization')
    fail('source moduleId must be resource-realization')
  const mechanical = admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: authority.resourceRealization.mechanical,
  })
  if (!sameIdentity(sourceIdentity(source), closureIdentity(closure)))
    fail('resource source is detached from rebuilt Phase 5 authority')
  return buildPacket(closure, source, mechanical)
}

function semanticAdmissionPacket(
  packet: ResourceRealizationSemanticProjectionPacket,
): GameIrDomainSemanticPacket {
  const body = {
    schemaVersion: 'game-ir-domain-semantic-packet.v1' as const,
    taskId: packet.taskId,
    moduleId: packet.moduleId,
    foundationRevision: packet.foundationRevision,
    sourceDigest: packet.sourceDigest,
    mechanicalReceiptDigest: packet.mechanicalReceiptDigest,
    allowedNodeKinds: packet.allowedNodeKinds,
    allowedRelationshipTypes: packet.allowedRelationshipTypes,
    allowedEvidencePointers: packet.sourceSections
      .map(sectionEvidencePointer)
      .sort(compareCodeUnits),
    forbiddenTargets: packet.forbiddenTargets,
  }
  return { ...body, packetDigest: digestGameIrValue(body) }
}

export function admitResourceRealizationSemanticResult(
  authority: ResourceRealizationSemanticProjectionAuthority,
  packet: ResourceRealizationSemanticProjectionPacket,
  value: unknown,
): ResourceRealizationSemanticResult {
  const canonicalPacket =
    prepareResourceRealizationSemanticProjectionPacket(authority)
  if (canonicalGameIrJson(canonicalPacket) !== canonicalGameIrJson(packet))
    fail('semantic packet is stale, relabeled, or detached from authority')
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
    'semantic packet',
  )
  if (
    packet.schemaVersion !==
    'game-ir-resource-realization-semantic-projection-packet.v1'
  )
    fail('semantic packet schemaVersion is invalid')
  if (packet.moduleId !== 'resource-realization')
    fail('semantic packet moduleId is invalid')
  if (packet.packetDigest !== digestGameIrValue(packetDigestBody(packet)))
    fail('semantic packet digest is stale or invalid')
  validatePacketRequirements(packet.presentationRequirements)
  validatePacketSourceSections(packet.sourceSections)
  const expectedNodeKinds = manifestNodeKinds()
  if (
    packet.allowedNodeKinds.length !== expectedNodeKinds.length ||
    packet.allowedNodeKinds.some(
      (kind, index) => kind !== expectedNodeKinds[index],
    )
  )
    fail('semantic packet manifest node kinds are not canonical')
  const expectedRelationshipTypes = manifestRelationshipTypes()
  if (
    packet.allowedRelationshipTypes.length !==
      expectedRelationshipTypes.length ||
    packet.allowedRelationshipTypes.some(
      (relationship, index) =>
        relationship !== expectedRelationshipTypes[index],
    )
  )
    fail('semantic packet manifest relationships are not canonical')
  if (
    packet.presentationRequirementsDigest !==
    digestGameIrValue(packet.presentationRequirements)
  )
    fail('semantic packet Presentation requirement digest is stale or invalid')
  const requirementIds = packet.presentationRequirements
    .map(requirement => requirement.requirementId)
    .sort(compareCodeUnits)
  if (
    packet.forbiddenPresentationRequirementIds.length !==
      requirementIds.length ||
    packet.forbiddenPresentationRequirementIds.some(
      (requirementId, index) => requirementId !== requirementIds[index],
    )
  )
    fail(
      'semantic packet forbidden Presentation requirement IDs are not canonical',
    )
  const expectedForbiddenTargets = packet.presentationRequirements
    .flatMap(requirement => [
      `resource.requirement.${requirement.requirementId}`,
      `node:resource.requirement.${requirement.requirementId}#/id`,
    ])
    .sort(compareCodeUnits)
  if (
    packet.forbiddenTargets.length !== expectedForbiddenTargets.length ||
    packet.forbiddenTargets.some(
      (target, index) => target !== expectedForbiddenTargets[index],
    )
  )
    fail('semantic packet forbidden targets are not canonical')
  const priorTargetIds = strictArray(
    packet.allowedPriorNodeTargets,
    'semantic packet allowedPriorNodeTargets',
  ).map((entry, index) => {
    if (!isRecord(entry))
      fail(
        `semantic packet allowedPriorNodeTargets[${index}] must be an object`,
      )
    exactKeys(
      entry,
      ['id', 'kind'],
      `semantic packet allowedPriorNodeTargets[${index}]`,
    )
    return `${safeId(entry.id, `semantic packet allowedPriorNodeTargets[${index}].id`)}\0${text(entry.kind, `semantic packet allowedPriorNodeTargets[${index}].kind`)}`
  })
  for (let index = 1; index < priorTargetIds.length; index += 1)
    if (
      compareCodeUnits(priorTargetIds[index - 1]!, priorTargetIds[index]!) >= 0
    )
      fail('semantic packet allowedPriorNodeTargets must be unique and sorted')
  const result = admitGameIrDomainSemanticResult(
    semanticAdmissionPacket(packet),
    value,
    {
      errorPrefix: 'invalid Resource Realization producer',
      allowedModuleIds: ['resource-realization'],
      receiptAuthorityDigest: packet.packetDigest,
    },
  )
  const admitted = validateAdmittedSemanticResult(
    packet,
    result as ResourceRealizationSemanticResult,
  )
  return admitted
}

export function replayResourceRealizationSemanticReceipt(
  authority: ResourceRealizationSemanticProjectionAuthority,
  packet: ResourceRealizationSemanticProjectionPacket,
  receipt: unknown,
): ResourceRealizationSemanticReceipt {
  const expectedPacket =
    prepareResourceRealizationSemanticProjectionPacket(authority)
  if (canonicalGameIrJson(expectedPacket) !== canonicalGameIrJson(packet))
    fail('semantic packet is stale, relabeled, or detached from authority')
  if (!isRecord(packet)) fail('semantic packet must be a plain object')
  const normalized = normalizeGameIrDomainSemanticReceipt(
    semanticAdmissionPacket(packet),
    receipt,
    {
      errorPrefix: 'invalid Resource Realization producer',
      allowedModuleIds: ['resource-realization'],
      receiptAuthorityDigest: packet.packetDigest,
    },
  ) as ResourceRealizationSemanticReceipt
  return validateAdmittedSemanticResult(packet, normalized)
}
