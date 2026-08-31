import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_RELATION_KINDS,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import { BALANCE_DOMAIN_MANIFEST } from './balance-schema'
import { GAMEPLAY_DOMAIN_MANIFEST } from './gameplay-schema'
import { PRESENTATION_DOMAIN_MANIFEST } from './presentation-schema'
import {
  compareCodeUnits,
  parseGameIrModuleSet,
  type GameIrModuleCandidate,
  type GameIrSourceSection,
  type GameIrNode,
} from './model'
import type { GameIrCompileRequest } from './contracts'
import { WORLD_SCENE_DOMAIN_MANIFEST } from './world-scene-schema'
import { createSemanticFidelityPrimitives } from './semantic-fidelity'

export type ResourceRealizationResourceKind =
  | 'model'
  | 'mesh'
  | 'material'
  | 'texture'
  | 'rig'
  | 'animation'
  | 'audio'
  | 'music'
  | 'vfx'
  | 'shader'
  | 'ui-asset'
  | 'font'
  | 'scene'
  | 'prefab'
  | 'content'
  | 'config'

export const RESOURCE_REALIZATION_RESOURCE_KINDS = Object.freeze([
  'model',
  'mesh',
  'material',
  'texture',
  'rig',
  'animation',
  'audio',
  'music',
  'vfx',
  'shader',
  'ui-asset',
  'font',
  'scene',
  'prefab',
  'content',
  'config',
] as const)

export type ResourceRealizationRelationshipRole = Readonly<{
  targetKinds: readonly string[]
  cardinality: 'exactly-one' | 'at-least-one'
}>

type ResourceRealizationManifestEntry = Readonly<{
  valueFields: readonly string[]
  optionalValueFields?: readonly string[]
  relationships: Readonly<Record<string, ResourceRealizationRelationshipRole>>
}>

const role = (
  targetKinds: readonly string[],
  cardinality: ResourceRealizationRelationshipRole['cardinality'],
): ResourceRealizationRelationshipRole =>
  Object.freeze({ targetKinds: Object.freeze([...targetKinds]), cardinality })

const LOCAL_KINDS = Object.freeze([
  'resource-realization.logical-resource',
  'resource-realization.acquisition-profile',
  'resource-realization.delivery-target',
  'resource-realization.variant',
  'resource-realization.delivery-artifact',
] as const)

const PRIOR_MANIFESTS = [
  GAMEPLAY_DOMAIN_MANIFEST,
  BALANCE_DOMAIN_MANIFEST,
  WORLD_SCENE_DOMAIN_MANIFEST,
  PRESENTATION_DOMAIN_MANIFEST,
] as const
const PRIOR_MODULE_IDS = new Set([
  'gameplay',
  'balance',
  'world-scene',
  'presentation',
])
const PRIOR_NODE_KINDS = new Set<string>(
  PRIOR_MANIFESTS.flatMap(manifest => Object.keys(manifest)),
)

/** The sole Resource Realization authority for its node and relationship shape. */
export const RESOURCE_REALIZATION_DOMAIN_MANIFEST: Readonly<
  Record<string, ResourceRealizationManifestEntry>
> = Object.freeze({
  'resource-realization.logical-resource': Object.freeze({
    valueFields: Object.freeze([
      'requirementId',
      'resourceKind',
      'runtimeRole',
    ]),
    relationships: Object.freeze({
      'required-by': role(
        [...PRIOR_NODE_KINDS].sort(compareCodeUnits),
        'at-least-one',
      ),
    }),
  }),
  'resource-realization.acquisition-profile': Object.freeze({
    valueFields: Object.freeze([
      'required',
      'dimensions',
      'assetKinds',
      'usageTags',
      'capabilities',
      'styles',
      'sourcingPolicy',
    ]),
    optionalValueFields: Object.freeze(['name', 'purpose', 'coverage']),
    relationships: Object.freeze({
      describes: role(['resource-realization.logical-resource'], 'exactly-one'),
    }),
  }),
  'resource-realization.delivery-target': Object.freeze({
    valueFields: Object.freeze(['assetFormatCapabilities']),
    optionalValueFields: Object.freeze(['platform', 'runtime']),
    relationships: Object.freeze({}),
  }),
  'resource-realization.variant': Object.freeze({
    valueFields: Object.freeze(['activation']),
    relationships: Object.freeze({
      realizes: role(['resource-realization.logical-resource'], 'exactly-one'),
    }),
  }),
  'resource-realization.delivery-artifact': Object.freeze({
    valueFields: Object.freeze([
      'artifactClass',
      'path',
      'format',
      'runtimeRole',
    ]),
    optionalValueFields: Object.freeze([
      'codec',
      'technicalConstraints',
      'budgets',
    ]),
    relationships: Object.freeze({
      'part-of': role(['resource-realization.variant'], 'exactly-one'),
    }),
  }),
})

