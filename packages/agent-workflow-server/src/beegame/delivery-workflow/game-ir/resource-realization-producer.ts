import {
  admitGameIrMechanicalProjectionReceipt,
  admitGameIrDomainSemanticResult,
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
  compareCodeUnits,
  canonicalizeGameIrSourceSections,
  digestGameIrValue,
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
  evidence: Readonly<{
    documentPath: string
    sectionId: string
    sectionDigest: string
    sourcePointer: string
  }>
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
      const binding = node.bindings[requirementIdPointer]
      if (!binding || binding.kind !== 'owner')
        fail(`Presentation requirement ${requirementId} is missing evidence`)
      const section = source.authoritySectionIndex.find(
        entry =>
          entry.documentPath === binding.documentPath &&
          entry.sectionId === binding.sectionId,
      )
      if (!section || section.digest !== binding.sectionDigest)
        fail(
          `Presentation requirement ${requirementId} evidence is outside authority`,
        )
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
        evidence: {
          documentPath: binding.documentPath,
          sectionId: binding.sectionId,
          sectionDigest: binding.sectionDigest,
          sourcePointer: binding.sourcePointer,
        },
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

function packetBody(
  packet: Omit<ResourceRealizationSemanticProjectionPacket, 'packetDigest'>,
): Omit<ResourceRealizationSemanticProjectionPacket, 'packetDigest'> {
  return packet
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
        'evidence',
      ],
      `semantic packet presentationRequirements[${index}]`,
    )
    if (!isRecord(entry.evidence))
      fail(
        `semantic packet presentationRequirements[${index}].evidence must be an object`,
      )
    exactKeys(
      entry.evidence,
      ['documentPath', 'sectionId', 'sectionDigest', 'sourcePointer'],
      `semantic packet presentationRequirements[${index}].evidence`,
    )
    const requirementId = safeId(
      entry.requirementId,
      `semantic packet presentationRequirements[${index}].requirementId`,
    )
    const requirementIdPointer = text(
      entry.requirementIdPointer,
      `semantic packet presentationRequirements[${index}].requirementIdPointer`,
    )
    if (
      !/^\/value\/requirements\/(?:0|[1-9]\d*)\/requirementId$/.test(
        requirementIdPointer,
      )
    )
      fail(
        `semantic packet presentationRequirements[${index}] has a noncanonical requirement pointer`,
      )
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
      evidence: {
        documentPath: text(
          entry.evidence.documentPath,
          `semantic packet presentationRequirements[${index}].evidence.documentPath`,
        ) as GameIrSourceSection['documentPath'],
        sectionId: safeId(
          entry.evidence.sectionId,
          `semantic packet presentationRequirements[${index}].evidence.sectionId`,
        ),
        sectionDigest: sha256(
          entry.evidence.sectionDigest,
          `semantic packet presentationRequirements[${index}].evidence.sectionDigest`,
        ),
        sourcePointer: text(
          entry.evidence.sourcePointer,
          `semantic packet presentationRequirements[${index}].evidence.sourcePointer`,
        ),
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
    packetDigest: digestGameIrValue(packetBody(body)),
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
  return {
    schemaVersion: 'game-ir-domain-semantic-packet.v1',
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
    packetDigest: packet.packetDigest,
  }
}

export function admitResourceRealizationSemanticResult(
  packet: ResourceRealizationSemanticProjectionPacket,
  value: unknown,
): ResourceRealizationSemanticResult {
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
      validatePacketDigest: false,
    },
  )
  if (result.outcome === 'PROJECTED') {
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
  }
  return result as ResourceRealizationSemanticResult
}
