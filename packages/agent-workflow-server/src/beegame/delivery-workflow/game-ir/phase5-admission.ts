import { createHash } from 'node:crypto'
import {
  admitGameIrMechanicalProjectionReceipt,
  admitGameIrDomainSemanticResult,
  gameIrSemanticTargetPointers,
  gameIrSemanticValueLeafPointers,
  verifyGameIrSemanticClaimLiteral,
  normalizeGameIrDomainSemanticPacket,
  normalizeGameIrDomainSemanticReceipt,
  assertDisjointDomainTargets,
  buildGameIrDomainSemanticPacket,
  type GameIrDomainSemanticDiagnostic,
  type GameIrDomainSemanticPacket,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  canonicalGameIrModuleSourceDocuments,
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainId,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import { type GameplayModuleProjection } from './gameplay-balance-assembler'
import { WORLD_SCENE_DOMAIN_MANIFEST } from './world-scene-schema'
import { PRESENTATION_DOMAIN_MANIFEST } from './presentation-schema'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrSourceSectionIndex,
  digestGameIrValue,
  parseGameIrModuleCandidate,
  type GameIrModuleCandidate,
  type GameIrSourceSection,
  canonicalizeGameIrSourceSections,
} from './model'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import {
  createSemanticFidelityPrimitives,
  sectionEvidencePointer,
  verifyGameIrSemanticClaimBytes,
  type GameIrSemanticCandidateNode,
  type GameIrSemanticSourceSection,
  type GameIrSemanticSourceClaim,
  type SemanticValidationResult,
} from './semantic-fidelity'

/*
 * This is the only Phase 5 receipt boundary. Domain producers should pass
 * their worker DTOs here and closure assembly should pass receipts here for
 * replay; neither side owns a parser, canonicalizer, or binding writer.
 */

export type Phase5SemanticCandidateNode = GameIrSemanticCandidateNode

export type Phase5AdmittedSemanticNode = Phase5SemanticCandidateNode &
  Readonly<{ producerMode: 'semantic' }>

export type GameIrDomainSourceClaim = GameIrSemanticSourceClaim

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

export type Phase5SemanticValidationResult = SemanticValidationResult
export type WorldSceneSemanticValidationResult = Phase5SemanticValidationResult
export type PresentationSemanticValidationResult =
  Phase5SemanticValidationResult

export type WorldSceneModuleProjection = Readonly<{
  schemaVersion: 'game-ir-world-scene-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'world-scene' }>
  sourceDigest: string
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  semanticValidationResultDigest: string
  projectionDigest: string
}>

type Phase5SemanticValidationPacketBase = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-validation-packet.v1'
  taskId: string
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  compileRequestDigest: string
  authoritySectionIndexDigest: string
  authoritySectionIndex: readonly GameIrSourceSection[]
  sourceSections: readonly GameIrSemanticSourceSection[]
  moduleBytes: string
  moduleDigest: string
  targetManifestDigest: string
  checkIds: readonly string[]
  requiredTargets: readonly string[]
  allowedEvidencePointers: readonly string[]
  packetDigest: string
}>

export type Phase5SemanticValidationPacket = Readonly<
  Phase5SemanticValidationPacketBase &
    (
      | {
          moduleId: 'world-scene'
          externalProjections: Readonly<{
            gameplay: GameplayModuleProjection
          }>
        }
      | {
          moduleId: 'presentation'
          externalProjections: Readonly<{
            gameplay: GameplayModuleProjection
            worldScene: WorldSceneModuleProjection
          }>
        }
    )
>

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SHA256 = /^[a-f0-9]{64}$/
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const FOUNDATION_DOCUMENT_SET = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)
const fidelity = createSemanticFidelityPrimitives(
  'invalid Game IR Phase 5 admission',
)
const {
  exactKeys,
  strictArray,
  text,
  safeId,
  sha256,
  deepFreeze,
  exactStringCoverage,
} = fidelity

const PHASE5_COMMON_CHECK_IDS = Object.freeze([
  'projection.fidelity',
  'projection.completeness',
  'projection.source-bounds',
  'projection.ambiguity',
  'projection.cross-module-invariants',
] as const)

type Phase5ValidatorDescriptor = Readonly<{
  checkIds: readonly string[]
  sourceDocumentPaths: readonly FoundationDocumentPath[]
  targetManifest: object
}>