type RecordValue = Record<string, unknown>
type ParsedNode = GameIrNode & { value: Readonly<Record<string, unknown>> }

const fidelity = createSemanticFidelityPrimitives(
  'invalid Resource Realization module',
)
const NODE_KINDS = new Set<string>(LOCAL_KINDS)
const RESOURCE_KINDS = new Set<string>(RESOURCE_REALIZATION_RESOURCE_KINDS)
const DIMENSIONS = new Set<string>(RESOURCE_DIMENSIONS)
const ASSET_KINDS = new Set<string>(RESOURCE_ASSET_KINDS)
const USAGE_TAGS = new Set<string>(RESOURCE_USAGE_TAGS)
const CAPABILITIES = new Set<string>(RESOURCE_CAPABILITIES)
const RELATION_KINDS = new Set<string>(RESOURCE_RELATION_KINDS)
const EMBEDDED_KINDS = new Set<string>(RESOURCE_EMBEDDED_COMPONENT_KINDS)
const SOURCE_KINDS = new Set([
  'resource-library',
  'agent-authored',
  'user-provided',
])
const ARTIFACT_CLASSES = new Set([
  'runtime-resource',
  'content-definition',
  'generated-output',
])
const FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ROOTS: Readonly<Record<string, string>> = Object.freeze({
  'runtime-resource': 'assets/runtime',
  'content-definition': 'assets/content',
  'generated-output': 'assets/generated',
})

function isRecord(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function fail(message: string): never {
  throw new Error(`invalid Resource Realization module: ${message}`)
}

function exactKeys(
  value: RecordValue,
  expected: readonly string[],
  label: string,
): void {
  fidelity.exactKeys(value, expected, label)
}

function exactValueKeys(
  value: RecordValue,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(`${label} has a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${label} has a hidden or accessor property`)
    if (!allowed.has(key)) fail(`${label} has unknown or missing fields`)
  }
  for (const key of required)
    if (!Object.hasOwn(value, key))
      fail(`${label} is missing required field ${key}`)
}

function text(value: unknown, label: string): string {
  return fidelity.text(value, label)
}

function safeId(value: unknown, label: string): string {
  return fidelity.safeId(value, label)
}

function strictArray(value: unknown, label: string): unknown[] {
  return fidelity.strictArray(value, label)
}

function sortedUniqueTextArray(
  value: unknown,
  label: string,
  allowed?: ReadonlySet<string>,
  nonEmpty = false,
): string[] {
  const entries = strictArray(value, label)
  if (nonEmpty && entries.length === 0) fail(`${label} must not be empty`)
  const result = entries.map((entry, index) => {
    const item = text(entry, `${label}[${index}]`)
    if (allowed && !allowed.has(item))
      fail(`${label}[${index}] is not admitted`)
    return item
  })
  for (let index = 1; index < result.length; index += 1) {
    if (compareCodeUnits(result[index - 1]!, result[index]!) >= 0)
      fail(`${label} must be unique and sorted`)
  }
  return result
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(`${label} must be finite`)
  return value
}

function nonNegative(value: unknown, label: string): number {
  const result = finite(value, label)
  if (result < 0) fail(`${label} must be non-negative`)
  return result
}

function lowerFormat(value: unknown, label: string): string {
  const result = text(value, label)
  if (!FORMAT.test(result)) fail(`${label} must be a lowercase ASCII format`)
  return result
}

