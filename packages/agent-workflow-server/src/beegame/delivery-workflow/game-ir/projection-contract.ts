import {
  BALANCE_DOMAIN_MANIFEST,
  type BalanceReferencePolicy,
} from './balance-schema'
import { GAMEPLAY_DOMAIN_MANIFEST } from './gameplay-schema'
import { IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST } from './implementation-verification-schema'
import { PRESENTATION_DOMAIN_MANIFEST } from './presentation-schema'
import { RESOURCE_REALIZATION_DOMAIN_MANIFEST } from './resource-realization-schema'
import { WORLD_SCENE_DOMAIN_MANIFEST } from './world-scene-schema'
import { compareCodeUnits } from './model'
import {
  projectionValueFields,
  projectionValueProperties,
  projectionValueRequiredFields,
} from './projection-schema'

export type GameIrProjectionModuleId =
  | 'gameplay'
  | 'balance'
  | 'world-scene'
  | 'presentation'
  | 'resource-realization'
  | 'implementation-verification'

type ManifestRelationship = Readonly<{
  targetKinds: readonly string[]
  required?: boolean
  singleton?: boolean
  cardinality?: string
}>
type ManifestReferencePolicy = BalanceReferencePolicy
type ManifestEntry = Readonly<{
  valueJsonSchema: Readonly<Record<string, unknown>>
  relationships: Readonly<Record<string, ManifestRelationship>>
  referencePolicy?: ManifestReferencePolicy
}>

const manifests: Record<
  GameIrProjectionModuleId,
  Readonly<Record<string, ManifestEntry>>
> = {
  gameplay: GAMEPLAY_DOMAIN_MANIFEST,
  balance: BALANCE_DOMAIN_MANIFEST,
  'world-scene': WORLD_SCENE_DOMAIN_MANIFEST,
  presentation: PRESENTATION_DOMAIN_MANIFEST,
  'resource-realization': RESOURCE_REALIZATION_DOMAIN_MANIFEST,
  'implementation-verification': IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST,
}

export type GameIrProjectionValueContract = Readonly<{
  required: readonly string[]
  optional: readonly string[]
  fields: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}>

export type GameIrProjectionRelationshipContract = Readonly<{
  nodeKind: string
  role: string
  targetKinds: readonly string[]
  required: boolean
  singleton: boolean
  cardinality: string
}>
export type GameIrProjectionReferencePolicy = BalanceReferencePolicy

export type GameIrProjectionContract = Readonly<{
  moduleId: GameIrProjectionModuleId
  nodes: readonly Readonly<{
    kind: string
    value: GameIrProjectionValueContract
    relationships: readonly GameIrProjectionRelationshipContract[]
    referencePolicy?: GameIrProjectionReferencePolicy
  }>[]
  relationships: readonly GameIrProjectionRelationshipContract[]
  sourceEvidence: Readonly<{
    nodeCoverage: 'each emitted node ID appears in exactly one evidence group'
    grouping: 'one or more node IDs per service-owned evidence fragment'
    fragmentId: 'exact source.sections[].evidenceFragments[].fragmentId'
  }>
}>

function valueContract(entry: ManifestEntry): GameIrProjectionValueContract {
  const schema = entry.valueJsonSchema
  const properties = projectionValueProperties(schema)
  const schemaFields = projectionValueFields(schema)
  const required = projectionValueRequiredFields(schema)
  const optional = schemaFields.filter(field => !required.includes(field))
  return Object.freeze({
    required: Object.freeze(required),
    optional: Object.freeze(optional),
    fields: properties as Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >,
  })
}

function cardinality(relationship: ManifestRelationship): string {
  if (relationship.cardinality) return relationship.cardinality
  if (relationship.singleton && relationship.required) return 'exactly-one'
  if (relationship.singleton) return 'zero-or-one'
  if (relationship.required) return 'at-least-one'
  return 'zero-or-more'
}

export function buildGameIrProjectionContract(
  moduleId: GameIrProjectionModuleId,
): GameIrProjectionContract {
  const manifest = manifests[moduleId]
  if (!manifest)
    throw new Error(`unknown Game IR projection module: ${moduleId}`)
  const nodes = Object.keys(manifest)
    .sort(compareCodeUnits)
    .map(kind => {
      const entry = manifest[kind]!
      const relationships = Object.keys(entry.relationships)
        .sort(compareCodeUnits)
        .map(role => {
          const relationship = entry.relationships[role]!
          return Object.freeze({
            nodeKind: kind,
            role,
            targetKinds: Object.freeze(
              [...relationship.targetKinds].sort(compareCodeUnits),
            ),
            required: relationship.required === true,
            singleton: relationship.singleton === true,
            cardinality: cardinality(relationship),
          })
        })
      return Object.freeze({
        kind,
        value: valueContract(entry),
        relationships: Object.freeze(relationships),
        ...(entry.referencePolicy
          ? { referencePolicy: Object.freeze({ ...entry.referencePolicy }) }
          : {}),
      })
    })
  const relationships = Object.freeze(
    nodes
      .flatMap(node => node.relationships)
      .sort((left, right) =>
        compareCodeUnits(
          `${left.nodeKind}\0${left.role}\0${left.targetKinds.join(',')}`,
          `${right.nodeKind}\0${right.role}\0${right.targetKinds.join(',')}`,
        ),
      ),
  )
  return Object.freeze({
    moduleId,
    nodes: Object.freeze(nodes),
    relationships,
    sourceEvidence: {
      nodeCoverage:
        'each emitted node ID appears in exactly one evidence group',
      grouping: 'one or more node IDs per service-owned evidence fragment',
      fragmentId: 'exact source.sections[].evidenceFragments[].fragmentId',
    } as const,
  })
}