const PHASE5_VALIDATOR_DESCRIPTORS: Readonly<
  Record<'world-scene' | 'presentation', Phase5ValidatorDescriptor>
> = Object.freeze({
  'world-scene': Object.freeze({
    checkIds: Object.freeze(
      [...PHASE5_COMMON_CHECK_IDS, 'domain.world-scene'].sort(compareCodeUnits),
    ),
    sourceDocumentPaths: canonicalGameIrModuleSourceDocuments('world-scene'),
    targetManifest: WORLD_SCENE_DOMAIN_MANIFEST,
  }),
  presentation: Object.freeze({
    checkIds: Object.freeze(
      [...PHASE5_COMMON_CHECK_IDS, 'domain.presentation'].sort(
        compareCodeUnits,
      ),
    ),
    sourceDocumentPaths: canonicalGameIrModuleSourceDocuments('presentation'),
    targetManifest: PRESENTATION_DOMAIN_MANIFEST,
  }),
})

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

function packetForSource(
  source: GameIrDomainSourceEnvelope,
  mechanicalReceipt: GameIrMechanicalProjectionReceipt,
  packet: GameIrDomainSemanticPacket,
): GameIrDomainSemanticPacket {
  const normalized = normalizeGameIrDomainSemanticPacket(packet, {
    errorPrefix: 'invalid Game IR Phase 5 admission',
    allowedModuleIds: ['world-scene', 'presentation'],
  })
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

export function admitPhase5SemanticResult(
  packetInput: GameIrDomainSemanticPacket,
  value: unknown,
): Phase5SemanticResult {
  const result = admitGameIrDomainSemanticResult(packetInput, value, {
    errorPrefix: 'invalid Game IR Phase 5 admission',
    allowedModuleIds: ['world-scene', 'presentation'],
    receiptAuthorityDigest: packetInput.packetDigest,
  })
  if (result.moduleId !== 'world-scene' && result.moduleId !== 'presentation')
    fail('semantic result moduleId is not a Phase 5 module')
  return result as Phase5SemanticResult
}

function normalizeStoredReceipt(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): Phase5SemanticReceipt {
  return normalizeGameIrDomainSemanticReceipt(packet, value, {
    errorPrefix: 'invalid Game IR Phase 5 admission',
    allowedModuleIds: ['world-scene', 'presentation'],
    receiptAuthorityDigest: packet.packetDigest,
  }) as Phase5SemanticReceipt
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
  const semantic = normalizeGameIrDomainSemanticReceipt(
    packet,
    input.semantic,
    {
      errorPrefix: 'invalid Game IR Phase 5 admission',
      allowedModuleIds: ['world-scene', 'presentation'],
      receiptAuthorityDigest: packet.packetDigest,
    },
  ) as Phase5SemanticReceipt
  const nodesById = new Map(semantic.nodes.map(node => [node.id, node]))
  for (const claim of semantic.sourceClaims) {
    const separator = claim.subject.indexOf('#')
    const node = nodesById.get(claim.subject.slice('node:'.length, separator))
    if (!node) fail('source claim refers to an unknown semantic node')
    const pointer = claim.subject.slice(separator + 1)
    verifyGameIrSemanticClaimLiteral(
      claim,
      node,
      pointer,
      'invalid Game IR Phase 5 admission',
    )
    verifyGameIrSemanticClaimBytes(
      source,
      claim,
      'invalid Game IR Phase 5 admission',
    )
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
      ...gameIrSemanticValueLeafPointers(node.value),
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
    gameIrSemanticTargetPointers(semantic.nodes),
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

const VALIDATION_PACKET_SCHEMA =
  'game-ir-domain-semantic-validation-packet.v1' as const

function bytesDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function sourceSectionsForPacket(
  source: GameIrDomainSourceEnvelope,
): readonly GameIrSemanticSourceSection[] {
  return Object.freeze(
    source.sectionIndex.map(ref => {
      const bytes = source.sectionBytes[`${ref.documentPath}#${ref.sectionId}`]
      if (bytes === undefined)
        fail('source section bytes are missing from the fidelity packet')
      if (bytesDigest(bytes) !== ref.digest)
        fail('source section bytes do not match their digest')
      return Object.freeze({ ref: Object.freeze({ ...ref }), bytes })
    }),
  )
}

function ownerEvidencePointers(
  module: GameIrModuleCandidate,
  sections: readonly GameIrSemanticSourceSection[],
): readonly string[] {
  const sectionKeys = new Set(
    sections.map(
      section => `${section.ref.documentPath}#${section.ref.sectionId}`,
    ),
  )
  const pointers = module.nodes.flatMap(node =>
    Object.entries(node.bindings).map(([pointer, binding]) => {
      if (binding.kind !== 'owner')
        fail('Phase 5 semantic modules may only contain owner bindings')
      const key = `${binding.documentPath}#${binding.sectionId}`
      const section = sections.find(
        candidate =>
          `${candidate.ref.documentPath}#${candidate.ref.sectionId}` === key,
      )
      if (
        !sectionKeys.has(key) ||
        section?.ref.digest !== binding.sectionDigest
      )
        fail('semantic owner binding is outside the selected source closure')
      return `binding:${key}${binding.sourcePointer}`
    }),
  )
  return Object.freeze([...new Set(pointers)].sort(compareCodeUnits))
}

function phase5TargetManifestDigest(moduleId: 'world-scene' | 'presentation') {
  return digestGameIrValue(
    PHASE5_VALIDATOR_DESCRIPTORS[moduleId].targetManifest,
  )
}

function validatorModule(moduleId: 'world-scene' | 'presentation') {
  return PHASE5_VALIDATOR_DESCRIPTORS[moduleId]
}

function phase5SemanticPacket(
  source: GameIrDomainSourceEnvelope,
  mechanical: GameIrMechanicalProjectionReceipt,
): GameIrDomainSemanticPacket {
  const manifest =
    source.moduleId === 'world-scene'
      ? WORLD_SCENE_DOMAIN_MANIFEST
      : PRESENTATION_DOMAIN_MANIFEST
  const allowedNodeKinds = Object.keys(manifest).sort(compareCodeUnits)
  const allowedRelationshipTypes = [
    ...new Set(
      Object.values(manifest).flatMap(entry =>
        Object.keys(entry.relationships),
      ),
    ),
  ].sort(compareCodeUnits)
  return buildGameIrDomainSemanticPacket({
    source,
    mechanical,
    allowedNodeKinds,
    allowedRelationshipTypes,
  })
}

function externalProjection<T extends Record<string, unknown>>(
  value: unknown,
  source: GameIrDomainSourceEnvelope,
  moduleId: 'gameplay' | 'world-scene',
  schemaVersion: string,
  expectedKeys: readonly string[],
): T {
  if (!isRecord(value)) fail('external projection must be a plain object')
  exactKeys(value, expectedKeys, 'external projection')
  if (value.schemaVersion !== schemaVersion)
    fail('external projection schemaVersion is invalid')
  if (value.taskId !== source.taskId)
    fail('external projection task identity is stale')
  if (
    value.foundationRevision !==
    source.compileRequest.foundation.foundationRevision
  )
    fail('external projection Foundation revision is stale')
  const projectionDigest = sha256(
    value.projectionDigest,
    'external projection projectionDigest',
  )
  const module = parseGameIrModuleCandidate(value.module, {
    request: source.compileRequest,
    sections: source.authoritySectionIndex,
    expectedModuleId: moduleId,
  })
  if (module.nodes.length === 0)
    fail('external projection must contain its replayed module nodes')
  sha256(
    value.mechanicalReceiptDigest,
    'external projection mechanicalReceiptDigest',
  )
  sha256(
    value.semanticReceiptDigest,
    'external projection semanticReceiptDigest',
  )
  if (moduleId === 'world-scene') {
    sha256(value.sourceDigest, 'external projection sourceDigest')
    sha256(
      value.semanticValidationResultDigest,
      'external projection validation digest',
    )
  }
  const { projectionDigest: _projectionDigest, ...withoutDigest } = value
  const body = { ...withoutDigest, module }
  if (projectionDigest !== digestGameIrValue(body))
    fail('external projection digest is stale or invalid')
  return deepFreeze({ ...body, projectionDigest }) as unknown as T
}

function phase5ExternalProjections(
  source: GameIrDomainSourceEnvelope,
  value: unknown,
): Phase5SemanticValidationPacket['externalProjections'] {
  if (!isRecord(value)) fail('externalProjections must be a plain object')
  if (source.moduleId === 'world-scene') {
    exactKeys(value, ['gameplay'], 'world-scene externalProjections')
    return Object.freeze({
      gameplay: externalProjection<GameplayModuleProjection>(
        value.gameplay,
        source,
        'gameplay',
        'game-ir-gameplay-module.v1',
        [
          'schemaVersion',
          'taskId',
          'foundationRevision',
          'module',
          'mechanicalReceiptDigest',
          'semanticReceiptDigest',
          'projectionDigest',
        ],
      ),
    })
  }
  exactKeys(
    value,
    ['gameplay', 'worldScene'],
    'presentation externalProjections',
  )
  return Object.freeze({
    gameplay: externalProjection<GameplayModuleProjection>(
      value.gameplay,
      source,
      'gameplay',
      'game-ir-gameplay-module.v1',
      [
        'schemaVersion',
        'taskId',
        'foundationRevision',
        'module',
        'mechanicalReceiptDigest',
        'semanticReceiptDigest',
        'projectionDigest',
      ],
    ),
    worldScene: externalProjection<WorldSceneModuleProjection>(
      value.worldScene,
      source,
      'world-scene',
      'game-ir-world-scene-module.v1',
      [
        'schemaVersion',
        'taskId',
        'foundationRevision',
        'module',
        'sourceDigest',
        'mechanicalReceiptDigest',
        'semanticReceiptDigest',
        'semanticValidationResultDigest',
        'projectionDigest',
      ],
    ),
  })
}

export function buildPhase5SemanticValidationPacket(
  input: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: Phase5SemanticReceipt
    module: GameIrModuleCandidate
    externalProjections:
      | Readonly<{ gameplay: GameplayModuleProjection }>
      | Readonly<{
          gameplay: GameplayModuleProjection
          worldScene: WorldSceneModuleProjection
        }>
  }>,
): Phase5SemanticValidationPacket {
  if (!isRecord(input)) fail('validation packet input must be a plain object')
  exactKeys(
    input,
    ['source', 'mechanical', 'semantic', 'module', 'externalProjections'],
    'validation packet input',
  )
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== 'world-scene' && source.moduleId !== 'presentation')
    fail('validation packet source must be a Phase 5 module')
  const mechanical = admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: input.mechanical,
  })
  const packet = packetForSource(
    source,
    mechanical,
    phase5SemanticPacket(source, mechanical),
  )
  const semantic = normalizeStoredReceipt(packet, input.semantic)
  const bound = replayAndBindPhase5SemanticReceipt({
    source,
    mechanical,
    packet,
    semantic,
  })
  if (canonicalGameIrJson(input.module) !== canonicalGameIrJson(bound.module))
    fail('validation packet module is detached from the admitted receipt')
  const sourceSections = sourceSectionsForPacket(source)
  const externalProjections = phase5ExternalProjections(
    source,
    input.externalProjections,
  )
  const manifest = validatorModule(source.moduleId)
  const moduleBytes = canonicalGameIrJson(bound.module)
  const requiredTargets = gameIrSemanticTargetPointers(bound.module.nodes)
  const allowedEvidencePointers = Object.freeze(
    [
      ...ownerEvidencePointers(bound.module, sourceSections),
      ...sourceSections.map(section => sectionEvidencePointer(section.ref)),
    ].sort(compareCodeUnits),
  )
  const body = {
    schemaVersion: VALIDATION_PACKET_SCHEMA,
    taskId: source.taskId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    mechanicalReceiptDigest: mechanical.receiptDigest,
    semanticReceiptDigest: semantic.receiptDigest,
    compileRequestDigest: digestGameIrValue(source.compileRequest),
    authoritySectionIndexDigest: digestGameIrValue(
      source.authoritySectionIndex,
    ),
    authoritySectionIndex: source.authoritySectionIndex,
    sourceSections,
    moduleBytes,
    moduleDigest: digestGameIrValue(bound.module),
    targetManifestDigest: phase5TargetManifestDigest(source.moduleId),
    checkIds: Object.freeze([...manifest.checkIds]),
    requiredTargets,
    allowedEvidencePointers,
    moduleId: source.moduleId,
    externalProjections,
  } as const
  return deepFreeze({
    ...body,
    packetDigest: digestGameIrValue(body),
  }) as Phase5SemanticValidationPacket
}

