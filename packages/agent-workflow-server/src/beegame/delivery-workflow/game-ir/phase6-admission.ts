import { createHash } from 'node:crypto'
import {
  replayResourceRealizationSemanticReceipt,
  prepareResourceRealizationSemanticProjectionPacket,
  type ResourceRealizationPresentationRequirement,
  type ResourceRealizationSemanticProjectionPacket,
  type ResourceRealizationSemanticProjectionAuthority,
  type ResourceRealizationSemanticReceipt,
} from './resource-realization-producer'
import {
  admitGameIrMechanicalProjectionReceipt,
  gameIrSemanticTargetPointers,
  verifyGameIrSemanticClaimLiteral,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
  parseGameIrModuleCandidate,
  type GameIrModuleCandidate,
  type GameIrNode,
  type GameIrSourceSection,
  type GameIrSourceBinding,
} from './model'
import type { GameIrCompileRequest } from './contracts'
import {
  parseResourceRealizationModule,
  RESOURCE_REALIZATION_DOMAIN_MANIFEST,
  RESOURCE_REALIZATION_RESOURCE_KINDS,
  type ResourceRealizationResourceKind,
} from './resource-realization-schema'
import {
  sectionEvidencePointer,
  type GameIrSemanticSourceSection,
} from './semantic-admission'
import { assembleWorldPresentationClosure } from './world-presentation-assembler'
import {
  createSemanticFidelityPrimitives,
  verifyGameIrSemanticClaimBytes,
} from './semantic-fidelity'
import type { WorldPresentationAssemblyAuthority } from './world-presentation-assembler'

const fidelity = createSemanticFidelityPrimitives(
  'invalid Game IR Phase 6 admission',
)
const { exactKeys, deepFreeze } = fidelity

const CHECK_IDS = Object.freeze([
  'projection.fidelity',
  'projection.completeness',
  'projection.source-bounds',
  'projection.ambiguity',
  'projection.cross-module-invariants',
  'resource.non-empty-module',
  'resource.presentation-coverage',
  'resource.acquisition-profile-closure',
  'resource.variant-artifact-closure',
  'resource.delivery-target',
  'resource.path-safety',
  'resource.ownership-separation',
  'resource.no-observations',
] as const)

type RecordValue = Record<string, unknown>

export type ResourceRealizationSemanticValidationResult = Readonly<
  | {
      outcome: 'PASS'
      packetDigest: string
      checkIds: readonly string[]
      coveredTargets: readonly string[]
    }
  | {
      outcome: 'FAIL'
      packetDigest: string
      reasonCode: 'projection-mismatch' | 'missing-projection'
      actual: string
      missingSubject?: string
      expectedProjection?: string
      evidencePointers: readonly string[]
    }
  | {
      outcome: 'AMBIGUOUS'
      packetDigest: string
      reasonCode: 'ambiguous-projection'
      actual: string
      missingSubject: string
      expectedProjection: string
      evidencePointers: readonly string[]
    }
>

export type ResourceRealizationValidationPreparationAuthority = Readonly<{
  phase5Authority: WorldPresentationAssemblyAuthority
  resourceRealization: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: ResourceRealizationSemanticReceipt
  }>
}>

export type ResourceRealizationSemanticValidationPacket = Readonly<{
  schemaVersion: 'game-ir-resource-realization-semantic-validation-packet.v1'
  taskId: string
  foundationRevision: string
  foundationReceiptDigest: string
  compileRequest: GameIrCompileRequest
  compileRequestDigest: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  authoritySectionIndexDigest: string
  authoritySectionIndex: readonly GameIrSourceSection[]
  sourceSections: readonly GameIrSemanticSourceSection[]
  priorModules: readonly GameIrModuleCandidate[]
  presentationRequirements: readonly ResourceRealizationPresentationRequirement[]
  presentationRequirementsDigest: string
  moduleId: 'resource-realization'
  moduleBytes: string
  moduleDigest: string
  targetManifestDigest: string
  checkIds: readonly string[]
  requiredTargets: readonly string[]
  allowedEvidencePointers: readonly string[]
  packetDigest: string
}>

