import {
  BEEGAME_RESOURCE_ROOTS,
  BEEGAME_RESOURCE_STATUSES,
  CURRENT_ASSET_MANIFEST_VERSION,
} from '../asset-contracts'
import {
  BEEGAME_CONTENT_SCHEMA,
  BEEGAME_JSON_CONTENT_KINDS,
  BEEGAME_YAML_CONTENT_KINDS,
} from '../content-contracts'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_RELATION_KINDS,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import { CANONICAL_ASSET_MANIFEST } from './types'
import { z } from 'zod'
import { beeGameProgrammaticAudioResourceSchema } from '../programmatic-audio-resource'
import { CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS } from '../configured-provisional-resource-adapters'

/**
 * The model-facing projection of the existing resource/content contracts.
 *
 * This is deliberately descriptive rather than executable: the field mapping
 * is kept here for model-facing guidance, while parsing and validation remain
 * owned by asset-contracts.ts and content-contracts.ts.
 * Keeping this projection private to foundation authoring gives Technical and
 * Asset authors enough information to describe the real delivery boundary
 * without making every document author carry a complete system schema.
 */
export type FoundationAuthoringDeliveryContract = Readonly<{
  formatRule: string
  programmaticAudio: Readonly<{
    schema: Record<string, unknown>
    manifestRule: string
    cueRule: string
    relationalRules: readonly string[]
    authoredRegistration: string
  }>
  placeholderAdapters: readonly Readonly<{ format: string; assetKinds: readonly string[] }>[]
  placeholderRule: string
  canonicalAssetManifest: Readonly<{
    path: typeof CANONICAL_ASSET_MANIFEST
    version: typeof CURRENT_ASSET_MANIFEST_VERSION
    indexFields: readonly ['version', 'project_target', 'modules']
    projectTargetFields: readonly [
      'platform',
      'runtime',
      'asset_format_capabilities',
      'resource_library_usage',
      'runtime_asset_root',
      'content_root',
      'generated_asset_root',
    ]
    moduleLayout: Readonly<{
      requirements: Readonly<{
        root: 'assets/manifest/requirements'
        extension: '.json'
        cardinality: 'exactly_one'
        moduleFields: readonly ['requirements']
      }>
      resources: Readonly<{
        root: 'assets/manifest/resources'
        extension: '.json'
        cardinality: 'one_per_resource'
        moduleFields: readonly string[]
      }>
      indexModulesFields: readonly ['requirements', 'resources']
    }>
    moduleRelationship: string
  }>
  roots: Readonly<{
    runtimeAssets: typeof BEEGAME_RESOURCE_ROOTS.runtime
    content: typeof BEEGAME_RESOURCE_ROOTS.content
    generatedAdapters: typeof BEEGAME_RESOURCE_ROOTS.generated
  }>
  requirements: Readonly<{
    fields: readonly ['id', 'name', 'purpose', 'required', 'acquisition_profile']
    requiredFields: readonly ['id', 'acquisition_profile']
    optionalFields: readonly ['name', 'purpose', 'required']
    acquisitionProfileFields: readonly [
      'dimensions',
      'asset_kinds',
      'usage_tags',
      'capabilities',
      'styles',
      'coverage',
    ]
    canonicalValues: Readonly<{
      dimensions: readonly string[]
      assetKinds: readonly string[]
      usageTags: readonly string[]
      capabilities: readonly string[]
      relationKinds: readonly string[]
      embeddedKinds: readonly string[]
    }>
  }>
  resources: Readonly<{
    fields: readonly [
      'id',
      'source',
      'root_path',
      'file_paths',
      'local_file_hashes',
      'provisional',
      'status',
      'selected_at',
      'selection_reason',
      'asset_kind',
      'capabilities',
      'content_profile',
      'technical_facts',
      'dependencies',
      'error',
    ]
    requiredFields: readonly [
      'id',
      'source',
      'root_path',
      'file_paths',
      'provisional',
      'status',
      'selected_at',
      'selection_reason',
    ]
    optionalFields: readonly [
      'local_file_hashes',
      'asset_kind',
      'capabilities',
      'content_profile',
      'technical_facts',
      'dependencies',
      'error',
    ]
    sourceShapes: Readonly<{
      'resource-library': Readonly<{
        fields: readonly [
          'type',
          'pack_id',
          'pack_version',
          'element_id',
          'element_path',
        ]
        requiredFields: readonly [
          'type',
          'pack_id',
          'pack_version',
          'element_id',
          'element_path',
        ]
      }>
      'agent-authored': Readonly<{
        fields: readonly ['type', 'created_at', 'reason']
        requiredFields: readonly ['type', 'created_at', 'reason']
      }>
      'user-provided': Readonly<{
        fields: readonly ['type', 'created_at', 'filename']
        requiredFields: readonly ['type', 'created_at', 'filename']
      }>
    }>
    sourceKinds: readonly ['resource-library', 'agent-authored', 'user-provided']
    statuses: readonly string[]
    pathRule: string
  }>
  content: Readonly<{
    schema: typeof BEEGAME_CONTENT_SCHEMA
    root: typeof BEEGAME_RESOURCE_ROOTS.content
    documentFields: readonly ['schema', 'id', 'kind', 'fulfills', 'resources', 'data']
    jsonKinds: readonly string[]
    yamlKinds: readonly string[]
    registryKind: 'resource-registry'
    unsupportedProposedKinds: readonly ['visual-constants']
    pathAndVersionRule: string
  }>
  resourceRegistry: Readonly<{
    location: string
    dataField: 'data'
    bindingsField: 'bindings'
    bindingFields: readonly ['requirementId', 'resourceIds']
    semantics: readonly string[]
  }>
}>

