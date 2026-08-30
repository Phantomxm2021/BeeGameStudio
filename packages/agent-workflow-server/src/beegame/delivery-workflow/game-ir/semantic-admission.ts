import { createHash } from 'node:crypto'
import {
  parseGameIrCompileRequest,
  type GameIrCompileRequest,
} from './contracts'
import {
  canonicalGameIrJson,
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrModuleCandidate,
  type GameIrSourceSection,
} from './model'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import { digestSectionIndex } from '../foundation-section-index'

export const GAME_IR_SEMANTIC_VALIDATOR_MANIFEST_VERSION =
  'game-ir-semantic-validator-manifest.v1' as const

export type GameIrSemanticValidatorModule = Readonly<{
  moduleId:
    | 'core'
    | 'gameplay'
    | 'balance'
    | 'world-scene'
    | 'presentation'
    | 'resource-realization'
    | 'implementation-verification'
  checkIds: readonly string[]
  sourceDocumentPaths: readonly FoundationDocumentPath[]
}>

export type GameIrSemanticValidatorManifest = Readonly<{
  schemaVersion: typeof GAME_IR_SEMANTIC_VALIDATOR_MANIFEST_VERSION
  modules: readonly GameIrSemanticValidatorModule[]
  digest: string
}>

export type GameIrSemanticSourceSection = Readonly<{
  ref: GameIrSourceSection
  bytes: string
}>

export type GameIrSemanticValidationPacket = Readonly<{
  schemaVersion: 'game-ir-semantic-validation-packet.v1'
  compileRequest: GameIrCompileRequest
  taskId: string
  publicationId: string
  foundationRevision: string
  foundationReceiptDigest: string
  sectionIndexDigest: string
  sectionIndex: readonly GameIrSourceSection[]
  candidateBytes: string
  candidateDigest: string
  moduleId: GameIrSemanticValidatorModule['moduleId']
  validatorManifestVersion: typeof GAME_IR_SEMANTIC_VALIDATOR_MANIFEST_VERSION
  validatorManifestDigest: string
  checkIds: readonly string[]
  sourceSections: readonly GameIrSemanticSourceSection[]
  allowedEvidencePointers: readonly string[]
  packetDigest: string
}>

export type GameIrSemanticValidationResult = Readonly<
  | { outcome: 'PASS'; packetDigest: string; checkIds: readonly string[] }
  | {
      outcome: 'FAIL'
      packetDigest: string
      reasonCode: string
      actual: string
      evidencePointers: readonly string[]
    }
  | {
      outcome: 'AMBIGUOUS'
      packetDigest: string
      reasonCode: string
      actual: string
      evidencePointers: readonly string[]
    }
>

export type GameIrSemanticValidationPacketInput = Readonly<{
  candidate: GameIrCandidate
  request: GameIrCompileRequest
  sectionIndex: readonly GameIrSourceSection[]
  moduleId: string
  sectionBytes: ReadonlyMap<string, string> | Readonly<Record<string, string>>
}>

const MODULE_IDS: readonly GameIrSemanticValidatorModule['moduleId'][] = [
  'balance',
  'core',
  'gameplay',
  'implementation-verification',
  'presentation',
  'resource-realization',
  'world-scene',
]

const COMMON_CHECK_IDS = [
  'projection.fidelity',
  'projection.completeness',
  'projection.source-bounds',
  'projection.ambiguity',
  'projection.cross-module-invariants',
] as const

const DOMAIN_CHECK_IDS: Record<
  GameIrSemanticValidatorModule['moduleId'],
  string
> = {
  core: 'domain.core',
  gameplay: 'domain.gameplay',
  balance: 'domain.balance',
  'world-scene': 'domain.world-scene',
  presentation: 'domain.presentation',
  'resource-realization': 'domain.resource-realization',
  'implementation-verification': 'domain.implementation-verification',
}

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const FOUNDATION_DOCUMENTS = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)
const SECTION_EVIDENCE_REASON_CODES: readonly string[] = Object.freeze([
  'ambiguous-projection',
  'missing-projection',
])