function parseCoverage(value: unknown, label: string): RecordValue[] {
  const entries = strictArray(value, label)
  if (entries.length === 0) fail(`${label} must not be empty`)
  const parsed = entries.map((entry, index) => {
    if (!isRecord(entry)) fail(`${label}[${index}] must be an object`)
    exactValueKeys(
      entry,
      [],
      [
        'assetKinds',
        'usageTags',
        'capabilities',
        'relationKinds',
        'embeddedKinds',
      ],
      `${label}[${index}]`,
    )
    const parsed: RecordValue = {}
    let constrained = false
    for (const [field, allowed] of [
      ['assetKinds', ASSET_KINDS],
      ['usageTags', USAGE_TAGS],
      ['capabilities', CAPABILITIES],
      ['relationKinds', RELATION_KINDS],
      ['embeddedKinds', EMBEDDED_KINDS],
    ] as const) {
      if (!Object.hasOwn(entry, field)) continue
      const values = sortedUniqueTextArray(
        entry[field],
        `${label}[${index}].${field}`,
        allowed,
        true,
      )
      parsed[field] = values
      constrained = true
    }
    if (!constrained)
      fail(`${label}[${index}] must contain a non-empty constraint`)
    const key = [
      'assetKinds',
      'usageTags',
      'capabilities',
      'relationKinds',
      'embeddedKinds',
    ]
      .map(
        field =>
          `${field}:${(parsed[field] as string[] | undefined)?.join('\0') ?? ''}`,
      )
      .join('\0')
    return { value: parsed, key }
  })
  for (let index = 1; index < parsed.length; index += 1)
    if (compareCodeUnits(parsed[index - 1]!.key, parsed[index]!.key) >= 0)
      fail(`${label} must be unique and sorted`)
  return parsed.map(entry => entry.value)
}

function parseSourcingPolicy(value: unknown, label: string): RecordValue {
  if (!isRecord(value)) fail(`${label} must be an object`)
  exactKeys(
    value,
    [
      'allowedSourceKinds',
      'licenseConstraints',
      'responsibleParty',
      'handoffCriteria',
    ],
    label,
  )
  return {
    allowedSourceKinds: sortedUniqueTextArray(
      value.allowedSourceKinds,
      `${label}.allowedSourceKinds`,
      SOURCE_KINDS,
      true,
    ),
    licenseConstraints: sortedUniqueTextArray(
      value.licenseConstraints,
      `${label}.licenseConstraints`,
    ),
    responsibleParty: text(value.responsibleParty, `${label}.responsibleParty`),
    handoffCriteria: sortedUniqueTextArray(
      value.handoffCriteria,
      `${label}.handoffCriteria`,
      undefined,
      true,
    ),
  }
}

function parseProfile(node: GameIrNode): Readonly<Record<string, unknown>> {
  const value = node.value
  const descriptor = RESOURCE_REALIZATION_DOMAIN_MANIFEST[node.kind]!
  exactValueKeys(
    value,
    descriptor.valueFields,
    descriptor.optionalValueFields ?? [],
    `node ${node.id} value`,
  )
  const dimensions = sortedUniqueTextArray(
    value.dimensions,
    `node ${node.id} dimensions`,
    DIMENSIONS,
    true,
  )
  const assetKinds = sortedUniqueTextArray(
    value.assetKinds,
    `node ${node.id} assetKinds`,
    ASSET_KINDS,
    true,
  )
  const usageTags = sortedUniqueTextArray(
    value.usageTags,
    `node ${node.id} usageTags`,
    USAGE_TAGS,
  )
  const capabilities = sortedUniqueTextArray(
    value.capabilities,
    `node ${node.id} capabilities`,
    CAPABILITIES,
  )
  const styles = sortedUniqueTextArray(value.styles, `node ${node.id} styles`)
  const result: RecordValue = {
    required: value.required,
    dimensions,
    assetKinds,
    usageTags,
    capabilities,
    styles,
    sourcingPolicy: parseSourcingPolicy(
      value.sourcingPolicy,
      `node ${node.id} sourcingPolicy`,
    ),
  }
  if (typeof value.required !== 'boolean')
    fail(`node ${node.id} required must be boolean`)
  if (Object.hasOwn(value, 'name'))
    result.name = text(value.name, `node ${node.id} name`)
  if (Object.hasOwn(value, 'purpose'))
    result.purpose = text(value.purpose, `node ${node.id} purpose`)
  if (Object.hasOwn(value, 'coverage')) {
    if (capabilities.length > 0)
      fail(`node ${node.id} top-level capabilities must be empty with coverage`)
    result.coverage = parseCoverage(value.coverage, `node ${node.id} coverage`)
  }
  return result
}