/**
 * Build a compact, read-only authoring view from the public canonical values.
 * Callers receive a fresh object so prompt shaping cannot mutate shared
 * contract state. The mapping is intentionally checked by parser-backed
 * tests rather than treated as a second validator.
 */
export function buildFoundationAuthoringDeliveryContract(): FoundationAuthoringDeliveryContract {
  return {
    formatRule: 'project_target.asset_format_capabilities contains lowercase ASCII alphanumeric file extensions without dots (e.g. json, wav), not semantic capability labels. Put supported semantic capabilities in acquisition_profile.capabilities or resource capabilities.',
    programmaticAudio: {
      // Export the real closed field/enum/range schema, not a parallel validator.
      // JSON Schema cannot represent the existing superRefine relationships;
      // those remain descriptive below and are tested via the real parser.
      schema: z.toJSONSchema(beeGameProgrammaticAudioResourceSchema),
      manifestRule: 'Programmatic audio requires provisional=true, asset_kind audio-cue or audio-bank, and a single JSON root under assets/runtime: file_paths=[root_path]. It is not an arbitrary patch/node graph or a playable audio container.',
      cueRule: 'audio-cue must define exactly one cue; audio-bank may define 1–32 cues. Do not label a multi-cue bank as audio-cue.',
      relationalRules: [
        'Cue IDs must be unique within the resource.',
        'loop.end_ms must exceed loop.start_ms and not exceed cue.duration_ms.',
        'Each voice start_ms + duration_ms must not exceed cue.duration_ms.',
        'Each voice attack_ms + release_ms (omitted values mean zero) must not exceed voice.duration_ms.',
      ],
      authoredRegistration: 'The internal registerBeeGameAuthoredResources function accepts and validates authored schema-conforming JSON files. This is not itself a worker tool or proof that the active toolchain exposes an authored-file handoff. Confirm that handoff before promising automated delivery; if unavailable, record the integration dependency. Merely planning JSON or listing a manifest resource does not create or validate its contents. Leave canonical module filenames and index updates to the existing writer.',
    },
    placeholderAdapters: CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS.map(adapter => ({
      format: adapter.format, assetKinds: [...adapter.assetKinds],
    })),
    placeholderRule: 'Schema acceptance does not imply configured placeholder-generation support. CommitResourceInventory provisional generation requires both format and asset kind in the configured adapter table. Zero-audio-container designs require a confirmed authored programmatic JSON handoff; otherwise record the integration dependency. Do not request JSON audio from an unsupported placeholder adapter or silently substitute WAV.',
    canonicalAssetManifest: {
      path: CANONICAL_ASSET_MANIFEST,
      version: CURRENT_ASSET_MANIFEST_VERSION,
      indexFields: ['version', 'project_target', 'modules'],
      projectTargetFields: [
        'platform',
        'runtime',
        'asset_format_capabilities',
        'resource_library_usage',
        'runtime_asset_root',
        'content_root',
        'generated_asset_root',
      ],
      moduleLayout: {
        requirements: {
          root: 'assets/manifest/requirements',
          extension: '.json',
          cardinality: 'exactly_one',
          moduleFields: ['requirements'],
        },
        resources: {
          root: 'assets/manifest/resources',
          extension: '.json',
          cardinality: 'one_per_resource',
          // Resource modules are the resource object itself; unlike the
          // requirements module they do not have a wrapper field.
          moduleFields: [
            'id',
            'source',
            'root_path',
            'file_paths',
            'local_file_hashes',
            'provisional',
            'status',
            'selected_at',
            'selection_reason',
            'asset_kind',
            'capabilities',
            'content_profile',
            'technical_facts',
            'dependencies',
            'error',
          ],
        },
        indexModulesFields: ['requirements', 'resources'],
      },
      moduleRelationship:
        'assets/asset-manifest.json is an index. It points to one requirements module and one resource module per resource; the parser joins those modules into the canonical requirements/resources arrays.',
    },
    roots: {
      runtimeAssets: BEEGAME_RESOURCE_ROOTS.runtime,
      content: BEEGAME_RESOURCE_ROOTS.content,
      generatedAdapters: BEEGAME_RESOURCE_ROOTS.generated,
    },
    requirements: {
      fields: ['id', 'name', 'purpose', 'required', 'acquisition_profile'],
      requiredFields: ['id', 'acquisition_profile'],
      optionalFields: ['name', 'purpose', 'required'],
      acquisitionProfileFields: [
        'dimensions',
        'asset_kinds',
        'usage_tags',
        'capabilities',
        'styles',
        'coverage',
      ],
      canonicalValues: {
        dimensions: [...RESOURCE_DIMENSIONS],
        assetKinds: [...RESOURCE_ASSET_KINDS],
        usageTags: [...RESOURCE_USAGE_TAGS],
        capabilities: [...RESOURCE_CAPABILITIES],
        relationKinds: [...RESOURCE_RELATION_KINDS],
        embeddedKinds: [...RESOURCE_EMBEDDED_COMPONENT_KINDS],
      },
    },
    resources: {
      fields: [
        'id',
        'source',
        'root_path',
        'file_paths',
        'local_file_hashes',
        'provisional',
        'status',
        'selected_at',
        'selection_reason',
        'asset_kind',
        'capabilities',
        'content_profile',
        'technical_facts',
        'dependencies',
        'error',
      ],
      requiredFields: [
        'id',
        'source',
        'root_path',
        'file_paths',
        'provisional',
        'status',
        'selected_at',
        'selection_reason',
      ],
      optionalFields: [
        'local_file_hashes',
        'asset_kind',
        'capabilities',
        'content_profile',
        'technical_facts',
        'dependencies',
        'error',
      ],
      sourceShapes: {
        'resource-library': {
          fields: [
            'type',
            'pack_id',
            'pack_version',
            'element_id',
            'element_path',
          ],
          requiredFields: [
            'type',
            'pack_id',
            'pack_version',
            'element_id',
            'element_path',
          ],
        },
        'agent-authored': {
          fields: ['type', 'created_at', 'reason'],
          requiredFields: ['type', 'created_at', 'reason'],
        },
        'user-provided': {
          fields: ['type', 'created_at', 'filename'],
          requiredFields: ['type', 'created_at', 'filename'],
        },
      },
      sourceKinds: ['resource-library', 'agent-authored', 'user-provided'],
      statuses: [...BEEGAME_RESOURCE_STATUSES],
      pathRule:
        'All manifest paths are workspace-relative. Agent-authored and user-provided files stay under assets/runtime; resource-library files may be under assets/runtime or assets/generated. root_path must be included in file_paths, and every path must remain under its declared resource root.',
    },
    content: {
      schema: BEEGAME_CONTENT_SCHEMA,
      root: BEEGAME_RESOURCE_ROOTS.content,
      documentFields: ['schema', 'id', 'kind', 'fulfills', 'resources', 'data'],
      jsonKinds: [...BEEGAME_JSON_CONTENT_KINDS],
      yamlKinds: [...BEEGAME_YAML_CONTENT_KINDS],
      registryKind: 'resource-registry',
      unsupportedProposedKinds: ['visual-constants'],
      pathAndVersionRule:
        'Content files live under assets/content. The asset manifest is version 8; content uses schema beegame-content-v1. JSON and YAML kinds are separate closed vocabularies, so an unlisted kind must be represented by an existing kind or recorded as a gap rather than invented.',
    },
    resourceRegistry: {
      location: 'assets/content/<registry-file>.json',
      dataField: 'data',
      bindingsField: 'bindings',
      bindingFields: ['requirementId', 'resourceIds'],
      semantics: [
        'There is exactly one resource-registry when requirements or resources exist.',
        'Each binding has one requirementId and a non-empty resourceIds array.',
        'binding requirementId values must exactly equal the registry top-level fulfills set.',
        'binding resourceIds values must exactly equal the registry top-level resources set.',
        'Every fulfilled requirement must be a manifest requirement and every bound resource must be a verified manifest resource.',
      ],
    },
  }
}

/** Stable value for callers that only need to embed the projection. */
export const FOUNDATION_AUTHORING_DELIVERY_CONTRACT =
  buildFoundationAuthoringDeliveryContract()

export const foundationAuthoringDeliveryContract =
  FOUNDATION_AUTHORING_DELIVERY_CONTRACT