function fail(message: string): never {
  throw new Error(`invalid Game IR semantic admission: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some(key => typeof key !== 'string'))
    fail(`${label} has an unknown symbol key`)
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    )
      fail(`${label} has a non-JSON property`)
  }
  const actual = ownKeys as string[]
  actual.sort()
  const wanted = [...expected].sort()
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

function id(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SAFE_ID.test(result)) fail(`${label} is not a safe identifier`)
  return result
}

function digest(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SHA256.test(result)) fail(`${label} must be a SHA-256 digest`)
  return result
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function deepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  return Object.values(value as Record<string, unknown>).every(child =>
    deepFrozen(child, seen),
  )
}

function sectionKey(
  value: Pick<GameIrSourceSection, 'documentPath' | 'sectionId'>,
): string {
  return `${value.documentPath}#${value.sectionId}`
}

function sameSection(
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

function ownerEvidencePointer(binding: {
  documentPath: FoundationDocumentPath
  sectionId: string
  sourcePointer: string
}): string {
  return `binding:${binding.documentPath}#${binding.sectionId}${binding.sourcePointer}`
}

function sectionEvidencePointer(ref: GameIrSourceSection): string {
  return `section:${ref.documentPath}#${ref.sectionId}@${ref.digest}`
}

function sectionOrder(
  left: GameIrSourceSection,
  right: GameIrSourceSection,
): number {
  return `${left.documentPath}\0${left.startLine}\0${left.sectionId}`.localeCompare(
    `${right.documentPath}\0${right.startLine}\0${right.sectionId}`,
  )
}

function normalizeSection(value: unknown, label: string): GameIrSourceSection {
  if (!isRecord(value)) fail(`${label} must be an object`)
  exactKeys(
    value,
    ['documentPath', 'sectionId', 'heading', 'startLine', 'endLine', 'digest'],
    label,
  )
  const documentPath = text(value.documentPath, `${label} documentPath`)
  if (!FOUNDATION_DOCUMENTS.has(documentPath))
    fail(`${label} documentPath is not canonical`)
  const sectionId = id(value.sectionId, `${label} sectionId`)
  const heading = text(value.heading, `${label} heading`)
  if (
    typeof value.startLine !== 'number' ||
    !Number.isSafeInteger(value.startLine) ||
    value.startLine < 1 ||
    typeof value.endLine !== 'number' ||
    !Number.isSafeInteger(value.endLine) ||
    value.endLine < value.startLine
  )
    fail(`${label} line range is invalid`)
  const sectionDigest = digest(value.digest, `${label} digest`)
  return {
    documentPath: documentPath as FoundationDocumentPath,
    sectionId,
    heading,
    startLine: value.startLine,
    endLine: value.endLine,
    digest: sectionDigest,
  }
}

function normalizeSectionIndex(value: unknown): readonly GameIrSourceSection[] {
  const dense = strictArray(value, 'sectionIndex')
  const output = dense.map((item, index) =>
    Object.freeze(normalizeSection(item, `sectionIndex[${index}]`)),
  )
  const identities = new Set(output.map(sectionKey))
  if (identities.size !== output.length)
    fail('sectionIndex contains duplicate sections')
  for (let index = 1; index < output.length; index += 1) {
    if (sectionOrder(output[index - 1]!, output[index]!) >= 0)
      fail('sectionIndex must be in canonical order')
  }
  const coveredDocuments = new Set(output.map(section => section.documentPath))
  for (const documentPath of CANONICAL_FOUNDATION_DOCUMENTS) {
    if (!coveredDocuments.has(documentPath))
      fail(`sectionIndex is missing canonical document ${documentPath}`)
  }
  return Object.freeze(output)
}

function strictArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    lengthDescriptor.value !== value.length ||
    lengthDescriptor.enumerable !== false ||
    lengthDescriptor.configurable !== false
  )
    fail(`${label} has an invalid length property`)
  const ownKeys = Reflect.ownKeys(value)
  const expectedKeys = new Set<string>([
    'length',
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ])
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some(key => typeof key !== 'string' || !expectedKeys.has(key))
  )
    fail(`${label} must be a dense JSON array without custom properties`)
  const normalized: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (
      !descriptor ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    )
      fail(`${label}[${index}] must be a dense data property`)
    normalized.push(descriptor.value)
  }
  return normalized
}

