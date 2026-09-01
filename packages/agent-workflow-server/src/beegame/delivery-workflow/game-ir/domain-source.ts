import { createHash } from 'node:crypto'
import {
  GAME_IR_CANONICAL_MODULE_IDS,
  parseGameIrCompileRequest,
  type GameIrCompileRequest,
  type GameIrModuleId,
} from './contracts'
import {
  canonicalizeGameIrSourceSections,
  compareCodeUnits,
  digestGameIrSourceSectionIndex,
  digestGameIrValue,
  type GameIrSourceSection,
} from './model'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'

export type GameIrDomainId =
  | 'gameplay'
  | 'balance'
  | 'world-scene'
  | 'presentation'
  | 'resource-realization'
  | 'implementation-verification'

export const GAME_IR_DOMAIN_IDS = Object.freeze([
  'gameplay',
  'balance',
  'world-scene',
  'presentation',
  'resource-realization',
  'implementation-verification',
] as const)

export type GameIrDomainSourceEnvelope = Readonly<{
  schemaVersion: 'game-ir-domain-source.v1'
  taskId: string
  moduleId: GameIrDomainId
  compileRequest: GameIrCompileRequest
  authoritySectionIndex: readonly GameIrSourceSection[]
  sectionIndex: readonly GameIrSourceSection[]
  sectionBytes: Readonly<Record<string, string>>
  sourceDigest: string
}>

export type GameIrDomainSourceInput = Readonly<{
  moduleId: GameIrDomainId
  request: GameIrCompileRequest
  sectionIndex: readonly GameIrSourceSection[]
  sectionBytes: Readonly<Record<string, string>> | ReadonlyMap<string, string>
}>

export const GAME_IR_MODULE_SOURCE_DOCUMENTS: Readonly<
  Record<GameIrModuleId, readonly FoundationDocumentPath[]>
> = Object.freeze({
  gameplay: Object.freeze(['docs/GDD.md'] as const),
  balance: Object.freeze(['docs/GDD.md', 'docs/BALANCE_DESIGN.md'] as const),
  'world-scene': Object.freeze([
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
  ] as const),
  presentation: Object.freeze([
    'docs/GDD.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
  ] as const),
  'resource-realization': Object.freeze([
    'docs/ASSET_PLAN.md',
    'docs/TECHNICAL_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
    'docs/LEVEL_SCENE_DESIGN.md',
  ] as const),
  'implementation-verification': Object.freeze([
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
  ] as const),
})

const GAME_IR_DOMAIN_ID_SET = new Set<string>(GAME_IR_DOMAIN_IDS)

export function isGameIrDomainId(value: unknown): value is GameIrDomainId {
  return typeof value === 'string' && GAME_IR_DOMAIN_ID_SET.has(value)
}

export function canonicalGameIrModuleSourceDocuments(
  moduleId: GameIrModuleId,
): readonly FoundationDocumentPath[] {
  if (!Object.hasOwn(GAME_IR_MODULE_SOURCE_DOCUMENTS, moduleId))
    fail('moduleId must be canonical')
  return Object.freeze(
    [...GAME_IR_MODULE_SOURCE_DOCUMENTS[moduleId]].sort(compareCodeUnits),
  )
}

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const FOUNDATION_DOCUMENTS = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)

