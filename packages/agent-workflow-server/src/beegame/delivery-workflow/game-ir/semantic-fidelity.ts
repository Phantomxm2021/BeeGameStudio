import {
  compareCodeUnits,
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
  })
}

function deepFreezeSemantic<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreezeSemantic(nested)
    Object.freeze(value)
  }
  return value
}