function manifestWithoutDigest(): Omit<
  GameIrSemanticValidatorManifest,
  'digest'
> {
  const modules = MODULE_IDS.map(moduleId => {
    const checkIds = [...COMMON_CHECK_IDS, DOMAIN_CHECK_IDS[moduleId]].sort(
      compare,
    )
    const sourceDocumentPaths = {
      core: ['docs/GDD.md'],
      gameplay: ['docs/GDD.md'],
      balance: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
      'world-scene': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
      presentation: [
        'docs/GDD.md',
        'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md',
        'docs/AUDIO_DESIGN.md',
      ],
      'resource-realization': [
        'docs/ASSET_PLAN.md',
        'docs/TECHNICAL_DESIGN.md',
        'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md',
        'docs/AUDIO_DESIGN.md',
        'docs/LEVEL_SCENE_DESIGN.md',
      ],
      'implementation-verification': [
        'docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md',
        'docs/BALANCE_DESIGN.md',
        'docs/TECHNICAL_DESIGN.md',
      ],
    }[moduleId].sort(compare) as FoundationDocumentPath[]
    return Object.freeze({
      moduleId,
      checkIds: Object.freeze(checkIds),
      sourceDocumentPaths: Object.freeze(sourceDocumentPaths),
    })
  })
  return {
    schemaVersion: GAME_IR_SEMANTIC_VALIDATOR_MANIFEST_VERSION,
    modules: Object.freeze(modules),
  }
}

const manifestBody = manifestWithoutDigest()
export const GAME_IR_SEMANTIC_VALIDATOR_MANIFEST: GameIrSemanticValidatorManifest =
  Object.freeze({
    ...manifestBody,
    digest: sha256(canonicalGameIrJson(manifestBody)),
  })

function moduleManifest(moduleId: unknown): GameIrSemanticValidatorModule {
  const module = GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.find(
    item => item.moduleId === moduleId,
  )
  if (!module) fail('moduleId is not a canonical validator module')
  return module
}

function sectionBytesEntries(value: unknown): readonly [string, string][] {
  let entries: readonly [string, string][]
  if (value instanceof Map) {
    if (Object.getPrototypeOf(value) !== Map.prototype)
      fail('sectionBytes must use the canonical Map prototype')
    if (Reflect.ownKeys(value).length !== 0)
      fail('sectionBytes map has custom properties')
    entries = [...Map.prototype.entries.call(value)]
  } else {
    if (
      !isRecord(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    )
      fail('sectionBytes must be a map or plain object')
    const ownKeys = Reflect.ownKeys(value)
    for (const key of ownKeys) {
      if (typeof key !== 'string') fail('sectionBytes has a symbol property')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        descriptor.get ||
        descriptor.set
      )
        fail('sectionBytes has a hidden or accessor property')
    }
    entries = ownKeys.map(key => [
      key as string,
      value[key as string] as string,
    ])
  }
  if (
    entries.some(
      ([key, bytes]) => typeof key !== 'string' || typeof bytes !== 'string',
    )
  )
    fail('sectionBytes entries must contain string keys and Markdown bytes')
  const keys = entries.map(([key]) => key)
  if (new Set(keys).size !== keys.length)
    fail('sectionBytes contain duplicate keys')
  return entries as [string, string][]
}