function parseLogical(node: GameIrNode): Readonly<Record<string, unknown>> {
  exactKeys(
    node.value,
    ['requirementId', 'resourceKind', 'runtimeRole'],
    `node ${node.id} value`,
  )
  const requirementId = safeId(
    node.value.requirementId,
    `node ${node.id} requirementId`,
  )
  if (node.id !== `resource.requirement.${requirementId}`)
    fail(
      `node ${node.id} must canonically identify requirement ${requirementId}`,
    )
  const resourceKind = text(
    node.value.resourceKind,
    `node ${node.id} resourceKind`,
  )
  if (!RESOURCE_KINDS.has(resourceKind))
    fail(`node ${node.id} resourceKind is not admitted`)
  return {
    requirementId,
    resourceKind: resourceKind as ResourceRealizationResourceKind,
    runtimeRole: text(node.value.runtimeRole, `node ${node.id} runtimeRole`),
  }
}

function parseTarget(node: GameIrNode): Readonly<Record<string, unknown>> {
  const descriptor = RESOURCE_REALIZATION_DOMAIN_MANIFEST[node.kind]!
  exactValueKeys(
    node.value,
    descriptor.valueFields,
    descriptor.optionalValueFields ?? [],
    `node ${node.id} value`,
  )
  const capabilities = sortedUniqueTextArray(
    node.value.assetFormatCapabilities,
    `node ${node.id} assetFormatCapabilities`,
    undefined,
    true,
  ).map((value, index) =>
    lowerFormat(value, `node ${node.id} assetFormatCapabilities[${index}]`),
  )
  for (let index = 1; index < capabilities.length; index += 1)
    if (compareCodeUnits(capabilities[index - 1]!, capabilities[index]!) >= 0)
      fail(`node ${node.id} assetFormatCapabilities must be unique and sorted`)
  const result: RecordValue = { assetFormatCapabilities: capabilities }
  if (Object.hasOwn(node.value, 'platform'))
    result.platform = text(node.value.platform, `node ${node.id} platform`)
  if (Object.hasOwn(node.value, 'runtime'))
    result.runtime = text(node.value.runtime, `node ${node.id} runtime`)
  return result
}

function parseActivation(value: unknown, label: string): RecordValue {
  if (!isRecord(value)) fail(`${label} must be an object`)
  if (value.kind === 'required') {
    exactKeys(value, ['kind'], label)
    return { kind: 'required' }
  }
  if (value.kind === 'alternative') {
    exactKeys(value, ['kind', 'groupId'], label)
    return {
      kind: 'alternative',
      groupId: safeId(value.groupId, `${label}.groupId`),
    }
  }
  if (value.kind === 'conditional') {
    exactKeys(value, ['kind', 'predicate'], label)
    if (!isRecord(value.predicate)) fail(`${label}.predicate must be an object`)
    exactKeys(
      value.predicate,
      ['field', 'operator', 'value'],
      `${label}.predicate`,
    )
    const field = value.predicate.field
    const operator = value.predicate.operator
    if (
      field !== 'platform' &&
      field !== 'runtime' &&
      field !== 'asset-format-capability'
    )
      fail(`${label}.predicate field is invalid`)
    if (
      (field === 'asset-format-capability' && operator !== 'contains') ||
      (field !== 'asset-format-capability' && operator !== 'eq')
    )
      fail(`${label}.predicate operator does not match field`)
    return {
      kind: 'conditional',
      predicate: {
        field,
        operator,
        value: text(value.predicate.value, `${label}.predicate.value`),
      },
    }
  }
  fail(`${label} kind is invalid`)
}

function parseVariant(node: GameIrNode): Readonly<Record<string, unknown>> {
  exactKeys(node.value, ['activation'], `node ${node.id} value`)
  return {
    activation: parseActivation(
      node.value.activation,
      `node ${node.id} activation`,
    ),
  }
}

