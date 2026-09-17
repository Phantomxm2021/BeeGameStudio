import { createHash } from 'node:crypto'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_RELATION_KINDS,
  RESOURCE_SOURCE_KINDS,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import type { FoundationDocumentPath } from '../../../../foundation-documents'
import { parseGameIrCompileRequest, type GameIrCompileRequest } from './contracts'

export type GameIrSourceSection = Readonly<{
  documentPath: FoundationDocumentPath
  sectionId: string
  heading: string
  startLine: number
  endLine: number
  digest: string
}>

export type GameIrAssetRequirement = Readonly<{
  id: string
  name: string
  required: boolean
  purpose: string
  dimensions: readonly string[]
  kinds: readonly string[]
  usageTags: readonly string[]
  capabilities: readonly string[]
  styles: readonly string[]
  acceptanceCriteria: readonly string[]
  coverage: readonly Readonly<Record<string, readonly string[]>>[]
  sourcing: Readonly<{
    allowedSourceKinds: readonly string[]
    licenseConstraints: readonly string[]
    responsibleParty: string
    handoffCriteria: readonly string[]
  }>
}>

export type GameIrConfigEntry = Readonly<{
  id: string
  name: string
  assetIds: readonly string[]
  config: Readonly<Record<string, unknown>>
}>

export type GameIrCandidate = Readonly<{
  schemaVersion: 'game-ir.v2'
  taskId: string
  sourceRevision: string
  parameters: Readonly<Record<string, unknown>>
  assets: readonly GameIrAssetRequirement[]
  scenes: readonly GameIrConfigEntry[]
  ui: readonly GameIrConfigEntry[]
  vfx: readonly GameIrConfigEntry[]
  logic: Readonly<Record<string, unknown>>
}>

type JsonObject = Record<string, unknown>
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const SHA256 = /^[a-f0-9]{64}$/u
const COVERAGE_VOCABULARIES = {
  assetKinds: RESOURCE_ASSET_KINDS,
  usageTags: RESOURCE_USAGE_TAGS,
  capabilities: RESOURCE_CAPABILITIES,
  relationKinds: RESOURCE_RELATION_KINDS,
  embeddedKinds: RESOURCE_EMBEDDED_COMPONENT_KINDS,
} as const
const COVERAGE_FIELDS = new Set(Object.keys(COVERAGE_VOCABULARIES))

function fail(message: string): never {
  throw new Error(`invalid Game IR candidate: ${message}`)
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    fail(`${label} must be a JSON object`)
  return value as JsonObject
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index]))
    fail(`${label} fields must be exactly ${wanted.join(', ')}`)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim())
    fail(`${label} must be trimmed non-empty text`)
  return value
}

function id(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SAFE_ID.test(result)) fail(`${label} must be a safe identifier`)
  return result
}

function strings(value: unknown, label: string, allowEmpty = true): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0))
    fail(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`)
  const result = value.map((entry, index) => text(entry, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates`)
  return result.sort(compareCodeUnits)
}

function vocabularyStrings(value: unknown, label: string, allowedValues: readonly string[],
  allowEmpty = true): string[] {
  const result = strings(value, label, allowEmpty)
  const allowed = new Set(allowedValues)
  for (const entry of result)
    if (!allowed.has(entry)) fail(`${label} contains unsupported value ${entry}`)
  return result
}