function selectedModule(
  candidate: GameIrCandidate,
  moduleId: string,
): GameIrModuleCandidate {
  const module = candidate.modules.find(item => item.moduleId === moduleId)
  if (!module) fail('selected module is absent from candidate')
  if (module.nodes.length === 0) fail('selected module must be non-empty')
  return module
}

function moduleSourceClosure(
  module: GameIrModuleCandidate,
  index: readonly GameIrSourceSection[],
  manifest: GameIrSemanticValidatorModule,
): {
  sections: readonly GameIrSourceSection[]
  evidencePointers: readonly string[]
  ownerSectionKeys: readonly string[]
} {
  const byKey = new Map(index.map(section => [sectionKey(section), section]))
  const sections = new Map<string, GameIrSourceSection>()
  const evidence = new Set<string>()
  const ownerSectionKeys = new Set<string>()
  for (const ref of index) {
    if (manifest.sourceDocumentPaths.includes(ref.documentPath)) {
      sections.set(sectionKey(ref), ref)
    }
  }
  for (const node of module.nodes) {
    for (const binding of Object.values(node.bindings)) {
      if (binding.kind !== 'owner') continue
      const ref = byKey.get(sectionKey(binding))
      if (!ref) fail('owner binding is outside the receipt-bound Section Index')
      if (ref.digest !== binding.sectionDigest)
        fail('owner binding section digest does not match Section Index')
      sections.set(sectionKey(ref), ref)
      ownerSectionKeys.add(sectionKey(ref))
      evidence.add(ownerEvidencePointer(binding))
    }
  }
  const selected = [...sections.values()].sort(sectionOrder)
  for (const ref of selected) evidence.add(sectionEvidencePointer(ref))
  const evidencePointers = [...evidence].sort(compare)
  if (selected.length === 0 || evidencePointers.length === 0)
    fail('selected module has no owner source closure')
  return {
    sections: Object.freeze(
      selected.map(section => Object.freeze({ ...section })),
    ),
    evidencePointers: Object.freeze(evidencePointers),
    ownerSectionKeys: Object.freeze([...ownerSectionKeys].sort(compare)),
  }
}

function packetBody(
  packet: Omit<GameIrSemanticValidationPacket, 'packetDigest'>,
): Omit<GameIrSemanticValidationPacket, 'packetDigest'> {
  return packet
}

function packetDigest(
  packet: Omit<GameIrSemanticValidationPacket, 'packetDigest'>,
): string {
  return sha256(canonicalGameIrJson(packetBody(packet)))
}

function inputKeys(value: Record<string, unknown>): void {
  exactKeys(
    value,
    ['candidate', 'request', 'sectionIndex', 'moduleId', 'sectionBytes'],
    'packet input',
  )
}

