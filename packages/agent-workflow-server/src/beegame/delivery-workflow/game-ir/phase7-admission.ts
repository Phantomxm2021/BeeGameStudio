import { createHash } from 'node:crypto'
import { assembleResourceRealizationClosure } from './resource-realization-assembler'
import {
  admitGameIrMechanicalProjectionReceipt,
  gameIrSemanticTargetPointers,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import type { GameIrCompileRequest } from './contracts'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
  type GameIrModuleCandidate,
  type GameIrSourceSection,
} from './model'
import {
  buildImplementationVerificationSemanticPacket,
  prepareImplementationVerificationModule,
  replayImplementationVerificationSemanticReceipt,
  type ImplementationVerificationSemanticProjectionAuthority,
  type ImplementationVerificationSemanticReceipt,
} from './implementation-verification-producer'
import { IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST } from './implementation-verification-schema'
import {
  createSemanticFidelityPrimitives,
  sectionEvidencePointer,
  type GameIrSemanticSourceSection,
  type SemanticValidationResult,
} from './semantic-fidelity'

const ERROR_PREFIX = 'invalid Game IR Phase 7 admission'
const fidelity = createSemanticFidelityPrimitives(ERROR_PREFIX)
const { exactKeys, strictArray, deepFreeze } = fidelity

const CHECK_IDS = Object.freeze([
  'implementation.source-fidelity',
  'implementation.projection-completeness',
  'implementation.prior-closure',
  'implementation.ownership',
  'implementation.dependency',
  'implementation.scenario',
  'implementation.invariant',
  'implementation.proof-closure',
  'implementation.no-actual-evidence',
] as const)

export type ImplementationVerificationValidationPreparationAuthority =
  Readonly<{
    phase6Authority: Parameters<typeof assembleResourceRealizationClosure>[0]
    implementationVerification: Readonly<{
      source: GameIrDomainSourceEnvelope
      mechanical: GameIrMechanicalProjectionReceipt
      semantic: ImplementationVerificationSemanticReceipt
    }>
  }>

export type ImplementationVerificationSemanticValidationPacket = Readonly<{
  schemaVersion: 'game-ir-implementation-verification-semantic-validation-packet.v1'
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
  moduleId: 'implementation-verification'
  moduleBytes: string
  moduleDigest: string
  targetManifestDigest: string
  checkIds: readonly string[]
  requiredTargets: readonly string[]
  allowedEvidencePointers: readonly string[]
  packetDigest: string
}>

type RecordValue = Record<string, unknown>

function fail(message: string): never {
  throw new Error(`${ERROR_PREFIX}: ${message}`)
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

function strictData(value: unknown, label: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} must be JSON data`)
    return value
  }
  if (Array.isArray(value)) {
    const array = strictArray(value, label)
    const output: unknown[] = []
    for (let index = 0; index < array.length; index += 1)
      output.push(strictData(array[index], `${label}[${index}]`))
    return output
  }
  if (!isRecord(value)) fail(`${label} must be plain JSON data`)
  const output: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(`${label} has a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${label} has a hidden or accessor property`)
    output[key] = strictData(descriptor.value, `${label}.${key}`)
  }
  return output
}

function normalizeValidationPacket(
  value: unknown,
): ImplementationVerificationSemanticValidationPacket {
  if (!isRecord(value)) fail('validation packet must be a plain object')
  exactKeys(
    value,
    [
      'schemaVersion',
      'taskId',
      'foundationRevision',
      'foundationReceiptDigest',
      'compileRequest',
      'compileRequestDigest',
      'sourceDigest',
      'mechanicalReceiptDigest',
      'semanticReceiptDigest',
      'authoritySectionIndexDigest',
      'authoritySectionIndex',
      'sourceSections',
      'priorModules',
      'moduleId',
      'moduleBytes',
      'moduleDigest',
      'targetManifestDigest',
      'checkIds',
      'requiredTargets',
      'allowedEvidencePointers',
      'packetDigest',
    ],
    'validation packet',
  )
  const normalized = Object.fromEntries(
    Object.keys(value).map(key => [
      key,
      strictData(value[key], `validation packet.${key}`),
    ]),
  )
  return deepFreeze(
    normalized as ImplementationVerificationSemanticValidationPacket,
  )
}

function validateAuthorityShape(
  value: unknown,
): asserts value is ImplementationVerificationValidationPreparationAuthority {
  if (!isRecord(value)) fail('authority must be a plain object')
  exactKeys(
    value,
    ['phase6Authority', 'implementationVerification'],
    'authority',
  )
  if (!isRecord(value.implementationVerification))
    fail('implementationVerification authority must be a plain object')
  exactKeys(
    value.implementationVerification,
    ['source', 'mechanical', 'semantic'],
    'implementationVerification authority',
  )
}

function sameIdentity(
  source: GameIrDomainSourceEnvelope,
  closure: ReturnType<typeof assembleResourceRealizationClosure>,
  phase6Authority: Parameters<typeof assembleResourceRealizationClosure>[0],
): boolean {
  return (
    source.taskId === closure.taskId &&
    source.compileRequest.foundation.foundationRevision ===
      closure.foundationRevision &&
    source.compileRequest.foundation.receiptDigest ===
      closure.foundationReceiptDigest &&
    digestGameIrValue(source.compileRequest) === closure.compileRequestDigest &&
    digestGameIrValue(source.authoritySectionIndex) ===
      closure.authoritySectionIndexDigest &&
    canonicalGameIrJson(source.compileRequest) ===
      canonicalGameIrJson(
        phase6Authority.phase5Authority.phase4Authority.gameplay.source
          .compileRequest,
      ) &&
    canonicalGameIrJson(source.authoritySectionIndex) ===
      canonicalGameIrJson(
        phase6Authority.phase5Authority.phase4Authority.gameplay.source
          .authoritySectionIndex,
      )
  )
}

function sourceSectionsForPacket(
  source: GameIrDomainSourceEnvelope,
): readonly GameIrSemanticSourceSection[] {
  return Object.freeze(
    source.sectionIndex.map(ref => {
      const bytes = source.sectionBytes[`${ref.documentPath}#${ref.sectionId}`]
      if (bytes === undefined) fail('source section bytes are missing')
      if (
        createHash('sha256').update(bytes, 'utf8').digest('hex') !== ref.digest
      )
        fail('source section bytes do not match section digest')
      return Object.freeze({ ref: Object.freeze({ ...ref }), bytes })
    }),
  )
}