function normalizePacketSourceSections(
  value: unknown,
  moduleId: 'world-scene' | 'presentation',
): readonly GameIrSemanticSourceSection[] {
  const manifest = validatorModule(moduleId)
  const expectedDocuments = new Set<string>(manifest.sourceDocumentPaths)
  const sections = strictArray(value, 'fidelity packet sourceSections').map(
    (entry, index) => {
      if (!isRecord(entry))
        fail(`fidelity packet sourceSections[${index}] must be an object`)
      exactKeys(
        entry,
        ['ref', 'bytes'],
        `fidelity packet sourceSections[${index}]`,
      )
      if (typeof entry.bytes !== 'string')
        fail('fidelity packet source bytes must be text')
      if (!isRecord(entry.ref))
        fail('fidelity packet source ref must be an object')
      exactKeys(
        entry.ref,
        [
          'documentPath',
          'sectionId',
          'heading',
          'startLine',
          'endLine',
          'digest',
        ],
        'fidelity packet source ref',
      )
      const documentPath = text(
        entry.ref.documentPath,
        'source ref documentPath',
      )
      if (!expectedDocuments.has(documentPath))
        fail('fidelity packet source ref is outside the module closure')
      const sectionId = safeId(entry.ref.sectionId, 'source ref sectionId')
      const heading = text(entry.ref.heading, 'source ref heading')
      if (
        typeof entry.ref.startLine !== 'number' ||
        !Number.isSafeInteger(entry.ref.startLine) ||
        entry.ref.startLine < 1 ||
        typeof entry.ref.endLine !== 'number' ||
        !Number.isSafeInteger(entry.ref.endLine) ||
        entry.ref.endLine < entry.ref.startLine
      )
        fail('fidelity packet source line range is invalid')
      const digest = sha256(entry.ref.digest, 'source ref digest')
      if (bytesDigest(entry.bytes) !== digest)
        fail('fidelity packet source bytes do not match their digest')
      return Object.freeze({
        ref: Object.freeze({
          documentPath: documentPath as FoundationDocumentPath,
          sectionId,
          heading,
          startLine: entry.ref.startLine,
          endLine: entry.ref.endLine,
          digest,
        }),
        bytes: entry.bytes,
      })
    },
  )
  const seen = new Set<string>()
  for (const section of sections) {
    const key = `${section.ref.documentPath}#${section.ref.sectionId}`
    if (seen.has(key)) fail('fidelity packet sourceSections contain duplicates')
    seen.add(key)
  }
  for (const documentPath of expectedDocuments)
    if (!sections.some(section => section.ref.documentPath === documentPath))
      fail('fidelity packet sourceSections omit a selected document')
  for (let index = 1; index < sections.length; index += 1) {
    const left = sections[index - 1]!.ref
    const right = sections[index]!.ref
    const leftKey = `${left.documentPath}\0${left.startLine}\0${left.sectionId}`
    const rightKey = `${right.documentPath}\0${right.startLine}\0${right.sectionId}`
    if (compareCodeUnits(leftKey, rightKey) >= 0)
      fail('fidelity packet sourceSections are not canonical')
  }
  return Object.freeze(sections)
}