function normalizeJson(value: unknown, label: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`)
    return value
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalizeJson(entry, `${label}[${index}]`))
  const raw = object(value, label)
  return Object.fromEntries(Object.keys(raw).sort(compareCodeUnits)
    .map(key => [key, normalizeJson(raw[key], `${label}.${key}`)]))
}

function parseAsset(value: unknown, index: number): GameIrAssetRequirement {
  const raw = object(value, `assets[${index}]`)
  exactKeys(raw, ['id', 'name', 'required', 'purpose', 'dimensions', 'kinds', 'usageTags',
    'capabilities', 'styles', 'acceptanceCriteria', 'coverage', 'sourcing'], `assets[${index}]`)
  if (typeof raw.required !== 'boolean') fail(`assets[${index}].required must be boolean`)
  const sourcing = object(raw.sourcing, `assets[${index}].sourcing`)
  exactKeys(sourcing, ['allowedSourceKinds', 'licenseConstraints', 'responsibleParty', 'handoffCriteria'],
    `assets[${index}].sourcing`)
  if (!Array.isArray(raw.coverage)) fail(`assets[${index}].coverage must be an array`)
  const coverage = raw.coverage.map((entry, coverageIndex) => {
    const item = object(entry, `assets[${index}].coverage[${coverageIndex}]`)
    if (Object.keys(item).length === 0) fail(`assets[${index}].coverage[${coverageIndex}] must not be empty`)
    for (const key of Object.keys(item))
      if (!COVERAGE_FIELDS.has(key))
        fail(`assets[${index}].coverage[${coverageIndex}] has unknown field ${key}`)
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => compareCodeUnits(a, b))
      .map(([key, child]) => [key, vocabularyStrings(child,
        `assets[${index}].coverage[${coverageIndex}].${key}`,
        COVERAGE_VOCABULARIES[key as keyof typeof COVERAGE_VOCABULARIES], false)]))
  })
  if (coverage.length > 0 && Array.isArray(raw.capabilities) && raw.capabilities.length > 0)
    fail(`assets[${index}].capabilities must be empty when coverage is present`)
  return {
    id: id(raw.id, `assets[${index}].id`),
    name: text(raw.name, `assets[${index}].name`),
    required: raw.required,
    purpose: text(raw.purpose, `assets[${index}].purpose`),
    dimensions: vocabularyStrings(raw.dimensions, `assets[${index}].dimensions`, RESOURCE_DIMENSIONS, false),
    kinds: vocabularyStrings(raw.kinds, `assets[${index}].kinds`, RESOURCE_ASSET_KINDS, false),
    usageTags: vocabularyStrings(raw.usageTags, `assets[${index}].usageTags`, RESOURCE_USAGE_TAGS),
    capabilities: vocabularyStrings(raw.capabilities, `assets[${index}].capabilities`, RESOURCE_CAPABILITIES),
    styles: strings(raw.styles, `assets[${index}].styles`),
    acceptanceCriteria: strings(raw.acceptanceCriteria, `assets[${index}].acceptanceCriteria`, false),
    coverage,
    sourcing: {
      allowedSourceKinds: vocabularyStrings(sourcing.allowedSourceKinds,
        `assets[${index}].sourcing.allowedSourceKinds`, RESOURCE_SOURCE_KINDS, false),
      licenseConstraints: strings(sourcing.licenseConstraints, `assets[${index}].sourcing.licenseConstraints`, false),
      responsibleParty: text(sourcing.responsibleParty, `assets[${index}].sourcing.responsibleParty`),
      handoffCriteria: strings(sourcing.handoffCriteria, `assets[${index}].sourcing.handoffCriteria`, false),
    },
  }
}

function parseEntries(value: unknown, label: string, assets: ReadonlySet<string>): GameIrConfigEntry[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const entries = value.map((entry, index) => {
    const raw = object(entry, `${label}[${index}]`)
    exactKeys(raw, ['id', 'name', 'assetIds', 'config'], `${label}[${index}]`)
    const assetIds = strings(raw.assetIds, `${label}[${index}].assetIds`)
    for (const assetId of assetIds)
      if (!assets.has(assetId)) fail(`${label}[${index}] references unknown asset ${assetId}`)
    return {
      id: id(raw.id, `${label}[${index}].id`),
      name: text(raw.name, `${label}[${index}].name`),
      assetIds,
      config: normalizeJson(object(raw.config, `${label}[${index}].config`), `${label}[${index}].config`) as JsonObject,
    }
  }).sort((left, right) => compareCodeUnits(left.id, right.id))
  if (new Set(entries.map(entry => entry.id)).size !== entries.length)
    fail(`${label} IDs must be unique`)
  return entries
}

export function parseGameIrCandidate(value: unknown, input: { request: GameIrCompileRequest }): GameIrCandidate {
  const request = parseGameIrCompileRequest(input.request)
  const raw = object(normalizeJson(value, 'candidate'), 'candidate')
  exactKeys(raw, ['schemaVersion', 'taskId', 'sourceRevision', 'parameters', 'assets', 'scenes', 'ui', 'vfx', 'logic'], 'candidate')
  if (raw.schemaVersion !== 'game-ir.v2') fail('schemaVersion must be game-ir.v2')
  if (raw.taskId !== request.taskId) fail('taskId does not match compile request')
  if (raw.sourceRevision !== request.foundation.foundationRevision)
    fail('sourceRevision does not match accepted documents')
  if (!Array.isArray(raw.assets)) fail('assets must be an array')
  const assets = raw.assets.map(parseAsset).sort((left, right) => compareCodeUnits(left.id, right.id))
  if (new Set(assets.map(asset => asset.id)).size !== assets.length) fail('asset IDs must be unique')
  const assetIds = new Set(assets.map(asset => asset.id))
  const scenes = parseEntries(raw.scenes, 'scenes', assetIds)
  if (scenes.length === 0) fail('at least one scene is required')
  return freeze({
    schemaVersion: 'game-ir.v2',
    taskId: request.taskId,
    sourceRevision: request.foundation.foundationRevision,
    parameters: normalizeJson(object(raw.parameters, 'parameters'), 'parameters') as JsonObject,
    assets,
    scenes,
    ui: parseEntries(raw.ui, 'ui', assetIds),
    vfx: parseEntries(raw.vfx, 'vfx', assetIds),
    logic: normalizeJson(object(raw.logic, 'logic'), 'logic') as JsonObject,
  })
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value as JsonObject).sort(compareCodeUnits)
      .map(key => `${JSON.stringify(key)}:${canonical((value as JsonObject)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as JsonObject)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export function canonicalGameIrJson(value: unknown): string {
  return canonical(normalizeJson(value, '$'))
}

export function digestGameIrValue(value: unknown): string {
  return createHash('sha256').update(canonicalGameIrJson(value)).digest('hex')
}

export function digestGameIrSourceSectionIndex(sections: readonly GameIrSourceSection[]): string {
  const normalized = [...sections].map(section => {
    if (!SHA256.test(section.digest)) fail('source section digest is invalid')
    return section
  }).sort((left, right) => compareCodeUnits(
    `${left.documentPath}\0${left.startLine}\0${left.sectionId}`,
    `${right.documentPath}\0${right.startLine}\0${right.sectionId}`,
  ))
  return digestGameIrValue(normalized)
}
