import { createHash } from 'node:crypto'
import {
  compareCodeUnits,
  parseGameIrTargetPointer,
  type GameIrReference,
  type GameIrRelationshipEdge,
} from './model'
import type { FoundationDocumentPath } from '../types'

export type GameIrSemanticCandidateNode = Readonly<{
  id: string
  kind: string
  value: Readonly<Record<string, unknown>>
  references: readonly GameIrReference[]
  edges: readonly GameIrRelationshipEdge[]
}>

export type GameIrSemanticSourceClaim = Readonly<{
  subject: string
  documentPath: FoundationDocumentPath
  sectionId: string
  sourcePointer: string
  literal: string
}>

export type SemanticValidationResult = Readonly<
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

export type SemanticValidationResultPolicy = Readonly<{
  packetDigest: string
  checkIds: readonly string[]
  coveredTargets: readonly string[]
  requiredTargets: readonly string[]
  allowedEvidencePointers: readonly string[]
  evidenceKindPolicy: Readonly<{
    projectionMismatch: 'binding' | 'section' | 'any'
    projectionIdentity: 'binding' | 'section' | 'any'
  }>
  messages?: Readonly<{
    resultObject?: string
    failureResultLabel?: string
    failurePacketDigest?: string
    evidenceLabel?: string
    evidenceStrings?: string
    evidenceCoverage?: string
    evidenceSort?: string
  }>
}>

export type SemanticSourceClaimAuthority = Readonly<{
  sectionIndex: readonly Readonly<{
    documentPath: FoundationDocumentPath
    sectionId: string
    digest: string
  }>[]
  sectionBytes: Readonly<Record<string, string>>
}>

export type SemanticSourceClaimBytePolicy = Readonly<{
  sourcePointerLabel?: string
  outsideClosure?: string
  bytesMissing?: string
  pointerOutsideBytes?: string
  pointerUnaligned?: string
  invalidUtf8?: string
  literalMismatch?: string
  staleDigest?: string
  verifySectionDigest?: boolean
}>

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SHA256 = /^[a-f0-9]{64}$/
function fail(errorPrefix: string, message: string): never {
  throw new Error(`${errorPrefix}: ${message}`)
}

function exactSemanticKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  errorPrefix: string,
): void {
  const actual = Reflect.ownKeys(value)
  for (const key of actual) {
    if (typeof key !== 'string')
      fail(errorPrefix, `${label} has a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(errorPrefix, `${label} has a hidden or accessor property`)
  }
  const sorted = (actual as string[]).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    sorted.length !== wanted.length ||
    sorted.some((key, index) => key !== wanted[index])
  )
    fail(errorPrefix, `${label} has unknown or missing fields`)
}

function strictSemanticArray(
  value: unknown,
  label: string,
  errorPrefix: string,
): unknown[] {
  if (!Array.isArray(value)) fail(errorPrefix, `${label} must be an array`)
  const length = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !length ||
    !('value' in length) ||
    length.value !== value.length ||
    length.enumerable ||
    length.configurable
  )
    fail(errorPrefix, `${label} has an invalid length property`)
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1)
    fail(errorPrefix, `${label} must be dense without custom properties`)
  for (const key of keys) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^\d+$/.test(key))
      fail(errorPrefix, `${label} has a hidden or symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(errorPrefix, `${label} has a hidden or accessor property`)
  }
  for (let index = 0; index < value.length; index += 1)
    if (!Object.hasOwn(value, String(index)))
      fail(errorPrefix, `${label} must be dense`)
  return value
}

function semanticText(
  value: unknown,
  label: string,
  errorPrefix: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    fail(errorPrefix, `${label} must be non-empty text`)
  return value
}

function semanticSafeId(
  value: unknown,
  label: string,
  errorPrefix: string,
): string {
  const result = semanticText(value, label, errorPrefix)
  if (!SAFE_ID.test(result))
    fail(errorPrefix, `${label} must be a safe identifier`)
  return result
}

function semanticSha256(
  value: unknown,
  label: string,
  errorPrefix: string,
): string {
  const result = semanticText(value, label, errorPrefix)
  if (!SHA256.test(result))
    fail(errorPrefix, `${label} must be a SHA-256 digest`)
  return result
}
function normalizeSemanticSourcePointer(
  value: unknown,
  label: string,
  errorPrefix: string,
): string {
  const pointer = semanticText(value, label, errorPrefix)
  const parts = pointer.split('/')
  if (
    parts.length !== 4 ||
    parts[1] !== 'bytes' ||
    !/^(?:0|[1-9]\d*)$/.test(parts[2]!) ||
    !/^(?:0|[1-9]\d*)$/.test(parts[3]!)
  )
    fail(errorPrefix, `${label} must be a canonical /bytes/<start>/<end> range`)
  const start = Number(parts[2])
  const end = Number(parts[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= end
  )
    fail(errorPrefix, `${label} must contain a non-empty byte range`)
  return pointer
}

/** Domain admission owns the expected set; this enforces exact ordered coverage. */
function exactSemanticStringCoverage(
  value: unknown,
  expected: readonly string[],
  label: string,
  errorPrefix: string,
): readonly string[] {
  const actual = strictSemanticArray(value, label, errorPrefix)
  if (actual.length !== expected.length)
    fail(errorPrefix, `${label} has incomplete or extra values`)
  if (actual.some(entry => typeof entry !== 'string'))
    fail(errorPrefix, `${label} must contain strings`)
  if (actual.some((entry, index) => entry !== expected[index]))
    fail(errorPrefix, `${label} must be exact canonical coverage`)
  return Object.freeze([...actual] as string[])
}

export type SemanticFidelityPrimitives = Readonly<{
  exactKeys: (
    value: Record<string, unknown>,
    expected: readonly string[],
    label: string,
  ) => void
  strictArray: (value: unknown, label: string) => unknown[]
  text: (value: unknown, label: string) => string
  safeId: (value: unknown, label: string) => string
  sha256: (value: unknown, label: string) => string
  deepFreeze: <T>(value: T) => T
  normalizeSourcePointer: (value: unknown, label: string) => string
  exactStringCoverage: (
    value: unknown,
    expected: readonly string[],
    label: string,
  ) => readonly string[]
  admitValidationResult: (
    value: unknown,
    policy: SemanticValidationResultPolicy,
  ) => SemanticValidationResult
}>

/**
 * Creates a protocol view with an owning boundary's error prefix. The
 * primitives are stateless and cannot leak an error vocabulary across domains.
 */
export function createSemanticFidelityPrimitives(
  errorPrefix: string,
): SemanticFidelityPrimitives {
  return Object.freeze({
    exactKeys: (value, expected, label) =>
      exactSemanticKeys(value, expected, label, errorPrefix),
    strictArray: (value, label) =>
      strictSemanticArray(value, label, errorPrefix),
    text: (value, label) => semanticText(value, label, errorPrefix),
    safeId: (value, label) => semanticSafeId(value, label, errorPrefix),
    sha256: (value, label) => semanticSha256(value, label, errorPrefix),
    deepFreeze: deepFreezeSemantic,
    normalizeSourcePointer: (value, label) =>
      normalizeSemanticSourcePointer(value, label, errorPrefix),
    exactStringCoverage: (value, expected, label) =>
      exactSemanticStringCoverage(value, expected, label, errorPrefix),
    admitValidationResult: (value, policy) =>
      admitSemanticValidationResult(value, policy, errorPrefix),
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function admitSemanticValidationResult(
  value: unknown,
  policy: SemanticValidationResultPolicy,
  errorPrefix: string,
): SemanticValidationResult {
  const failResult = (message: string): never => fail(errorPrefix, message)
  const messages = {
    resultObject: 'validation result must be an object',
    failureResultLabel: 'fidelity validation result',
    failurePacketDigest:
      'fidelity validation result packet digest does not match packet',
    evidenceLabel: 'fidelity validation evidencePointers',
    evidenceStrings:
      'fidelity validation evidencePointers must contain strings',
    evidenceCoverage:
      'fidelity validation evidence pointer is not exact coverage',
    evidenceSort: 'fidelity validation evidencePointers must be sorted',
    ...policy.messages,
  }
  if (!isPlainRecord(value)) failResult(messages.resultObject)
  const result = value as Record<string, unknown>
  if (result.outcome === 'PASS') {
    exactSemanticKeys(
      result,
      ['outcome', 'packetDigest', 'checkIds', 'coveredTargets'],
      'fidelity PASS result',
      errorPrefix,
    )
    if (result.packetDigest !== policy.packetDigest)
      failResult('fidelity PASS packet digest does not match packet')
    const checkIds = exactSemanticStringCoverage(
      result.checkIds,
      policy.checkIds,
      'fidelity PASS checkIds',
      errorPrefix,
    )
    const coveredTargets = exactSemanticStringCoverage(
      result.coveredTargets,
      policy.coveredTargets,
      'fidelity PASS coveredTargets',
      errorPrefix,
    )
    return deepFreezeSemantic({
      outcome: 'PASS',
      packetDigest: policy.packetDigest,
      checkIds,
      coveredTargets,
    })
  }
  if (result.outcome !== 'FAIL' && result.outcome !== 'AMBIGUOUS')
    failResult('validation result outcome is invalid')
  const reasonCode = result.reasonCode
  if (
    reasonCode !== 'projection-mismatch' &&
    reasonCode !== 'missing-projection' &&
    reasonCode !== 'ambiguous-projection'
  )
    failResult('validation result reasonCode is invalid')
  if (result.outcome === 'FAIL' && reasonCode === 'ambiguous-projection')
    failResult('FAIL result cannot use ambiguous-projection')
  if (result.outcome === 'AMBIGUOUS' && reasonCode !== 'ambiguous-projection')
    failResult('AMBIGUOUS result must use ambiguous-projection')
  const requiresSubject =
    reasonCode === 'missing-projection' || reasonCode === 'ambiguous-projection'
  exactSemanticKeys(
    result,
    requiresSubject
      ? [
          'outcome',
          'packetDigest',
          'reasonCode',
          'actual',
          'missingSubject',
          'expectedProjection',
          'evidencePointers',
        ]
      : ['outcome', 'packetDigest', 'reasonCode', 'actual', 'evidencePointers'],
    messages.failureResultLabel,
    errorPrefix,
  )
  if (result.packetDigest !== policy.packetDigest)
    failResult(messages.failurePacketDigest)
  const evidence = strictSemanticArray(
    result.evidencePointers,
    messages.evidenceLabel,
    errorPrefix,
  )
  if (
    evidence.length === 0 ||
    evidence.some(pointer => typeof pointer !== 'string')
  )
    failResult(messages.evidenceStrings)
  const allowed = new Set(policy.allowedEvidencePointers)
  const expectedKind =
    reasonCode === 'projection-mismatch'
      ? policy.evidenceKindPolicy.projectionMismatch
      : policy.evidenceKindPolicy.projectionIdentity
  const prefix =
    expectedKind === 'binding'
      ? 'binding:'
      : expectedKind === 'section'
        ? 'section:'
        : undefined
  const seen = new Set<string>()
  for (const pointer of evidence as string[]) {
    if (seen.has(pointer) || !allowed.has(pointer))
      failResult(messages.evidenceCoverage)
    if (prefix && !pointer.startsWith(prefix))
      failResult(
        expectedKind === 'binding'
          ? 'projection mismatch evidence must use owner bindings'
          : 'missing or ambiguous evidence must use section pointers',
      )
    seen.add(pointer)
  }
  for (let index = 1; index < evidence.length; index += 1)
    if (
      compareCodeUnits(
        evidence[index - 1] as string,
        evidence[index] as string,
      ) >= 0
    )
      failResult(messages.evidenceSort)
  let missingSubject: string | undefined
  let expectedProjection: string | undefined
  if (requiresSubject) {
    missingSubject = semanticText(
      result.missingSubject,
      'fidelity missingSubject',
      errorPrefix,
    )
    const separator = missingSubject.indexOf('#')
    if (!missingSubject.startsWith('node:') || separator <= 'node:'.length)
      failResult('fidelity missingSubject must be node-qualified')
    const pointer = (() => {
      try {
        return parseGameIrTargetPointer(missingSubject.slice(separator + 1))
      } catch {
        return failResult('fidelity missingSubject target pointer is invalid')
      }
    })()
    const canonical = `node:${semanticSafeId(
      missingSubject.slice('node:'.length, separator),
      'fidelity missingSubject node ID',
      errorPrefix,
    )}#${pointer}`
    if (
      canonical !== missingSubject ||
      !policy.requiredTargets.includes(canonical)
    )
      failResult('fidelity missingSubject is not a required target')
    expectedProjection = semanticText(
      result.expectedProjection,
      'fidelity expectedProjection',
      errorPrefix,
    )
  }
  return deepFreezeSemantic({
    outcome: result.outcome,
    packetDigest: policy.packetDigest,
    reasonCode,
    actual: semanticText(result.actual, 'fidelity actual', errorPrefix),
    ...(requiresSubject ? { missingSubject, expectedProjection } : {}),
    evidencePointers: Object.freeze([...(evidence as string[])]),
  }) as SemanticValidationResult
}

export function verifyGameIrSemanticClaimBytes(
  authority: SemanticSourceClaimAuthority,
  claim: GameIrSemanticSourceClaim,
  errorPrefix = 'invalid Game IR semantic fidelity',
  policy: SemanticSourceClaimBytePolicy = {},
): void {
  const messages = {
    sourcePointerLabel: 'source claim pointer',
    outsideClosure:
      'semantic source claim lies outside selected source closure',
    bytesMissing: 'semantic source claim section bytes are missing',
    pointerOutsideBytes: 'semantic source claim pointer is out of bounds',
    pointerUnaligned: 'semantic source claim pointer is not UTF-8 aligned',
    invalidUtf8: 'semantic source claim bytes are not valid UTF-8',
    literalMismatch:
      'semantic source claim literal does not match exact source bytes',
    staleDigest: 'semantic source section bytes have a stale digest',
    verifySectionDigest: true,
    ...policy,
  }
  const section = authority.sectionIndex.find(
    candidate =>
      candidate.documentPath === claim.documentPath &&
      candidate.sectionId === claim.sectionId,
  )
  if (!section) fail(errorPrefix, messages.outsideClosure)
  const bytesText =
    authority.sectionBytes[`${claim.documentPath}#${claim.sectionId}`]
  if (bytesText === undefined) fail(errorPrefix, messages.bytesMissing)
  const pointer = normalizeSemanticSourcePointer(
    claim.sourcePointer,
    messages.sourcePointerLabel,
    errorPrefix,
  )
  const [, , startText, endText] = pointer.split('/')
  const start = Number(startText)
  const end = Number(endText)
  const bytes = Buffer.from(bytesText, 'utf8')
  if (end > bytes.length) fail(errorPrefix, messages.pointerOutsideBytes)
  const boundary = (offset: number) =>
    offset === 0 || offset === bytes.length || (bytes[offset]! & 0xc0) !== 0x80
  if (!boundary(start) || !boundary(end))
    fail(errorPrefix, messages.pointerUnaligned)
  let literal: string
  try {
    literal = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(start, end),
    )
  } catch {
    fail(errorPrefix, messages.invalidUtf8)
  }
  if (literal !== claim.literal) fail(errorPrefix, messages.literalMismatch)
  if (
    messages.verifySectionDigest &&
    section.digest !==
      createHash('sha256').update(bytesText, 'utf8').digest('hex')
  )
    fail(errorPrefix, messages.staleDigest)
}

function deepFreezeSemantic<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreezeSemantic(nested)
    Object.freeze(value)
  }
  return value
}