function parseAssertion(value: unknown, label: string): RecordValue {
  if (!isRecord(value)) fail(`${label} must be an object`)
  if (value.operator === 'eq') {
    exactValueKeys(value, ['operator', 'value'], ['unit'], label)
    if (
      !['string', 'number', 'boolean'].includes(typeof value.value) ||
      (typeof value.value === 'number' && !Number.isFinite(value.value)) ||
      (typeof value.value === 'string' && value.value.trim().length === 0)
    )
      fail(`${label}.value is invalid`)
    const result: RecordValue = { operator: 'eq', value: value.value }
    if (Object.hasOwn(value, 'unit'))
      result.unit = text(value.unit, `${label}.unit`)
    return result
  }
  if (value.operator === 'lte' || value.operator === 'gte') {
    exactKeys(value, ['operator', 'value', 'unit'], label)
    return {
      operator: value.operator,
      value: finite(value.value, `${label}.value`),
      unit: text(value.unit, `${label}.unit`),
    }
  }
  if (value.operator === 'range') {
    exactKeys(value, ['operator', 'min', 'max', 'unit'], label)
    const min = finite(value.min, `${label}.min`)
    const max = finite(value.max, `${label}.max`)
    if (min > max) fail(`${label} range must be ordered`)
    return {
      operator: 'range',
      min,
      max,
      unit: text(value.unit, `${label}.unit`),
    }
  }
  if (value.operator === 'one-of') {
    exactValueKeys(value, ['operator', 'values'], ['unit'], label)
    const entries = strictArray(value.values, `${label}.values`)
    if (entries.length === 0) fail(`${label}.values must not be empty`)
    const types = new Set(entries.map(entry => typeof entry))
    if (
      types.size !== 1 ||
      (types.has('number') &&
        entries.some(entry => !Number.isFinite(entry as number))) ||
      entries.some(
        entry =>
          (typeof entry === 'string' && entry.trim().length === 0) ||
          (typeof entry !== 'string' && typeof entry !== 'number'),
      )
    )
      fail(`${label}.values must be homogeneous finite strings or numbers`)
    for (let index = 1; index < entries.length; index += 1) {
      const left = entries[index - 1]!
      const right = entries[index]!
      if (
        (typeof left === 'string' &&
          typeof right === 'string' &&
          compareCodeUnits(left, right) >= 0) ||
        (typeof left === 'number' && typeof right === 'number' && left >= right)
      )
        fail(`${label}.values must be unique and sorted`)
    }
    const result: RecordValue = { operator: 'one-of', values: [...entries] }
    if (Object.hasOwn(value, 'unit'))
      result.unit = text(value.unit, `${label}.unit`)
    return result
  }
  fail(`${label}.operator is invalid`)
}

