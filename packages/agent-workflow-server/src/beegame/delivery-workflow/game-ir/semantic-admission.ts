import {
  digestGameIrValue,
  type GameIrCandidate,
  type GameIrModuleCandidate,
  type GameIrSourceSection,
} from './model'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'

export const GAME_IR_SEMANTIC_VALIDATION_PACKET_VERSION =
  'game-ir-semantic-validation-packet.v1' as const

export type GameIrSemanticValidationPacket = Readonly<{
  schemaVersion: typeof GAME_IR_SEMANTIC_VALIDATION_PACKET_VERSION
  taskId: string
  foundationRevision: string
  moduleId: string
  candidateDigest: string
  sourceSections: readonly GameIrSourceSection[]
  packetDigest: string
}>

export type GameIrSemanticValidationResult = Readonly<
  | { outcome: 'PASS'; packetDigest: string }
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

type PacketInput = Readonly<{
  candidate: GameIrCandidate | GameIrModuleCandidate
  moduleId?: string
  taskId?: string
  foundationRevision?: string
  sourceSections: readonly GameIrSourceSection[]
}>

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const FOUNDATION_DOCUMENTS = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)

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
  const actual = Object.keys(value).sort()
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

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (!isDeepFrozen(child, seen)) return false
  }
  return true
}

function sectionKey(
  section: Pick<GameIrSourceSection, 'documentPath' | 'sectionId'>,
): string {
  return `${section.documentPath}\0${section.sectionId}`
}

function sectionOrder(
  left: GameIrSourceSection,
  right: GameIrSourceSection,
): number {
  const leftKey = `${left.documentPath}\0${left.startLine}\0${left.sectionId}`
  const rightKey = `${right.documentPath}\0${right.startLine}\0${right.sectionId}`
  return compare(leftKey, rightKey)
}

function normalizeSourceSections(
  value: unknown,
): readonly GameIrSourceSection[] {
  if (!Array.isArray(value)) fail('sourceSections must be an array')
  const result: GameIrSourceSection[] = []
  const keys = new Set<string>()
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) fail(`source section ${index} must be an object`)
    exactKeys(
      raw,
      [
        'documentPath',
        'sectionId',
        'heading',
        'startLine',
        'endLine',
        'digest',
      ],
      `source section ${index}`,
    )
    const documentPath = text(
      raw.documentPath,
      `source section ${index} documentPath`,
    )
    if (!FOUNDATION_DOCUMENTS.has(documentPath))
      fail(`source section ${index} is not a Foundation document`)
    const sectionId = id(raw.sectionId, `source section ${index} sectionId`)
    const heading = text(raw.heading, `source section ${index} heading`)
    const startLine = raw.startLine
    const endLine = raw.endLine
    if (
      typeof startLine !== 'number' ||
      !Number.isSafeInteger(startLine) ||
      startLine < 1 ||
      typeof endLine !== 'number' ||
      !Number.isSafeInteger(endLine) ||
      endLine < startLine
    )
      fail(`source section ${index} line range is invalid`)
    const sectionDigest = digest(raw.digest, `source section ${index} digest`)
    const key = `${documentPath}\0${sectionId}`
    if (keys.has(key)) fail('sourceSections contain a duplicate section')
    keys.add(key)
    result.push({
      documentPath: documentPath as FoundationDocumentPath,
      sectionId,
      heading,
      startLine,
      endLine,
      digest: sectionDigest,
    })
  }
  for (let index = 1; index < result.length; index += 1) {
    if (sectionOrder(result[index - 1]!, result[index]!) >= 0)
      fail('sourceSections must be unique and sorted')
  }
  return Object.freeze(result.map(section => Object.freeze(section)))
}

function candidateModule(input: PacketInput): {
  candidate: GameIrModuleCandidate
  taskId: string
  foundationRevision: string
} {
  const value = input.candidate
  if (!isDeepFrozen(value)) fail('candidate module must be immutable')
  if ('modules' in value) {
    const candidate = value as GameIrCandidate
    if (!Array.isArray(candidate.modules)) fail('candidate modules are invalid')
    const moduleId = id(input.moduleId, 'moduleId')
    const module = candidate.modules.find(item => item.moduleId === moduleId)
    if (!module) fail('candidate module is not present in the candidate')
    if (input.taskId !== undefined && input.taskId !== candidate.taskId)
      fail('taskId does not match candidate')
    if (
      input.foundationRevision !== undefined &&
      input.foundationRevision !== candidate.foundationRevision
    )
      fail('foundationRevision does not match candidate')
    return {
      candidate: module,
      taskId: id(candidate.taskId, 'candidate taskId'),
      foundationRevision: text(
        candidate.foundationRevision,
        'candidate foundationRevision',
      ),
    }
  }
  const module = value as GameIrModuleCandidate
  return {
    candidate: module,
    taskId: id(input.taskId, 'taskId'),
    foundationRevision: text(input.foundationRevision, 'foundationRevision'),
  }
}

function packetBody(
  packet: Omit<GameIrSemanticValidationPacket, 'packetDigest'>,
): unknown {
  return packet
}

function packetDigest(
  packet: Omit<GameIrSemanticValidationPacket, 'packetDigest'>,
): string {
  return digestGameIrValue(packetBody(packet))
}

function ownerEvidencePointers(module: GameIrModuleCandidate): Set<string> {
  const pointers = new Set<string>()
  for (const node of module.nodes) {
    for (const binding of Object.values(node.bindings)) {
      if (binding.kind === 'owner') pointers.add(binding.sourcePointer)
    }
  }
  return pointers
}