function ownerEvidencePointers(
  module: GameIrModuleCandidate,
  sourceSections: readonly GameIrSemanticSourceSection[],
  authoritySections: readonly GameIrSourceSection[],
): readonly string[] {
  const sourceKeys = new Set(
    sourceSections.map(
      section => `${section.ref.documentPath}#${section.ref.sectionId}`,
    ),
  )
  const authority = new Map(
    authoritySections.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      section.digest,
    ]),
  )
  const pointers: string[] = []
  for (const node of module.nodes) {
    for (const [pointer, binding] of Object.entries(node.bindings)) {
      if (binding.kind !== 'owner') continue
      const key = `${binding.documentPath}#${binding.sectionId}`
      if (!sourceKeys.has(key) || authority.get(key) !== binding.sectionDigest)
        fail('owner binding is outside the exact source closure')
      pointers.push(`binding:${key}${binding.sourcePointer}`)
    }
  }
  return Object.freeze(
    [
      ...new Set([
        ...pointers,
        ...sourceSections.map(section => sectionEvidencePointer(section.ref)),
      ]),
    ].sort(compareCodeUnits),
  )
}

function priorModules(
  closure: ReturnType<typeof assembleResourceRealizationClosure>,
): readonly GameIrModuleCandidate[] {
  return Object.freeze([
    closure.phase5.phase4.gameplay.module,
    closure.phase5.phase4.balance.module,
    closure.phase5.worldScene.module,
    closure.phase5.presentation.module,
    closure.resourceRealization.module,
  ])
}

function rebuiltPacket(
  authority: ImplementationVerificationValidationPreparationAuthority,
): ImplementationVerificationSemanticValidationPacket {
  validateAuthorityShape(authority)
  const phase6 = assembleResourceRealizationClosure(authority.phase6Authority)
  const source = validateGameIrDomainSourceEnvelope(
    authority.implementationVerification.source,
  )
  if (source.moduleId !== 'implementation-verification')
    fail('source moduleId must be implementation-verification')
  const mechanical = admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: authority.implementationVerification.mechanical,
  })
  if (
    mechanical.nodes.length !== 0 ||
    mechanical.verifiedClaims.length !== 0 ||
    mechanical.ownedTargets.length !== 0
  )
    fail('Phase 7 mechanical receipt must be empty')
  if (!sameIdentity(source, phase6, authority.phase6Authority))
    fail(
      'Implementation/Verification source is detached from Phase 6 authority',
    )
  const semanticAuthority: ImplementationVerificationSemanticProjectionAuthority =
    {
      source,
      mechanical,
    }
  const semanticPacket =
    buildImplementationVerificationSemanticPacket(semanticAuthority)
  const semantic = replayImplementationVerificationSemanticReceipt(
    semanticAuthority,
    semanticPacket,
    authority.implementationVerification.semantic,
  )
  const module = prepareImplementationVerificationModule({
    source,
    mechanical,
    semantic,
    priorModules: priorModules(phase6),
  }).module
  const sourceSections = sourceSectionsForPacket(source)
  const body = {
    schemaVersion:
      'game-ir-implementation-verification-semantic-validation-packet.v1' as const,
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
    priorModules: priorModules(phase6),
    moduleId: 'implementation-verification' as const,
    moduleBytes: canonicalGameIrJson(module),
    moduleDigest: digestGameIrValue(module),
    targetManifestDigest: digestGameIrValue(
      IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST,
    ),
    checkIds: CHECK_IDS,
    requiredTargets: gameIrSemanticTargetPointers(module.nodes),
    allowedEvidencePointers: ownerEvidencePointers(
      module,
      sourceSections,
      source.authoritySectionIndex,
    ),
  } satisfies Omit<
    ImplementationVerificationSemanticValidationPacket,
    'packetDigest'
  >
  return deepFreeze({ ...body, packetDigest: digestGameIrValue(body) })
}

export function prepareImplementationVerificationSemanticValidationPacket(
  authority: ImplementationVerificationValidationPreparationAuthority,
): ImplementationVerificationSemanticValidationPacket {
  return rebuiltPacket(authority)
}

export function admitImplementationVerificationSemanticValidationResult(
  authority: ImplementationVerificationValidationPreparationAuthority,
  packetInput: ImplementationVerificationSemanticValidationPacket,
  value: unknown,
): SemanticValidationResult {
  const packet = rebuiltPacket(authority)
  const normalizedInput = normalizeValidationPacket(packetInput)
  if (canonicalGameIrJson(packet) !== canonicalGameIrJson(normalizedInput))
    fail('validation packet is stale, relabeled, or detached from authority')
  return fidelity.admitValidationResult(value, {
    packetDigest: packet.packetDigest,
    checkIds: packet.checkIds,
    requiredTargets: packet.requiredTargets,
    allowedEvidencePointers: packet.allowedEvidencePointers,
  })
}