function parseArtifact(
  node: GameIrNode,
  target: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const descriptor = RESOURCE_REALIZATION_DOMAIN_MANIFEST[node.kind]!
  exactValueKeys(
    node.value,
    descriptor.valueFields,
    descriptor.optionalValueFields ?? [],
    `node ${node.id} value`,
  )
  const artifactClass = text(
    node.value.artifactClass,
    `node ${node.id} artifactClass`,
  )
  if (!ARTIFACT_CLASSES.has(artifactClass))
    fail(`node ${node.id} artifactClass is invalid`)
  const path = text(node.value.path, `node ${node.id} path`)
  const segments = path.split('/')
  if (
    path.startsWith('/') ||
    path.includes('\0') ||
    path.includes('\\') ||
    segments.some(
      segment => segment.length === 0 || segment === '.' || segment === '..',
    )
  )
    fail(`node ${node.id} path must be safe and project-relative`)
  const root = ROOTS[artifactClass]!
  if (!path.startsWith(`${root}/`))
    fail(`node ${node.id} path is outside its artifact class root`)
  const format = lowerFormat(node.value.format, `node ${node.id} format`)
  if (!path.endsWith(`.${format}`))
    fail(`node ${node.id} path extension does not match format`)
  const capabilities = target.assetFormatCapabilities as readonly string[]
  if (!capabilities.includes(format))
    fail(`node ${node.id} format is not supported by the delivery target`)
  const result: RecordValue = {
    artifactClass,
    path,
    format,
    runtimeRole: text(node.value.runtimeRole, `node ${node.id} runtimeRole`),
  }
  if (Object.hasOwn(node.value, 'codec'))
    result.codec = text(node.value.codec, `node ${node.id} codec`)
  if (Object.hasOwn(node.value, 'technicalConstraints')) {
    const constraints = strictArray(
      node.value.technicalConstraints,
      `node ${node.id} technicalConstraints`,
    )
    if (constraints.length === 0)
      fail(`node ${node.id} technicalConstraints must not be empty`)
    const parsedConstraints = constraints.map((entry, index) => {
      if (!isRecord(entry))
        fail(`node ${node.id} technicalConstraints[${index}] must be an object`)
      exactKeys(
        entry,
        ['name', 'assertion'],
        `node ${node.id} technicalConstraints[${index}]`,
      )
      return {
        name: text(
          entry.name,
          `node ${node.id} technicalConstraints[${index}].name`,
        ),
        assertion: parseAssertion(
          entry.assertion,
          `node ${node.id} technicalConstraints[${index}].assertion`,
        ),
      }
    })
    for (let index = 1; index < parsedConstraints.length; index += 1)
      if (
        compareCodeUnits(
          parsedConstraints[index - 1]!.name,
          parsedConstraints[index]!.name,
        ) >= 0
      )
        fail(
          `node ${node.id} technicalConstraints must be unique and sorted by name`,
        )
    result.technicalConstraints = parsedConstraints
  }
  if (Object.hasOwn(node.value, 'budgets')) {
    const budgets = strictArray(node.value.budgets, `node ${node.id} budgets`)
    if (budgets.length === 0) fail(`node ${node.id} budgets must not be empty`)
    const parsedBudgets = budgets.map((entry, index) => {
      if (!isRecord(entry))
        fail(`node ${node.id} budgets[${index}] must be an object`)
      exactKeys(
        entry,
        ['metric', 'limit', 'unit'],
        `node ${node.id} budgets[${index}]`,
      )
      return {
        metric: text(entry.metric, `node ${node.id} budgets[${index}].metric`),
        limit: nonNegative(
          entry.limit,
          `node ${node.id} budgets[${index}].limit`,
        ),
        unit: text(entry.unit, `node ${node.id} budgets[${index}].unit`),
      }
    })
    for (let index = 1; index < parsedBudgets.length; index += 1) {
      const previous = `${parsedBudgets[index - 1]!.metric}\0${parsedBudgets[index - 1]!.unit}`
      const current = `${parsedBudgets[index]!.metric}\0${parsedBudgets[index]!.unit}`
      if (compareCodeUnits(previous, current) >= 0)
        fail(`node ${node.id} budgets must be unique and sorted`)
    }
    result.budgets = parsedBudgets
  }
  return result
}

function targetMap(
  nodes: readonly GameIrNode[],
  priorNodes: readonly GameIrNode[],
): Map<string, GameIrNode> {
  const targets = new Map<string, GameIrNode>()
  for (const node of nodes) {
    if (targets.has(node.id)) fail(`duplicate node ID ${node.id}`)
    targets.set(node.id, node)
  }
  for (const node of priorNodes) {
    if (targets.has(node.id)) fail(`duplicate node ID ${node.id}`)
    targets.set(node.id, node)
  }
  return targets
}

function priorNodesFromSet(
  modules: readonly GameIrModuleCandidate[],
): GameIrNode[] {
  const priorNodes: GameIrNode[] = []
  const priorIds = new Set<string>()
  for (const prior of modules) {
    if (!PRIOR_MODULE_IDS.has(prior.moduleId))
      fail(`external module ${prior.moduleId} is not an admitted prior module`)
    for (const node of prior.nodes) {
      if (!PRIOR_NODE_KINDS.has(node.kind))
        fail(`external target ${node.id} kind is not admitted`)
      if (priorIds.has(node.id))
        fail(`duplicate external target node ID ${node.id}`)
      priorIds.add(node.id)
      priorNodes.push(node)
    }
  }
  return priorNodes
}

function validateEdges(
  node: GameIrNode,
  targets: ReadonlyMap<string, GameIrNode>,
): void {
  strictArray(node.references, `node ${node.id} references`)
  if (node.references.length > 0)
    fail(`node ${node.id} references must be empty`)
  strictArray(node.edges, `node ${node.id} edges`)
  const seen = new Set<string>()
  let previous: string | undefined
  for (const [index, entry] of node.edges.entries()) {
    if (!isRecord(entry))
      fail(`node ${node.id} edge ${index} must be an object`)
    exactKeys(entry, ['type', 'targetId', 'targetType'], `node ${node.id} edge`)
    const type = text(entry.type, `node ${node.id} edge type`)
    const targetId = safeId(entry.targetId, `node ${node.id} edge targetId`)
    const targetType = text(entry.targetType, `node ${node.id} edge targetType`)
    const target = targets.get(targetId)
    if (!target) fail(`node ${node.id} edge targets unknown node ${targetId}`)
    if (target.kind !== targetType)
      fail(`node ${node.id} edge target kind does not match ${targetId}`)
    const key = `${type}\0${targetId}\0${targetType}`
    if (seen.has(key)) fail(`node ${node.id} has duplicate relationship edge`)
    if (previous !== undefined && compareCodeUnits(previous, key) >= 0)
      fail(`node ${node.id} edges must be unique and sorted`)
    seen.add(key)
    previous = key
  }
}