export function buildGameIrSemanticValidationPacket(
  input: GameIrSemanticValidationPacketInput,
): GameIrSemanticValidationPacket {
  if (!isRecord(input)) fail('packet input must be an object')
  inputKeys(input)
  if (!deepFrozen(input.candidate)) fail('candidate must be immutable')
  const request = parseGameIrCompileRequest(input.request)
  const fullIndex = normalizeSectionIndex(input.sectionIndex)
  const candidate = parseGameIrCandidate(input.candidate, {
    request,
    sections: fullIndex,
  })
  if (digestSectionIndex(fullIndex) !== request.foundation.sectionIndexDigest)
    fail('sectionIndex does not match Foundation receipt')
  if (candidate.modules.length !== MODULE_IDS.length)
    fail('candidate must contain every canonical module exactly once')
  for (let index = 0; index < MODULE_IDS.length; index += 1) {
    if (candidate.modules[index]?.moduleId !== MODULE_IDS[index])
      fail('candidate canonical modules are missing, duplicated, or unsorted')
    if (candidate.modules[index]!.nodes.length === 0)
      fail('canonical module must be non-empty')
  }
  const module = moduleManifest(input.moduleId)
  const selected = selectedModule(candidate, module.moduleId)
  const closure = moduleSourceClosure(selected, fullIndex, module)
  const expectedByteKeys = new Set(closure.sections.map(sectionKey))
  const providedBytes = sectionBytesEntries(input.sectionBytes)
  if (
    providedBytes.length !== expectedByteKeys.size ||
    providedBytes.some(([key]) => !expectedByteKeys.has(key))
  ) {
    fail('sectionBytes must exactly match the selected module source closure')
  }
  const bytesByKey = new Map(providedBytes)
  const sourceSections = closure.sections.map(ref => {
    const bytes = bytesByKey.get(sectionKey(ref))
    if (bytes === undefined)
      fail(`missing Markdown bytes for ${sectionKey(ref)}`)
    if (sha256(bytes) !== ref.digest)
      fail(
        `Markdown bytes do not match Section Index digest for ${sectionKey(ref)}`,
      )
    return Object.freeze({ ref: Object.freeze({ ...ref }), bytes })
  })
  const candidateBytes = canonicalGameIrJson(candidate)
  const body = {
    schemaVersion: 'game-ir-semantic-validation-packet.v1' as const,
    compileRequest: request,
    taskId: request.taskId,
    publicationId: request.publicationId,
    foundationRevision: request.foundation.foundationRevision,
    foundationReceiptDigest: request.foundation.receiptDigest,
    sectionIndexDigest: request.foundation.sectionIndexDigest,
    sectionIndex: fullIndex,
    candidateBytes,
    candidateDigest: sha256(candidateBytes),
    moduleId: module.moduleId,
    validatorManifestVersion: GAME_IR_SEMANTIC_VALIDATOR_MANIFEST_VERSION,
    validatorManifestDigest: GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.digest,
    checkIds: module.checkIds,
    sourceSections: Object.freeze(sourceSections),
    allowedEvidencePointers: closure.evidencePointers,
  } as const
  return Object.freeze({ ...body, packetDigest: packetDigest(body) })
}

function normalizePacketSourceSections(
  value: unknown,
): readonly GameIrSemanticSourceSection[] {
  const dense = strictArray(value, 'packet sourceSections')
  const output = dense.map((raw, index) => {
    if (!isRecord(raw))
      fail(`packet sourceSections[${index}] must be an object`)
    exactKeys(raw, ['ref', 'bytes'], `packet sourceSections[${index}]`)
    const ref = Object.freeze(
      normalizeSection(raw.ref, `packet sourceSections[${index}].ref`),
    )
    const bytes = text(raw.bytes, `packet sourceSections[${index}].bytes`)
    if (sha256(bytes) !== ref.digest)
      fail(`packet source bytes do not match ${sectionKey(ref)}`)
    return Object.freeze({ ref, bytes })
  })
  for (let index = 1; index < output.length; index += 1) {
    if (sectionOrder(output[index - 1]!.ref, output[index]!.ref) >= 0)
      fail('packet sourceSections must be unique and sorted')
  }
  return Object.freeze(output)
}