function normalizeAuthoritySectionIndex(
  value: unknown,
): readonly GameIrSourceSection[] {
  const entries = strictArray(
    value,
    'fidelity packet authoritySectionIndex',
  ).map((entry, index) => {
    if (!isRecord(entry))
      fail(`fidelity packet authoritySectionIndex[${index}] must be an object`)
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
      `fidelity packet authoritySectionIndex[${index}]`,
    )
    const documentPath = text(
      entry.documentPath,
      'authority section documentPath',
    )
    if (!FOUNDATION_DOCUMENT_SET.has(documentPath))
      fail('fidelity packet authority section documentPath is invalid')
    const sectionId = safeId(entry.sectionId, 'authority section sectionId')
    const heading = text(entry.heading, 'authority section heading')
    if (
      typeof entry.startLine !== 'number' ||
      !Number.isSafeInteger(entry.startLine) ||
      entry.startLine < 1 ||
      typeof entry.endLine !== 'number' ||
      !Number.isSafeInteger(entry.endLine) ||
      entry.endLine < entry.startLine
    )
      fail('fidelity packet authority section line range is invalid')
    return {
      documentPath: documentPath as FoundationDocumentPath,
      sectionId,
      heading,
      startLine: entry.startLine,
      endLine: entry.endLine,
      digest: sha256(entry.digest, 'authority section digest'),
    }
  })
  let canonical: readonly GameIrSourceSection[]
  try {
    canonical = canonicalizeGameIrSourceSections(entries)
  } catch {
    fail('fidelity packet authoritySectionIndex contains duplicates')
  }
  if (
    entries.some(
      (entry, index) =>
        !sameSourceSection(entry, canonical[index] as GameIrSourceSection),
    )
  )
    fail('fidelity packet authoritySectionIndex is not canonical')
  for (const documentPath of CANONICAL_FOUNDATION_DOCUMENTS)
    if (!canonical.some(section => section.documentPath === documentPath))
      fail('fidelity packet authoritySectionIndex omits a canonical document')
  return deepFreeze(canonical.map(section => Object.freeze({ ...section })))
}