function validateRelationships(node: GameIrNode): void {
  const descriptor = RESOURCE_REALIZATION_DOMAIN_MANIFEST[node.kind]!
  const counts = new Map<string, number>()
  for (const edge of node.edges) {
    const roleDescriptor = descriptor.relationships[edge.type]
    if (!roleDescriptor)
      fail(`node ${node.id} has unknown relationship role ${edge.type}`)
    if (!roleDescriptor.targetKinds.includes(edge.targetType)) {
      fail(`node ${node.id} role ${edge.type} has wrong target kind`)
    }
    counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1)
  }
  for (const [name, rule] of Object.entries(descriptor.relationships)) {
    const count = counts.get(name) ?? 0
    if (rule.cardinality === 'exactly-one' && count !== 1)
      fail(`node ${node.id} relationship ${name} must occur exactly once`)
    if (rule.cardinality === 'at-least-one' && count < 1)
      fail(`node ${node.id} relationship ${name} must occur at least once`)
  }
}

function edgeTo(
  node: GameIrNode,
  type: string,
): GameIrNode['edges'][number] | undefined {
  return node.edges.find(edge => edge.type === type)
}

function validateGraph(
  nodes: readonly ParsedNode[],
  target: Readonly<Record<string, unknown>>,
): void {
  const logicals = nodes.filter(
    node => node.kind === 'resource-realization.logical-resource',
  )
  if (logicals.length === 0)
    fail(
      'Resource Realization module must declare at least one logical resource',
    )
  const profiles = nodes.filter(
    node => node.kind === 'resource-realization.acquisition-profile',
  )
  const variants = nodes.filter(
    node => node.kind === 'resource-realization.variant',
  )
  const artifacts = nodes.filter(
    node => node.kind === 'resource-realization.delivery-artifact',
  )
  const logicalById = new Map(logicals.map(node => [node.id, node]))
  const profileCounts = new Map<string, number>()
  for (const profile of profiles)
    profileCounts.set(
      edgeTo(profile, 'describes')!.targetId,
      (profileCounts.get(edgeTo(profile, 'describes')!.targetId) ?? 0) + 1,
    )
  const variantsByLogical = new Map<string, ParsedNode[]>()
  for (const variant of variants) {
    const logicalId = edgeTo(variant, 'realizes')!.targetId
    const list = variantsByLogical.get(logicalId) ?? []
    list.push(variant)
    variantsByLogical.set(logicalId, list)
  }
  const artifactsByVariant = new Map<string, ParsedNode[]>()
  for (const artifact of artifacts) {
    const variantId = edgeTo(artifact, 'part-of')!.targetId
    const list = artifactsByVariant.get(variantId) ?? []
    list.push(artifact)
    artifactsByVariant.set(variantId, list)
  }
  const paths = new Set<string>()
  for (const logical of logicals) {
    if (!logicalById.has(logical.id))
      fail(`logical resource ${logical.id} is detached`)
    if (profileCounts.get(logical.id) !== 1)
      fail(
        `logical resource ${logical.id} must have exactly one acquisition profile`,
      )
    const linkedVariants = variantsByLogical.get(logical.id) ?? []
    if (linkedVariants.length === 0)
      fail(`logical resource ${logical.id} must have at least one variant`)
    for (const variant of linkedVariants) {
      const linkedArtifacts = artifactsByVariant.get(variant.id) ?? []
      if (linkedArtifacts.length === 0)
        fail(`variant ${variant.id} must have at least one delivery artifact`)
      const activation = variant.value.activation as RecordValue
      if (activation.kind === 'conditional') {
        const predicate = activation.predicate as RecordValue
        const field = predicate.field
        const value = predicate.value
        if (field === 'asset-format-capability') {
          if (
            !(target.assetFormatCapabilities as readonly string[]).includes(
              value as string,
            )
          )
            fail(`variant ${variant.id} conditional predicate is unreachable`)
        } else if (
          (field === 'platform' || field === 'runtime') &&
          target[field] !== value
        ) {
          fail(`variant ${variant.id} conditional predicate is unreachable`)
        }
      }
      for (const artifact of linkedArtifacts) {
        const path = artifact.value.path as string
        if (paths.has(path))
          fail(`delivery artifact path ${path} is duplicated`)
        paths.add(path)
      }
    }
  }
  const alternativeGroups = new Map<string, string[]>()
  for (const variant of variants) {
    const activation = variant.value.activation as RecordValue
    if (activation.kind !== 'alternative') continue
    const key = `${edgeTo(variant, 'realizes')!.targetId}\0${activation.groupId as string}`
    const group = alternativeGroups.get(key) ?? []
    group.push(variant.id)
    alternativeGroups.set(key, group)
  }
  for (const [key, group] of alternativeGroups)
    if (group.length < 2)
      fail(`alternative group ${key} must contain at least two variants`)
}