type JsonSchema = Record<string, unknown>

function nodeSchema(
  node: GameIrProjectionContract['nodes'][number],
): JsonSchema {
  const referencePolicy = node.referencePolicy
  const valueProperties = Object.fromEntries(
    Object.entries(node.value.fields).map(([field, schema]) => {
      if (
        referencePolicy?.kind === 'exact-single-index-reference' &&
        field === referencePolicy.indexField
      )
        return [field, { ...schema, const: referencePolicy.requiredIndex }]
      return [field, schema]
    }),
  )
  const referenceItems = {
    type: 'object',
    additionalProperties: false,
    properties: {
      targetId: {
        type: 'string',
        minLength: 1,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
      },
      targetType:
        referencePolicy?.kind === 'exact-single-index-reference'
          ? { enum: referencePolicy.targetKinds }
          : referencePolicy?.kind === 'formula-indexed-references'
            ? {
                enum: [
                  ...new Set(
                    referencePolicy.indexedReferences.flatMap(
                      rule => rule.targetKinds,
                    ),
                  ),
                ],
              }
          : { type: 'string', minLength: 1 },
    },
    required: ['targetId', 'targetType'],
  }
  const relationshipSchema =
    node.relationships.length === 0
      ? false
      : {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: {
              enum: node.relationships.map(relationship => relationship.role),
            },
            targetId: {
              type: 'string',
              minLength: 1,
              pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
            },
            targetType: { type: 'string', minLength: 1 },
          },
          required: ['type', 'targetId', 'targetType'],
          allOf: node.relationships.map(relationship => ({
            if: {
              properties: { type: { const: relationship.role } },
              required: ['type'],
            },
            then: {
              properties: { targetType: { enum: relationship.targetKinds } },
            },
          })),
        }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
      },
      kind: { const: node.kind },
      value: {
        type: 'object',
        additionalProperties: false,
        properties: valueProperties,
        required: node.value.required,
      },
      references: {
        type: 'array',
        items: referenceItems,
        ...(referencePolicy?.kind === 'exact-single-index-reference'
          ? { minItems: 1, maxItems: 1 }
          : {}),
      },
      edges: {
        type: 'array',
        items: relationshipSchema,
      },
    },
    required: ['id', 'kind', 'value', 'references', 'edges'],
  }
}

function discriminatedNodeSchema(
  nodes: GameIrProjectionContract['nodes'],
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
      },
      kind: { enum: nodes.map(node => node.kind) },
      value: { type: 'object' },
      references: { type: 'array' },
      edges: { type: 'array' },
    },
    required: ['id', 'kind', 'value', 'references', 'edges'],
    allOf: nodes.map(node => ({
      if: {
        properties: { kind: { const: node.kind } },
        required: ['kind'],
      },
      then: nodeSchema(node),
    })),
  }
}

function schemaDefinitions(
  contract: GameIrProjectionContract,
): Readonly<Record<string, unknown>> {
  const definitions: Record<string, unknown> = {}
  for (const node of contract.nodes) {
    for (const field of Object.values(node.value.fields)) {
      const defs = field.$defs
      if (defs && typeof defs === 'object' && !Array.isArray(defs))
        Object.assign(definitions, defs)
    }
  }
  return definitions
}

type ProjectionNodeContract = GameIrProjectionContract['nodes'][number]

const sourceEvidenceGroupJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nodeIds: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        minLength: 1,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
      },
    },
    fragmentId: { type: 'string', pattern: '^e[0-9]+\\.[0-9]+$' },
  },
  required: ['nodeIds', 'fragmentId'],
} as const

function projectionSemanticJsonSchema(
  nodes: readonly ProjectionNodeContract[],
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      nodes: { type: 'array', items: discriminatedNodeSchema(nodes) },
      sourceEvidenceGroups: {
        type: 'array',
        items: sourceEvidenceGroupJsonSchema,
      },
    },
    required: ['nodes', 'sourceEvidenceGroups'],
  }
}

/** Shared semantic schema projection used by strict slice outputs. */
export function buildGameIrProjectionSemanticJsonSchema(
  moduleId: GameIrProjectionModuleId,
  nodeKinds: readonly string[],
): Record<string, unknown> {
  const contract = buildGameIrProjectionContract(moduleId)
  const nodesByKind = new Map(contract.nodes.map(node => [node.kind, node]))
  if (
    nodeKinds.length === 0 ||
    new Set(nodeKinds).size !== nodeKinds.length ||
    nodeKinds.some(kind => !nodesByKind.has(kind))
  )
    throw new Error(
      `projection semantic schema has unknown node kind for ${moduleId}`,
    )
  const nodes = nodeKinds.map(kind => nodesByKind.get(kind)!)
  return {
    $defs: schemaDefinitions(contract),
    ...projectionSemanticJsonSchema(nodes),
  }
}