function sameSourceSection(
  left: GameIrSourceSection,
  right: GameIrSourceSection,
): boolean {
  return (
    left.documentPath === right.documentPath &&
    left.sectionId === right.sectionId &&
    left.heading === right.heading &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine &&
    left.digest === right.digest
  )
}

function normalizePacketProjection(
  value: unknown,
  source: Pick<GameIrDomainSourceEnvelope, 'taskId'> & {
    foundationRevision: string
  },
  authoritySectionIndex: readonly GameIrSourceSection[],
  moduleId: 'gameplay' | 'world-scene',
  schemaVersion: string,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value))
    fail('fidelity packet external projection must be an object')
  exactKeys(value, expectedKeys, 'fidelity packet external projection')
  if (value.schemaVersion !== schemaVersion || value.taskId !== source.taskId)
    fail('fidelity packet external projection identity is stale')
  if (value.foundationRevision !== source.foundationRevision)
    fail('fidelity packet external projection revision is stale')
  sha256(
    value.mechanicalReceiptDigest,
    'fidelity packet projection mechanicalReceiptDigest',
  )
  sha256(
    value.semanticReceiptDigest,
    'fidelity packet projection semanticReceiptDigest',
  )
  if (moduleId === 'world-scene')
    sha256(value.sourceDigest, 'fidelity packet projection sourceDigest')
  const module = parseGameIrModuleCandidate(value.module, {
    request: packetParseRequest(
      source.taskId,
      source.foundationRevision,
      authoritySectionIndex,
    ),
    sections: authoritySectionIndex,
    expectedModuleId: moduleId,
  })
  if (module.nodes.length === 0)
    fail('fidelity packet external projection module must be non-empty')
  const { projectionDigest: _projectionDigest, ...withoutDigest } = value
  const body: Record<string, unknown> = { ...withoutDigest, module }
  if (moduleId === 'world-scene')
    sha256(body.sourceDigest, 'world-scene projection sourceDigest')
  sha256(body.mechanicalReceiptDigest, 'projection mechanicalReceiptDigest')
  sha256(body.semanticReceiptDigest, 'projection semanticReceiptDigest')
  if (
    moduleId === 'world-scene' &&
    expectedKeys.includes('semanticValidationResultDigest')
  )
    sha256(
      body.semanticValidationResultDigest,
      'world-scene projection validation digest',
    )
  const projectionDigest = sha256(
    value.projectionDigest,
    'projection projectionDigest',
  )
  if (projectionDigest !== digestGameIrValue(body))
    fail('fidelity packet external projection digest is stale')
  return deepFreeze({ ...body, projectionDigest })
}