export function parseResourceRealizationModule(
  value: unknown,
  input: Readonly<{
    request: GameIrCompileRequest
    sections: readonly GameIrSourceSection[]
    externalModules?: readonly unknown[]
  }>,
): GameIrModuleCandidate {
  if (
    input.externalModules !== undefined &&
    !Array.isArray(input.externalModules)
  )
    fail('externalModules must be an array')
  const moduleSet = parseGameIrModuleSet(value, {
    request: input.request,
    sections: input.sections,
    expectedModuleId: 'resource-realization',
    externalModules: input.externalModules,
  })
  const candidateModule = moduleSet.current
  const priorNodes = priorNodesFromSet(moduleSet.external)
  const targets = targetMap(candidateModule.nodes, priorNodes)
  const targetNodes = candidateModule.nodes.filter(
    node => node.kind === 'resource-realization.delivery-target',
  )
  if (targetNodes.length !== 1)
    fail('module must declare exactly one delivery target')
  const parsed: ParsedNode[] = []
  for (const rawNode of candidateModule.nodes) {
    const node = rawNode as unknown as GameIrNode
    if (!isRecord(node)) fail('node must be an object')
    const nodeId = safeId(node.id, 'node id')
    exactKeys(
      node,
      [
        'id',
        'kind',
        'producerMode',
        'value',
        'references',
        'edges',
        'bindings',
      ],
      `node ${node.id}`,
    )
    if (!isRecord(node.value)) fail(`node ${nodeId} value must be an object`)
    if (!isRecord(node.bindings))
      fail(`node ${nodeId} bindings must be an object`)
    if (!NODE_KINDS.has(node.kind)) fail(`node ${node.id} has an unknown kind`)
    if (node.kind === 'resource-realization.logical-resource') {
      if (node.producerMode !== 'semantic' && node.producerMode !== 'derived')
        fail(`node ${node.id} producer mode is invalid`)
    } else if (node.producerMode !== 'semantic')
      fail(`node ${node.id} producer mode must be semantic`)
    validateEdges(node, targets)
    validateRelationships(node)
    let parsedValue: Readonly<Record<string, unknown>>
    if (node.kind === 'resource-realization.logical-resource')
      parsedValue = parseLogical(node)
    else if (node.kind === 'resource-realization.acquisition-profile')
      parsedValue = parseProfile(node)
    else if (node.kind === 'resource-realization.delivery-target')
      parsedValue = parseTarget(node)
    else if (node.kind === 'resource-realization.variant')
      parsedValue = parseVariant(node)
    else parsedValue = parseArtifact(node, parseTarget(targetNodes[0]!))
    parsed.push({
      ...node,
      value: parsedValue,
      references: [],
      edges: node.edges.map(edge => ({ ...edge })),
      bindings: structuredClone(node.bindings),
    })
  }
  for (let index = 1; index < parsed.length; index += 1)
    if (compareCodeUnits(parsed[index - 1]!.id, parsed[index]!.id) >= 0)
      fail('node IDs must be unique and sorted')
  validateGraph(parsed, parseTarget(targetNodes[0]!))
  return fidelity.deepFreeze({
    moduleId: 'resource-realization',
    nodes: parsed,
  })
}