function validatePacket(packet: GameIrSemanticValidationPacket): {
  packet: GameIrSemanticValidationPacket
  module: GameIrSemanticValidatorModule
  ownerSectionKeys: readonly string[]
} {
  if (!isRecord(packet)) fail('packet must be an object')
  exactKeys(
    packet,
    [
      'schemaVersion',
      'compileRequest',
      'taskId',
      'publicationId',
      'foundationRevision',
      'foundationReceiptDigest',
      'sectionIndexDigest',
      'sectionIndex',
      'candidateBytes',
      'candidateDigest',
      'moduleId',
      'validatorManifestVersion',
      'validatorManifestDigest',
      'checkIds',
      'sourceSections',
      'allowedEvidencePointers',
      'packetDigest',
    ],
    'packet',
  )
  if (packet.schemaVersion !== 'game-ir-semantic-validation-packet.v1')
    fail('packet schemaVersion is invalid')
  const request = parseGameIrCompileRequest(packet.compileRequest)
  if (
    packet.taskId !== request.taskId ||
    packet.publicationId !== request.publicationId
  )
    fail('packet task/publication identity does not match compile request')
  if (packet.foundationRevision !== request.foundation.foundationRevision)
    fail('packet Foundation revision does not match compile request')
  if (packet.foundationReceiptDigest !== request.foundation.receiptDigest)
    fail('packet Foundation receipt digest does not match compile request')
  const fullIndex = normalizeSectionIndex(packet.sectionIndex)
  if (
    packet.sectionIndexDigest !== request.foundation.sectionIndexDigest ||
    digestSectionIndex(fullIndex) !== packet.sectionIndexDigest
  )
    fail('packet Section Index digest is stale')
  const candidateObject = JSON.parse(
    text(packet.candidateBytes, 'packet candidateBytes'),
  )
  const candidate = parseGameIrCandidate(candidateObject, {
    request,
    sections: fullIndex,
  })
  const normalizedCandidateBytes = canonicalGameIrJson(candidate)
  if (normalizedCandidateBytes !== packet.candidateBytes)
    fail('packet candidateBytes are not canonical')
  if (sha256(packet.candidateBytes) !== packet.candidateDigest)
    fail('packet candidate digest is stale')
  if (
    candidate.taskId !== packet.taskId ||
    candidate.foundationRevision !== packet.foundationRevision
  )
    fail('packet candidate identity does not match packet')
  if (candidate.modules.length !== MODULE_IDS.length)
    fail('packet candidate has incomplete canonical modules')
  for (let index = 0; index < MODULE_IDS.length; index += 1) {
    if (
      candidate.modules[index]?.moduleId !== MODULE_IDS[index] ||
      candidate.modules[index]!.nodes.length === 0
    )
      fail('packet candidate canonical module coverage is invalid')
  }
  if (
    packet.validatorManifestVersion !==
    GAME_IR_SEMANTIC_VALIDATOR_MANIFEST_VERSION
  )
    fail('packet validator manifest version is stale')
  if (
    packet.validatorManifestDigest !==
    GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.digest
  )
    fail('packet validator manifest digest is stale')
  const module = moduleManifest(packet.moduleId)
  const checkIds = exactStringArray(
    packet.checkIds,
    module.checkIds,
    'packet checkIds',
  )
  const selected = selectedModule(candidate, module.moduleId)
  const closure = moduleSourceClosure(selected, fullIndex, module)
  const sourceSections = normalizePacketSourceSections(packet.sourceSections)
  if (
    sourceSections.length !== closure.sections.length ||
    sourceSections.some(
      (item, index) => !sameSection(item.ref, closure.sections[index]!),
    )
  )
    fail('packet source closure is stale or incomplete')
  const allowedEvidencePointers = exactStringArray(
    packet.allowedEvidencePointers,
    closure.evidencePointers,
    'packet evidence namespace',
  )
  const body = {
    schemaVersion: packet.schemaVersion,
    compileRequest: request,
    taskId: packet.taskId,
    publicationId: packet.publicationId,
    foundationRevision: packet.foundationRevision,
    foundationReceiptDigest: packet.foundationReceiptDigest,
    sectionIndexDigest: packet.sectionIndexDigest,
    sectionIndex: fullIndex,
    candidateBytes: packet.candidateBytes,
    candidateDigest: packet.candidateDigest,
    moduleId: packet.moduleId,
    validatorManifestVersion: packet.validatorManifestVersion,
    validatorManifestDigest: packet.validatorManifestDigest,
    checkIds,
    sourceSections,
    allowedEvidencePointers,
  } as const
  if (packet.packetDigest !== packetDigest(body))
    fail('packet digest is stale or invalid')
  return {
    packet: Object.freeze({ ...body, packetDigest: packet.packetDigest }),
    module,
    ownerSectionKeys: closure.ownerSectionKeys,
  }
}