function packetParseRequest(
  taskId: string,
  foundationRevision: string,
  authoritySectionIndex: readonly GameIrSourceSection[],
): GameIrCompileRequest {
  const documentDigests = Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(documentPath => [
      documentPath,
      authoritySectionIndex.find(
        section => section.documentPath === documentPath,
      )?.digest ?? '0'.repeat(64),
    ]),
  ) as FoundationReadyReceipt['documentDigests']
  const foundationBody: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'phase5-validation',
    foundationRevision,
    confirmedBriefDigest: '0'.repeat(64),
    documentDigests,
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestGameIrSourceSectionIndex(authoritySectionIndex),
    authority: {
      kind: 'review',
      reviewDigest: '0'.repeat(64),
      issueRegistryDigest: '0'.repeat(64),
    },
  }
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId,
    publicationId: 'phase5-validation',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundationBody,
      receiptDigest: digestGameIrValue(foundationBody),
    },
  }
}

function normalizeValidationPacket(value: unknown): {
  packet: Phase5SemanticValidationPacket
  module: GameIrModuleCandidate
} {
  if (!isRecord(value)) fail('fidelity validation packet must be an object')
  const baseKeys = [
    'schemaVersion',
    'taskId',
    'foundationRevision',
    'sourceDigest',
    'mechanicalReceiptDigest',
    'semanticReceiptDigest',
    'compileRequestDigest',
    'authoritySectionIndexDigest',
    'authoritySectionIndex',
    'sourceSections',
    'moduleBytes',
    'moduleDigest',
    'targetManifestDigest',
    'checkIds',
    'requiredTargets',
    'allowedEvidencePointers',
    'packetDigest',
    'moduleId',
    'externalProjections',
  ] as const
  exactKeys(value, [...baseKeys], 'fidelity validation packet')
  if (value.schemaVersion !== VALIDATION_PACKET_SCHEMA)
    fail('fidelity validation packet schemaVersion is invalid')
  const moduleId = value.moduleId
  if (moduleId !== 'world-scene' && moduleId !== 'presentation')
    fail('fidelity validation packet moduleId is invalid')
  const taskId = text(value.taskId, 'fidelity packet taskId')
  const foundationRevision = text(
    value.foundationRevision,
    'fidelity packet foundationRevision',
  )
  const sourceDigest = sha256(
    value.sourceDigest,
    'fidelity packet sourceDigest',
  )
  const mechanicalReceiptDigest = sha256(
    value.mechanicalReceiptDigest,
    'fidelity packet mechanicalReceiptDigest',
  )
  const semanticReceiptDigest = sha256(
    value.semanticReceiptDigest,
    'fidelity packet semanticReceiptDigest',
  )
  const compileRequestDigest = sha256(
    value.compileRequestDigest,
    'fidelity packet compileRequestDigest',
  )
  const authoritySectionIndexDigest = sha256(
    value.authoritySectionIndexDigest,
    'fidelity packet authoritySectionIndexDigest',
  )
  const authoritySectionIndex = normalizeAuthoritySectionIndex(
    value.authoritySectionIndex,
  )
  if (authoritySectionIndexDigest !== digestGameIrValue(authoritySectionIndex))
    fail('fidelity packet authoritySectionIndexDigest is stale')
  const sourceSections = normalizePacketSourceSections(
    value.sourceSections,
    moduleId,
  )
  const expectedSelectedSections = authoritySectionIndex.filter(section =>
    validatorModule(moduleId).sourceDocumentPaths.includes(
      section.documentPath,
    ),
  )
  if (
    sourceSections.length !== expectedSelectedSections.length ||
    sourceSections.some(
      (section, index) =>
        !sameSourceSection(
          section.ref,
          expectedSelectedSections[index] as GameIrSourceSection,
        ),
    )
  )
    fail('fidelity packet selected source closure is not exact')
  const moduleBytes = text(value.moduleBytes, 'fidelity packet moduleBytes')
  let rawModule: unknown
  try {
    rawModule = JSON.parse(moduleBytes)
  } catch {
    fail('fidelity packet moduleBytes must contain JSON')
  }
  const module = parseGameIrModuleCandidate(rawModule, {
    request: packetParseRequest(
      taskId,
      foundationRevision,
      authoritySectionIndex,
    ),
    sections: authoritySectionIndex,
    expectedModuleId: moduleId,
  })
  if (canonicalGameIrJson(module) !== moduleBytes)
    fail('fidelity packet moduleBytes are not canonical')
  if (module.nodes.some(node => node.producerMode !== 'semantic'))
    fail('fidelity packet semantic module nodes must be semantic')
  const moduleDigest = sha256(
    value.moduleDigest,
    'fidelity packet moduleDigest',
  )
  if (moduleDigest !== digestGameIrValue(module))
    fail('fidelity packet moduleDigest is stale')
  const manifest = validatorModule(moduleId)
  const checkIds = exactStringCoverage(
    value.checkIds,
    manifest.checkIds,
    'fidelity packet checkIds',
  )
  const requiredTargets = exactStringCoverage(
    value.requiredTargets,
    gameIrSemanticTargetPointers(module.nodes),
    'fidelity packet requiredTargets',
  )
  const expectedEvidence = [
    ...ownerEvidencePointers(module, sourceSections),
    ...sourceSections.map(section => sectionEvidencePointer(section.ref)),
  ].sort(compareCodeUnits)
  const allowedEvidencePointers = exactStringCoverage(
    value.allowedEvidencePointers,
    expectedEvidence,
    'fidelity packet allowedEvidencePointers',
  )
  const targetManifestDigest = sha256(
    value.targetManifestDigest,
    'fidelity packet targetManifestDigest',
  )
  if (targetManifestDigest !== phase5TargetManifestDigest(moduleId))
    fail('fidelity packet target manifest digest is stale')
  const source = {
    taskId,
    foundationRevision,
  }
  let externalProjections: Phase5SemanticValidationPacket['externalProjections']
  if (moduleId === 'world-scene') {
    if (!isRecord(value.externalProjections))
      fail('world-scene externalProjections must be an object')
    exactKeys(
      value.externalProjections,
      ['gameplay'],
      'world-scene externalProjections',
    )
    externalProjections = Object.freeze({
      gameplay: normalizePacketProjection(
        value.externalProjections.gameplay,
        source,
        authoritySectionIndex,
        'gameplay',
        'game-ir-gameplay-module.v1',
        [
          'schemaVersion',
          'taskId',
          'foundationRevision',
          'module',
          'mechanicalReceiptDigest',
          'semanticReceiptDigest',
          'projectionDigest',
        ],
      ) as GameplayModuleProjection,
    })
  } else {
    if (!isRecord(value.externalProjections))
      fail('presentation externalProjections must be an object')
    exactKeys(
      value.externalProjections,
      ['gameplay', 'worldScene'],
      'presentation externalProjections',
    )
    externalProjections = Object.freeze({
      gameplay: normalizePacketProjection(
        value.externalProjections.gameplay,
        source,
        authoritySectionIndex,
        'gameplay',
        'game-ir-gameplay-module.v1',
        [
          'schemaVersion',
          'taskId',
          'foundationRevision',
          'module',
          'mechanicalReceiptDigest',
          'semanticReceiptDigest',
          'projectionDigest',
        ],
      ) as GameplayModuleProjection,
      worldScene: normalizePacketProjection(
        value.externalProjections.worldScene,
        source,
        authoritySectionIndex,
        'world-scene',
        'game-ir-world-scene-module.v1',
        [
          'schemaVersion',
          'taskId',
          'foundationRevision',
          'module',
          'sourceDigest',
          'mechanicalReceiptDigest',
          'semanticReceiptDigest',
          'semanticValidationResultDigest',
          'projectionDigest',
        ],
      ) as WorldSceneModuleProjection,
    })
  }
  const body = {
    schemaVersion: VALIDATION_PACKET_SCHEMA,
    taskId,
    foundationRevision,
    sourceDigest,
    mechanicalReceiptDigest,
    semanticReceiptDigest,
    compileRequestDigest,
    authoritySectionIndexDigest,
    authoritySectionIndex,
    sourceSections,
    moduleBytes,
    moduleDigest,
    targetManifestDigest,
    checkIds,
    requiredTargets,
    allowedEvidencePointers,
    moduleId,
    externalProjections,
  } as const
  const packetDigest = sha256(
    value.packetDigest,
    'fidelity packet packetDigest',
  )
  if (packetDigest !== digestGameIrValue(body))
    fail('fidelity validation packet digest is stale')
  return {
    packet: deepFreeze({
      ...body,
      packetDigest,
    }) as Phase5SemanticValidationPacket,
    module,
  }
}

export function admitPhase5SemanticValidationResult(
  packetInput: Phase5SemanticValidationPacket,
  value: unknown,
): Phase5SemanticValidationResult {
  const validated = normalizeValidationPacket(packetInput)
  return fidelity.admitValidationResult(value, {
    packetDigest: validated.packet.packetDigest,
    checkIds: validated.packet.checkIds,
    requiredTargets: validated.packet.requiredTargets,
    allowedEvidencePointers: validated.packet.allowedEvidencePointers,
  }) as Phase5SemanticValidationResult
}