function fail(message: string): never {
  throw new Error(`invalid Game IR domain source: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
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
  const actual = keys as string[]
  actual.sort(compareCodeUnits)
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

function safeId(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SAFE_ID.test(result)) fail(`${label} is not a safe identifier`)
  return result
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function digest(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SHA256.test(result)) fail(`${label} must be a SHA-256 digest`)
  return result
}

function sectionKey(
  section: Pick<GameIrSourceSection, 'documentPath' | 'sectionId'>,
): string {
  return `${section.documentPath}#${section.sectionId}`
}

function freezeSections(
  sections: readonly GameIrSourceSection[],
): readonly GameIrSourceSection[] {
  return Object.freeze(sections.map(section => Object.freeze({ ...section })))
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

function normalizeSectionIndex(
  value: unknown,
  requireCanonical = false,
): GameIrSourceSection[] {
  if (!Array.isArray(value)) fail('sectionIndex must be an array')
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    lengthDescriptor.value !== value.length ||
    lengthDescriptor.enumerable ||
    lengthDescriptor.configurable
  )
    fail('sectionIndex has an invalid length property')
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== value.length + 1)
    fail('sectionIndex must be a dense array without custom properties')
  for (const key of ownKeys) {
    if (key === 'length') continue
    if (typeof key !== 'string') fail('sectionIndex has a symbol property')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !descriptor.enumerable ||
      !/^\d+$/.test(key)
    )
      fail('sectionIndex has a hidden or accessor property')
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, String(index))) fail('sectionIndex must be dense')
  }
  const output = value.map((raw, index) => {
    if (!isPlainRecord(raw))
      fail(`sectionIndex[${index}] must be a plain object`)
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
      `sectionIndex[${index}]`,
    )
    const documentPath = text(
      raw.documentPath,
      `sectionIndex[${index}].documentPath`,
    )
    if (!FOUNDATION_DOCUMENTS.has(documentPath))
      fail(`sectionIndex[${index}] documentPath is not canonical`)
    const sectionId = safeId(raw.sectionId, `sectionIndex[${index}].sectionId`)
    const heading = text(raw.heading, `sectionIndex[${index}].heading`)
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
      fail(`sectionIndex[${index}] has invalid line bounds`)
    const sectionDigest = digest(raw.digest, `sectionIndex[${index}].digest`)
    return {
      documentPath: documentPath as FoundationDocumentPath,
      sectionId,
      heading,
      startLine,
      endLine,
      digest: sectionDigest,
    }
  })
  const canonical = canonicalizeGameIrSourceSections(output)
  if (
    requireCanonical &&
    output.some((section, index) => !sameSection(section, canonical[index]!))
  )
    fail('sectionIndex must use the canonical Game IR order')
  return canonical
}

function sectionBytesEntries(value: unknown): Array<readonly [string, string]> {
  let entries: Array<readonly [string, string]>
  if (value instanceof Map) {
    if (Object.getPrototypeOf(value) !== Map.prototype)
      fail('sectionBytes must use the canonical Map prototype')
    if (Reflect.ownKeys(value).length !== 0)
      fail('sectionBytes map has custom properties')
    entries = [...Map.prototype.entries.call(value)]
  } else {
    if (!isPlainRecord(value))
      fail('sectionBytes must be a map or plain object')
    const keys = Reflect.ownKeys(value)
    entries = []
    for (const key of keys) {
      if (typeof key !== 'string') fail('sectionBytes has a symbol property')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        !descriptor ||
        !('value' in descriptor) ||
        !descriptor.enumerable ||
        descriptor.get ||
        descriptor.set
      )
        fail('sectionBytes has a hidden or accessor property')
      const bytes = descriptor.value
      if (typeof bytes !== 'string')
        fail('sectionBytes values must be Markdown bytes')
      entries.push([key, bytes])
    }
  }
  const seen = new Set<string>()
  for (const [key, bytes] of entries) {
    if (typeof key !== 'string' || typeof bytes !== 'string')
      fail('sectionBytes entries must contain string keys and Markdown bytes')
    if (seen.has(key)) fail('sectionBytes contain duplicate keys')
    seen.add(key)
  }
  entries.sort(([left], [right]) => compareCodeUnits(left, right))
  return entries
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function validateSourceInputKeys(
  input: unknown,
): asserts input is GameIrDomainSourceInput {
  if (!isPlainRecord(input)) fail('input must be a plain object')
  exactKeys(
    input,
    ['moduleId', 'request', 'sectionIndex', 'sectionBytes'],
    'input',
  )
}

export function buildGameIrDomainSourceEnvelope(
  input: GameIrDomainSourceInput,
): GameIrDomainSourceEnvelope {
  validateSourceInputKeys(input)
  const moduleId = input.moduleId
  if (!isGameIrDomainId(moduleId)) fail('moduleId must be an isolated domain')
  const request = parseGameIrCompileRequest(input.request)
  const fullIndex = normalizeSectionIndex(input.sectionIndex)
  if (fullIndex.length === 0) fail('sectionIndex must not be empty')
  for (const documentPath of CANONICAL_FOUNDATION_DOCUMENTS) {
    if (!fullIndex.some(section => section.documentPath === documentPath))
      fail('sectionIndex must contain all eight canonical documents')
  }
  if (digestGameIrSourceSectionIndex(fullIndex) !== request.foundation.sectionIndexDigest)
    fail('sectionIndex digest does not match the Foundation receipt')

  const expectedDocuments = canonicalGameIrModuleSourceDocuments(moduleId)
  const selected = fullIndex.filter(section =>
    expectedDocuments.some(
      documentPath => documentPath === section.documentPath,
    ),
  )
  if (selected.length === 0) fail('domain source closure is empty')

  const provided = sectionBytesEntries(input.sectionBytes)
  const expectedKeys = new Set(selected.map(sectionKey))
  if (
    provided.length !== expectedKeys.size ||
    provided.some(([key]) => !expectedKeys.has(key))
  )
    fail('sectionBytes must exactly match the domain source closure')
  const bytesByKey = new Map(provided)
  const sectionBytes: Record<string, string> = {}
  for (const section of selected) {
    const key = sectionKey(section)
    const bytes = bytesByKey.get(key)
    if (bytes === undefined) fail(`missing Markdown bytes for ${key}`)
    if (sha256(bytes) !== section.digest)
      fail(`Markdown bytes do not match Section Index digest for ${key}`)
    sectionBytes[key] = bytes
  }
  const body: Omit<GameIrDomainSourceEnvelope, 'sourceDigest'> = {
    schemaVersion: 'game-ir-domain-source.v1',
    taskId: request.taskId,
    moduleId,
    compileRequest: request,
    authoritySectionIndex: freezeSections(fullIndex),
    sectionIndex: freezeSections(selected),
    sectionBytes: Object.freeze(sectionBytes),
  }
  return deepFreeze({
    ...body,
    sourceDigest: digestGameIrValue(body),
  })
}