function exactStringArray(
  value: unknown,
  expected: readonly string[],
  label: string,
): readonly string[] {
  const dense = strictArray(value, label)
  if (dense.length !== expected.length)
    fail(`${label} has incomplete or extra values`)
  if (dense.some(item => typeof item !== 'string'))
    fail(`${label} has invalid values`)
  if (dense.some((item, index) => item !== expected[index]))
    fail(`${label} is not the exact canonical coverage`)
  return Object.freeze(dense as string[])
}

function resultKeys(
  value: Record<string, unknown>,
  outcome: 'PASS' | 'FAIL' | 'AMBIGUOUS',
): void {
  exactKeys(
    value,
    outcome === 'PASS'
      ? ['outcome', 'packetDigest', 'checkIds']
      : ['outcome', 'packetDigest', 'reasonCode', 'actual', 'evidencePointers'],
    `${outcome} result`,
  )
}

export function admitGameIrSemanticValidationResult(
  packet: GameIrSemanticValidationPacket,
  result: unknown,
): GameIrSemanticValidationResult {
  const validated = validatePacket(packet)
  if (!isRecord(result)) fail('result must be an object')
  if (result.outcome === 'PASS') {
    resultKeys(result, 'PASS')
    if (result.packetDigest !== validated.packet.packetDigest)
      fail('result packet digest does not match packet')
    const checkIds = exactStringArray(
      result.checkIds,
      validated.module.checkIds,
      'PASS checkIds',
    )
    return Object.freeze({
      outcome: 'PASS',
      packetDigest: validated.packet.packetDigest,
      checkIds,
    })
  }
  if (result.outcome !== 'FAIL' && result.outcome !== 'AMBIGUOUS')
    fail('result outcome is invalid')
  resultKeys(result, result.outcome)
  if (result.packetDigest !== validated.packet.packetDigest)
    fail('result packet digest does not match packet')
  const reasonCode = text(result.reasonCode, 'result reasonCode')
  const actual = text(result.actual, 'result actual')
  const evidenceValues = strictArray(
    result.evidencePointers,
    'result evidencePointers',
  )
  if (evidenceValues.length === 0)
    fail('result evidencePointers must not be empty')
  if (evidenceValues.some(item => typeof item !== 'string'))
    fail('result evidencePointers must contain strings')
  const evidence = evidenceValues as readonly string[]
  const allowed = new Set(validated.packet.allowedEvidencePointers)
  const seen = new Set<string>()
  for (const pointer of evidence) {
    if (seen.has(pointer)) fail('result evidencePointers contain duplicates')
    if (!allowed.has(pointer))
      fail('result evidence pointer is outside owner namespace')
    if (pointer.startsWith('section:')) {
      if (!SECTION_EVIDENCE_REASON_CODES.includes(reasonCode))
        fail(
          'section evidence is only valid for missing or ambiguous projections',
        )
      const sectionPointer = pointer.slice('section:'.length)
      const sectionIdentity = sectionPointer.slice(
        0,
        sectionPointer.lastIndexOf('@'),
      )
      if (validated.ownerSectionKeys.includes(sectionIdentity))
        fail('section evidence cannot replace an owner binding')
    }
    seen.add(pointer)
  }
  for (let index = 1; index < evidence.length; index += 1) {
    if (compare(evidence[index - 1]!, evidence[index]!) >= 0)
      fail('result evidencePointers must be unique and sorted')
  }
  return Object.freeze({
    outcome: result.outcome,
    packetDigest: validated.packet.packetDigest,
    reasonCode,
    actual,
    evidencePointers: Object.freeze([...evidence]),
  }) as GameIrSemanticValidationResult
}