function fail(message: string): never {
  throw new Error(`invalid Game IR Phase 6 admission: ${message}`)
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

function identity(source: GameIrDomainSourceEnvelope) {
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

function sameIdentity(
  left: ReturnType<typeof identity>,
  right: ReturnType<typeof identity>,
): boolean {
  return canonicalGameIrJson(left) === canonicalGameIrJson(right)
}

function bindSemanticNodes(
  source: GameIrDomainSourceEnvelope,
  receipt: ResourceRealizationSemanticReceipt,
): readonly GameIrNode[] {
  const claims = new Map(
    receipt.sourceClaims.map(claim => [claim.subject, claim]),
  )
  return receipt.nodes.map(node => {
    const bindings: Record<string, GameIrSourceBinding> = {}
    for (const subject of gameIrSemanticTargetPointers([node])) {
      const pointer = subject.slice(`node:${node.id}#`.length)
      const claim = claims.get(`node:${node.id}#${pointer}`)
      if (!claim)
        fail(`semantic source claim is missing for node:${node.id}#${pointer}`)
      try {
        verifyGameIrSemanticClaimLiteral(
          claim,
          node,
          pointer,
          'invalid Game IR Phase 6 admission',
        )
      } catch {
        fail(
          `semantic source claim literal is detached from node:${node.id}#${pointer}`,
        )
      }
      verifyGameIrSemanticClaimBytes(
        source,
        claim,
        'invalid Game IR Phase 6 admission',
      )
      const section = source.sectionIndex.find(
        item =>
          item.documentPath === claim.documentPath &&
          item.sectionId === claim.sectionId,
      )
      if (!section)
        fail(
          `semantic source claim section digest is stale for node:${node.id}#${pointer}`,
        )
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
}

function resourceKindForPresentation(
  kind: string,
): ResourceRealizationResourceKind {
  if (kind === 'ui') return 'ui-asset'
  if ((RESOURCE_REALIZATION_RESOURCE_KINDS as readonly string[]).includes(kind))
    return kind as ResourceRealizationResourceKind
  fail(`Presentation requirement kind ${kind} has no canonical resource kind`)
}

function derivedPresentationNodes(
  requirements: readonly ResourceRealizationPresentationRequirement[],
): readonly GameIrNode[] {
  return requirements.map(requirement => {
    const id = `resource.requirement.${requirement.requirementId}`
    const value = {
      requirementId: requirement.requirementId,
      resourceKind: resourceKindForPresentation(requirement.kind),
      runtimeRole: requirement.runtimeRole,
    }
    const requiredBy = {
      type: 'required-by',
      targetId: requirement.ownerNodeId,
      targetType: requirement.ownerNodeKind,
    }
    const external = (
      pointer: string,
      targetDigest: string,
      derivationRuleId: string,
    ) => ({
      kind: 'derived' as const,
      derivationRuleId,
      inputs: [
        {
          kind: 'external' as const,
          moduleId: 'presentation' as const,
          nodeId: requirement.ownerNodeId,
          pointer,
          targetDigest,
        },
      ],
    })
    return {
      id,
      kind: 'resource-realization.logical-resource',
      producerMode: 'derived' as const,
      value,
      references: [],
      edges: [requiredBy],
      bindings: {
        '/id': external(
          requirement.requirementIdPointer,
          digestGameIrValue(requirement.requirementId),
          'presentation-requirement-id',
        ),
        '/value/requirementId': external(
          requirement.requirementIdPointer,
          digestGameIrValue(requirement.requirementId),
          'presentation-requirement-id',
        ),
        '/value/resourceKind': external(
          requirement.kindPointer,
          digestGameIrValue(requirement.kind),
          'presentation-resource-kind',
        ),
        '/value/runtimeRole': external(
          requirement.runtimeRolePointer,
          digestGameIrValue(requirement.runtimeRole),
          'presentation-runtime-role',
        ),
        '/edges/0': external(
          '/id',
          digestGameIrValue(requirement.ownerNodeId),
          'presentation-requirement-owner',
        ),
      },
    } satisfies GameIrNode
  })
}

function sourceSectionsForPacket(
  source: GameIrDomainSourceEnvelope,
): readonly GameIrSemanticSourceSection[] {
  return Object.freeze(
    source.sectionIndex.map(ref => {
      const bytes = source.sectionBytes[`${ref.documentPath}#${ref.sectionId}`]
      if (bytes === undefined)
        fail('source section bytes are missing from validation packet')
      if (
        createHash('sha256').update(bytes, 'utf8').digest('hex') !== ref.digest
      )
        fail('source section bytes do not match section digest')
      return Object.freeze({ ref: Object.freeze({ ...ref }), bytes })
    }),
  )
}

function ownerEvidencePointers(
  modules: readonly GameIrModuleCandidate[],
  sections: readonly GameIrSemanticSourceSection[],
  authoritySections: readonly GameIrSourceSection[],
): readonly string[] {
  const selected = new Set(
    sections.map(
      section => `${section.ref.documentPath}#${section.ref.sectionId}`,
    ),
  )
  const carried = new Map(
    sections.map(section => [
      `${section.ref.documentPath}#${section.ref.sectionId}`,
      section.bytes,
    ]),
  )
  const authority = new Map(
    authoritySections.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      section.digest,
    ]),
  )
  const pointers: string[] = []
  for (const module of modules) {
    for (const node of module.nodes) {
      for (const [pointer, binding] of Object.entries(node.bindings)) {
        if (binding.kind !== 'owner') continue
        const key = `${binding.documentPath}#${binding.sectionId}`
        if (authority.get(key) !== binding.sectionDigest)
          fail('owner binding is outside authority')
        if (module.moduleId === 'resource-realization') {
          if (!selected.has(key))
            fail('Resource owner binding is outside selected source packet')
          const bytes = carried.get(key)
          if (bytes === undefined)
            fail('Resource owner binding has no carried source bytes')
          verifyCarriedSourcePointer(binding.sourcePointer, bytes)
        }
        pointers.push(`binding:${key}${binding.sourcePointer}`)
      }
    }
  }
  return Object.freeze(
    [
      ...new Set([
        ...pointers,
        ...sections.map(section => sectionEvidencePointer(section.ref)),
      ]),
    ].sort(compareCodeUnits),
  )
}

function verifyCarriedSourcePointer(
  sourcePointer: string,
  bytes: string,
): void {
  const match = /^\/bytes\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/.exec(sourcePointer)
  if (!match)
    fail('Resource owner binding source pointer must address carried bytes')
  const start = Number(match[1])
  const end = Number(match[2])
  const length = Buffer.byteLength(bytes, 'utf8')
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    end > length
  )
    fail('Resource owner binding source pointer is outside carried bytes')
  const buffer = Buffer.from(bytes, 'utf8')
  const boundary = (offset: number) =>
    offset === 0 ||
    offset === buffer.length ||
    (buffer[offset]! & 0xc0) !== 0x80
  if (!boundary(start) || !boundary(end))
    fail('Resource owner binding source pointer is not UTF-8 aligned')
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(
      buffer.subarray(start, end),
    )
  } catch {
    fail('Resource owner binding source pointer is not valid UTF-8')
  }
}

function priorModules(
  closure: ReturnType<typeof assembleWorldPresentationClosure>,
): readonly GameIrModuleCandidate[] {
  return Object.freeze([
    closure.phase4.gameplay.module,
    closure.phase4.balance.module,
    closure.worldScene.module,
    closure.presentation.module,
  ])
}

function moduleWithDerivedNodes(
  source: GameIrDomainSourceEnvelope,
  semantic: ResourceRealizationSemanticReceipt,
  requirements: readonly ResourceRealizationPresentationRequirement[],
  prior: readonly GameIrModuleCandidate[],
): GameIrModuleCandidate {
  const nodes = [
    ...bindSemanticNodes(source, semantic),
    ...derivedPresentationNodes(requirements),
  ]
  const ids = new Set<string>()
  for (const node of nodes) {
    if (ids.has(node.id))
      fail(`resource module contains duplicate node ${node.id}`)
    ids.add(node.id)
  }
  nodes.sort((left, right) => compareCodeUnits(left.id, right.id))
  return parseResourceRealizationModule(
    { moduleId: 'resource-realization', nodes },
    {
      request: source.compileRequest,
      sections: source.authoritySectionIndex,
      externalModules: prior,
    },
  )
}

function packetBody(
  input: Omit<ResourceRealizationSemanticValidationPacket, 'packetDigest'>,
) {
  return input
}

function targetManifestDigest(): string {
  return digestGameIrValue(RESOURCE_REALIZATION_DOMAIN_MANIFEST)
}

function validateAuthorityShape(
  value: unknown,
): asserts value is ResourceRealizationValidationPreparationAuthority {
  if (!isRecord(value)) fail('authority must be a plain object')
  exactKeys(value, ['phase5Authority', 'resourceRealization'], 'authority')
  if (!isRecord(value.resourceRealization))
    fail('resourceRealization authority must be a plain object')
  exactKeys(
    value.resourceRealization,
    ['source', 'mechanical', 'semantic'],
    'resourceRealization authority',
  )
}

export function prepareResourceRealizationSemanticValidationPacket(
  authority: ResourceRealizationValidationPreparationAuthority,
): ResourceRealizationSemanticValidationPacket {
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
  if (
    mechanical.nodes.length !== 0 ||
    mechanical.verifiedClaims.length !== 0 ||
    mechanical.ownedTargets.length !== 0
  )
    fail('Phase 6 mechanical receipt must be empty')
  if (
    !sameIdentity(identity(source), {
      taskId: closure.taskId,
      foundationRevision: closure.foundationRevision,
      foundationReceiptDigest: closure.foundationReceiptDigest,
      compileRequestDigest: closure.compileRequestDigest,
      authoritySectionIndexDigest: closure.authoritySectionIndexDigest,
    })
  )
    fail('resource source is detached from rebuilt Phase 5 authority')
  const projectionPacket = prepareResourceRealizationSemanticProjectionPacket({
    phase5Authority: authority.phase5Authority,
    resourceRealization: { source, mechanical },
  })
  const semantic = replayResourceRealizationSemanticReceipt(
    {
      phase5Authority: authority.phase5Authority,
      resourceRealization: { source, mechanical },
    },
    projectionPacket,
    authority.resourceRealization.semantic,
  )
  const prior = priorModules(closure)
  const module = moduleWithDerivedNodes(
    source,
    semantic,
    projectionPacket.presentationRequirements,
    prior,
  )
  const sourceSections = sourceSectionsForPacket(source)
  const requiredTargets = gameIrSemanticTargetPointers(module.nodes)
  const body = {
    schemaVersion:
      'game-ir-resource-realization-semantic-validation-packet.v1' as const,
    taskId: source.taskId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    foundationReceiptDigest: source.compileRequest.foundation.receiptDigest,
    compileRequest: source.compileRequest,
    compileRequestDigest: digestGameIrValue(source.compileRequest),
    sourceDigest: source.sourceDigest,
    mechanicalReceiptDigest: mechanical.receiptDigest,
    semanticReceiptDigest: semantic.receiptDigest,
    authoritySectionIndexDigest: digestGameIrValue(
      source.authoritySectionIndex,
    ),
    authoritySectionIndex: source.authoritySectionIndex,
    sourceSections,
    priorModules: prior,
    presentationRequirements: projectionPacket.presentationRequirements,
    presentationRequirementsDigest:
      projectionPacket.presentationRequirementsDigest,
    moduleId: 'resource-realization' as const,
    moduleBytes: canonicalGameIrJson(module),
    moduleDigest: digestGameIrValue(module),
    targetManifestDigest: targetManifestDigest(),
    checkIds: CHECK_IDS,
    requiredTargets,
    allowedEvidencePointers: ownerEvidencePointers(
      [module],
      sourceSections,
      source.authoritySectionIndex,
    ),
  } satisfies Omit<ResourceRealizationSemanticValidationPacket, 'packetDigest'>
  return deepFreeze({
    ...body,
    packetDigest: digestGameIrValue(packetBody(body)),
  })
}

export function admitResourceRealizationSemanticValidationResult(
  authority: ResourceRealizationValidationPreparationAuthority,
  packetInput: ResourceRealizationSemanticValidationPacket,
  value: unknown,
): ResourceRealizationSemanticValidationResult {
  const packet = prepareResourceRealizationSemanticValidationPacket(authority)
  if (canonicalGameIrJson(packet) !== canonicalGameIrJson(packetInput))
    fail('validation packet is stale, relabeled, or detached from authority')
  return fidelity.admitValidationResult(value, {
    packetDigest: packet.packetDigest,
    checkIds: packet.checkIds,
    coveredTargets: packet.requiredTargets,
    requiredTargets: packet.requiredTargets,
    allowedEvidencePointers: packet.allowedEvidencePointers,
    evidenceKindPolicy: {
      projectionMismatch: 'any',
      projectionIdentity: 'any',
    },
    messages: {
      resultObject: 'validation result must be a plain object',
      failureResultLabel: 'fidelity failure result',
      failurePacketDigest:
        'fidelity failure packet digest does not match packet',
      evidenceLabel: 'fidelity evidencePointers',
      evidenceStrings: 'fidelity evidencePointers must contain strings',
      evidenceCoverage:
        'fidelity evidencePointers are not exact sorted coverage',
      evidenceSort: 'fidelity evidencePointers are not exact sorted coverage',
    },
  }) as ResourceRealizationSemanticValidationResult
}