export function buildGameIrSemanticValidationPacket(
  input: PacketInput,
): GameIrSemanticValidationPacket {
  if (!isRecord(input)) fail('packet input must be an object')
  const allowed = [
    'candidate',
    'moduleId',
    'taskId',
    'foundationRevision',
    'sourceSections',
  ]
  if (Object.keys(input).some(key => !allowed.includes(key)))
    fail('packet input has unknown fields')
  const selected = candidateModule(input)
  const sourceSections = normalizeSourceSections(input.sourceSections)
  const sourceMap = new Map(
    sourceSections.map(section => [sectionKey(section), section]),
  )
  const usedSections = new Set<string>()
  for (const node of selected.candidate.nodes) {
    for (const binding of Object.values(node.bindings)) {
      if (binding.kind !== 'owner') continue
      const section = sourceMap.get(sectionKey(binding))
      if (!section)
        fail('owner binding refers to a section outside this packet')
      if (section.digest !== binding.sectionDigest)
        fail('owner binding section digest does not match source section')
      usedSections.add(sectionKey(section))
    }
  }
  if (usedSections.size !== sourceSections.length)
    fail('sourceSections must be the exact sections used by the module')
  const body = {
    schemaVersion: GAME_IR_SEMANTIC_VALIDATION_PACKET_VERSION,
    taskId: selected.taskId,
    foundationRevision: selected.foundationRevision,
    moduleId: selected.candidate.moduleId,
    candidateDigest: digestGameIrValue(selected.candidate),
    sourceSections,
  } as const
  return Object.freeze({ ...body, packetDigest: packetDigest(body) })
}

function validatePacket(packet: GameIrSemanticValidationPacket): void {
  if (!isRecord(packet)) fail('packet must be an object')
  exactKeys(
    packet,
    [
      'schemaVersion',
      'taskId',
      'foundationRevision',
      'moduleId',
      'candidateDigest',
      'sourceSections',
      'packetDigest',
    ],
    'packet',
  )
  if (packet.schemaVersion !== GAME_IR_SEMANTIC_VALIDATION_PACKET_VERSION)
    fail('packet schemaVersion is invalid')
  id(packet.taskId, 'packet taskId')
  text(packet.foundationRevision, 'packet foundationRevision')
  id(packet.moduleId, 'packet moduleId')
  digest(packet.candidateDigest, 'packet candidateDigest')
  const sourceSections = normalizeSourceSections(packet.sourceSections)
  const body = {
    schemaVersion: packet.schemaVersion,
    taskId: packet.taskId,
    foundationRevision: packet.foundationRevision,
    moduleId: packet.moduleId,
    candidateDigest: packet.candidateDigest,
    sourceSections,
  } as const
  if (packet.packetDigest !== packetDigest(body))
    fail('packet digest is stale or invalid')
}

function evidencePointersForPacket(
  packet: GameIrSemanticValidationPacket,
): Set<string> {
  // The packet deliberately contains no candidate bytes. Evidence is therefore
  // limited to source-section identities; source bindings are checked while the
  // packet is built and cannot be supplied by the validator.
  return new Set(
    packet.sourceSections.map(
      section => `${section.documentPath}#${section.sectionId}`,
    ),
  )
}

export function admitGameIrSemanticValidationResult(
  packet: GameIrSemanticValidationPacket,
  input: unknown,
): GameIrSemanticValidationResult {
  validatePacket(packet)
  if (!isRecord(input)) fail('result must be an object')
  const outcome = input.outcome
  if (outcome === 'PASS') {
    exactKeys(input, ['outcome', 'packetDigest'], 'PASS result')
    if (input.packetDigest !== packet.packetDigest)
      fail('result packet digest does not match packet')
    return Object.freeze({ outcome: 'PASS', packetDigest: packet.packetDigest })
  }
  if (outcome !== 'FAIL' && outcome !== 'AMBIGUOUS')
    fail('result outcome is invalid')
  exactKeys(
    input,
    ['outcome', 'packetDigest', 'reasonCode', 'actual', 'evidencePointers'],
    `${outcome} result`,
  )
  if (input.packetDigest !== packet.packetDigest)
    fail('result packet digest does not match packet')
  const reasonCode = text(input.reasonCode, 'result reasonCode')
  const actual = text(input.actual, 'result actual')
  if (
    !Array.isArray(input.evidencePointers) ||
    input.evidencePointers.length === 0
  )
    fail('result evidencePointers must not be empty')
  const evidencePointers: string[] = []
  const allowed = evidencePointersForPacket(packet)
  const seen = new Set<string>()
  for (const pointer of input.evidencePointers) {
    const value = text(pointer, 'result evidence pointer')
    if (seen.has(value)) fail('result evidencePointers contain a duplicate')
    if (!allowed.has(value))
      fail('result evidence pointer is outside the packet')
    seen.add(value)
    evidencePointers.push(value)
  }
  for (let index = 1; index < evidencePointers.length; index += 1) {
    if (compare(evidencePointers[index - 1]!, evidencePointers[index]!) >= 0)
      fail('result evidencePointers must be unique and sorted')
  }
  return Object.freeze({
    outcome,
    packetDigest: packet.packetDigest,
    reasonCode,
    actual,
    evidencePointers: Object.freeze(evidencePointers),
  }) as GameIrSemanticValidationResult
}