/** Internal validation used by producer contracts; callers should build envelopes above. */
export function validateGameIrDomainSourceEnvelope(
  value: unknown,
): GameIrDomainSourceEnvelope {
  if (!isPlainRecord(value)) fail('source envelope must be a plain object')
  exactKeys(
    value,
    [
      'schemaVersion',
      'taskId',
      'moduleId',
      'compileRequest',
      'authoritySectionIndex',
      'sectionIndex',
      'sectionBytes',
      'sourceDigest',
    ],
    'source envelope',
  )
  if (value.schemaVersion !== 'game-ir-domain-source.v1')
    fail('source envelope schemaVersion is invalid')
  const request = parseGameIrCompileRequest(value.compileRequest)
  const taskId = safeId(value.taskId, 'source envelope taskId')
  if (taskId !== request.taskId)
    fail('source envelope taskId does not match compile request')
  const rawModuleId = value.moduleId
  if (!isGameIrDomainId(rawModuleId))
    fail('source envelope moduleId is invalid')
  const moduleId = rawModuleId
  const authoritySectionIndex = normalizeSectionIndex(
    value.authoritySectionIndex,
    true,
  )
  if (authoritySectionIndex.length === 0)
    fail('authority Section Index must not be empty')
  for (const documentPath of CANONICAL_FOUNDATION_DOCUMENTS) {
    if (
      !authoritySectionIndex.some(
        section => section.documentPath === documentPath,
      )
    )
      fail('authority Section Index must contain all eight canonical documents')
  }
  if (
    digestGameIrSourceSectionIndex(authoritySectionIndex) !==
    request.foundation.sectionIndexDigest
  )
    fail('authority Section Index digest does not match the Foundation receipt')
  const sections = normalizeSectionIndex(value.sectionIndex, true)
  const expectedDocuments = canonicalGameIrModuleSourceDocuments(moduleId)
  const expectedSections = authoritySectionIndex.filter(section =>
    expectedDocuments.includes(section.documentPath as never),
  )
  if (
    sections.length !== expectedSections.length ||
    sections.some(
      (section, index) => !sameSection(section, expectedSections[index]!),
    )
  )
    fail('source envelope section closure is invalid')
  const provided = sectionBytesEntries(value.sectionBytes)
  const expectedKeys = new Set(sections.map(sectionKey))
  if (
    provided.length !== expectedKeys.size ||
    provided.some(([key]) => !expectedKeys.has(key))
  )
    fail('source envelope bytes are not exact')
  const bytesByKey = new Map(provided)
  const sectionBytes: Record<string, string> = {}
  for (const section of sections) {
    const bytes = bytesByKey.get(sectionKey(section))!
    if (sha256(bytes) !== section.digest)
      fail(`source envelope bytes do not match ${sectionKey(section)}`)
    sectionBytes[sectionKey(section)] = bytes
  }
  const body: Omit<GameIrDomainSourceEnvelope, 'sourceDigest'> = {
    schemaVersion: 'game-ir-domain-source.v1',
    taskId,
    moduleId,
    compileRequest: request,
    authoritySectionIndex: freezeSections(authoritySectionIndex),
    sectionIndex: freezeSections(sections),
    sectionBytes: Object.freeze(sectionBytes),
  }
  const sourceDigest = digest(
    value.sourceDigest,
    'source envelope sourceDigest',
  )
  if (sourceDigest !== digestGameIrValue(body))
    fail('source envelope digest is stale or invalid')
  return deepFreeze({ ...body, sourceDigest })
}
