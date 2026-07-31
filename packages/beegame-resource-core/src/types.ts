export const RESOURCE_DIMENSIONS = ['2D', '3D', 'agnostic'] as const
export type ResourceDimension = (typeof RESOURCE_DIMENSIONS)[number]

export const RESOURCE_LIBRARY_USAGE = ['optional', 'preferred', 'required'] as const
export type ResourceLibraryUsage = (typeof RESOURCE_LIBRARY_USAGE)[number]

export const RESOURCE_CATEGORIES = [
  // Canonical categories describe the resource type, not its subject matter.
  'sprites',
  'tilemaps',
  'models',
  'materials',
  'animation',
  'ui',
  'vfx',
  'fonts',
  'audio',
  'textures',
  'scenes',
  // Legacy imports remain readable while new Packs use the canonical set.
  'characters',
  'environment',
  'tiles',
] as const
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number]

/**
 * Stable semantic capabilities shared by Pack elements and project asset
 * contracts. These describe what an asset can be used for, independently of
 * its file format or storage category.
 */
export const RESOURCE_USAGE_TAGS = [
  'character', 'npc', 'creature',
  'weapon-equipment', 'prop', 'vehicle',
  'building', 'environment', 'terrain', 'vegetation',
  'scene', 'level-map', 'tile',
  'ui', 'icon', 'effect',
  'combat', 'interaction', 'narrative',
  'music', 'sound-effect', 'ambient-audio', 'voice',
] as const
export type ResourceUsageTag = (typeof RESOURCE_USAGE_TAGS)[number]

/**
 * Technical asset identity. Categories remain useful for browsing, while an
 * asset kind tells project tooling what the element actually represents.
 * The vocabulary is intentionally engine-neutral.
 */
export const RESOURCE_ASSET_KINDS = [
  'image', 'texture', 'sprite', 'sprite-sheet', 'sprite-atlas',
  'frame-animation', 'tileset', 'tilemap',
  'mesh', 'model', 'scene', 'material', 'rig', 'animation-clip', 'animation-library',
  'ui-document', 'ui-screen',
  'font', 'audio-clip', 'audio-cue', 'audio-bank', 'music', 'ambience', 'voice',
  'vfx', 'shader', 'physical-material', 'collider', 'input-profile', 'data',
] as const
export type ResourceAssetKind = (typeof RESOURCE_ASSET_KINDS)[number]

/** Structured, portable capabilities used as hard selection constraints. */
export const RESOURCE_CAPABILITIES = [
  'alpha', 'tileable', 'nine-slice', 'sprite-slicing', 'frame-sequence',
  'atlas-regions', 'tile-collision',
  'skinned', 'rigged', 'contains-animations', 'contains-materials',
  'contains-textures', 'morph-targets',
  'lod', 'collision', 'navigation', 'modular', 'connection-points',
  'scene-layout', 'spawn-markers', 'objective-markers',
  'ui-states', 'focus-navigation', 'safe-area',
  'particle', 'flipbook', 'trail',
  'spatial-audio', 'loop-points', 'audio-variants',
  'physical-properties', 'ragdoll',
  'input-actions', 'touch-controls', 'gamepad-controls',
] as const
export type ResourceCapability = (typeof RESOURCE_CAPABILITIES)[number]

/**
 * Objective subresources discovered inside a logical asset root. These are
 * addressable by project code but are not independently copied or selected.
 */
export const RESOURCE_EMBEDDED_COMPONENT_KINDS = [
  'sprite-frame', 'atlas-region', 'tile', 'tile-layer',
  'mesh', 'skinned-mesh', 'skeleton', 'animation-clip', 'material', 'texture',
  'morph-target', 'collider', 'lod', 'scene-node',
] as const
export type ResourceEmbeddedComponentKind = (typeof RESOURCE_EMBEDDED_COMPONENT_KINDS)[number]

export type ResourceEmbeddedComponent = {
  /** Stable within the inspected root asset, not a repository element ID. */
  id: string
  kind: ResourceEmbeddedComponentKind
  name?: string
  /** Optional administrator-authored game roles; never inferred from names. */
  roles?: readonly string[]
  specs?: Record<string, string | number | boolean>
  /** Skeleton compatibility is meaningful for skeletons and animation clips. */
  skeletonSignature?: string
}

export type ResourceContentProfile = {
  packaging: 'self-contained' | 'external-dependencies' | 'unknown'
  components: readonly ResourceEmbeddedComponent[]
  inspection: {
    status: 'complete' | 'partial' | 'unavailable'
    source: 'server' | 'client' | 'admin'
    inspectedAt?: string
    inspectorVersion?: string
  }
}

export type ResourceSubresourceRequirement = {
  kind: ResourceEmbeddedComponentKind
  role?: string
  skeletonSignature?: string
}

export const RESOURCE_RELATION_KINDS = [
  'uses-texture', 'uses-material', 'uses-rig', 'animation-for',
  'collision-for', 'lod-of', 'variant-of', 'component-of',
  'audio-for', 'vfx-for',
] as const
export type ResourceRelationKind = (typeof RESOURCE_RELATION_KINDS)[number]

export type ResourceElementRelation = {
  kind: ResourceRelationKind
  targetElementId: string
  /** Role within the relation, such as idle, base-color, or damaged. */
  role?: string
  required?: boolean
}

export type ResourceRelationRequirement = {
  kind: ResourceRelationKind
  targetElementId?: string
  role?: string
}

/**
 * A composition describes how independently imported logical asset roots
 * form one game-facing unit. It is intentionally engine-neutral: an adapter or
 * the generated project decides whether that unit becomes a prefab, scene,
 * blueprint, node tree, or ordinary runtime data.
 */
export const RESOURCE_COMPOSITION_KINDS = [
  'character',
  'scene',
  'scene-kit',
  'ui-screen',
  'ui-kit',
  'vfx',
  'audio-cue',
  'sprite-animation',
  'tileset',
  'tilemap',
  'physics-profile',
  'input-profile',
  'generic',
] as const
export type ResourceCompositionKind = (typeof RESOURCE_COMPOSITION_KINDS)[number]

/** Single machine-readable vocabulary used by manifest authors and auditors. */
export const RESOURCE_ASSET_MANIFEST_VOCABULARY = {
  version: 5,
  rootFields: ['version', 'project_target', 'requirements', 'imports', 'compositions'],
  projectTargetFields: [
    'platform',
    'runtime',
    'integration_mode',
    'mcp_server',
    'asset_format_capabilities',
    'resource_library_usage',
  ],
  projectTargetFieldShapes: {
    asset_format_capabilities: 'string[]',
    resource_library_usage: 'optional | preferred | required',
  },
  requirementFields: [
    'id',
    'required',
    'resource_requirement',
    'satisfied_by',
    'status',
  ],
  importFields: ['id', 'source', 'status', 'root_path', 'local_files', 'selected_at', 'selection_reason', 'asset_kind', 'capabilities', 'content_profile', 'technical_facts', 'dependencies', 'usage_evidence'],
  importSourceFields: ['type', 'pack_id', 'pack_version', 'element_id', 'element_path'],
  resourceRequirementFields: [
    'category',
    'dimension',
    'accepted_formats',
    'tags',
    'asset_kinds',
    'capabilities',
    'subresources',
    'relations',
  ],
  integrationEvidenceFields: ['references', 'runtime_event_ids'],
  subresourceRequirementFields: ['kind', 'role', 'skeleton_signature'],
  compositionFields: ['id', 'kind', 'required', 'assembly_mode', 'members', 'recipe', 'status', 'integration_evidence'],
  compositionMemberFields: ['import_id', 'requirement_id', 'composition_id', 'role', 'required'],
  compositionRecipeFields: ['path', 'notes'],
  resourceLibraryUsage: RESOURCE_LIBRARY_USAGE,
  dimensions: RESOURCE_DIMENSIONS,
  categories: RESOURCE_CATEGORIES,
  usageTags: RESOURCE_USAGE_TAGS,
  assetKinds: RESOURCE_ASSET_KINDS,
  capabilities: RESOURCE_CAPABILITIES,
  embeddedComponentKinds: RESOURCE_EMBEDDED_COMPONENT_KINDS,
  relationKinds: RESOURCE_RELATION_KINDS,
  compositionKinds: RESOURCE_COMPOSITION_KINDS,
} as const

export const RESOURCE_PACK_PRIMARY_CATEGORIES = [
  '2d-art',
  '3d-assets',
  'animation-rig',
  'ui-kit',
  'vfx',
  'audio',
  'fonts',
  'world-scene',
  'mixed',
] as const
export type ResourcePackPrimaryCategory = (typeof RESOURCE_PACK_PRIMARY_CATEGORIES)[number]

export type ResourcePackStatus = 'draft' | 'published' | 'archived'
export type ResourceElementStatus = 'queued' | 'uploading' | 'ready' | 'failed' | 'hidden' | 'archived'

/**
 * Explicit authoring policy inherited by logical assets. Only semantic fields
 * belong here: technical identity and inspected capabilities must continue to
 * come from the file itself or an explicit element override.
 */
export type ResourceElementDefaults = {
  usageTags?: readonly ResourceUsageTag[]
}

export type ResourceUsageTagsMode = 'inherit' | 'override' | 'manual-only'
export type ResourceUsageTagsSource = 'element' | 'folder' | 'pack' | 'none'

export type ResourceFolder = {
  id: string
  packId: string
  name: string
  parentId?: string
  path: string
  elementDefaults?: ResourceElementDefaults
}

export type ResourcePack = {
  id: string
  name: string
  style: string
  /** Canonical style taxonomy. style is the legacy display projection. */
  styles?: readonly string[]
  gameTypes: readonly string[]
  dimension: ResourceDimension
  primaryCategory: ResourcePackPrimaryCategory
  // Derived from contained elements, so a newly created Pack has no values yet.
  categories: readonly ResourceCategory[]
  license: string
  version: string
  status: ResourcePackStatus
  coverPath?: string
  description?: string
  tags?: readonly string[]
  source?: string
  author?: string
  licenseEvidence?: string
  compatibleEngines?: readonly string[]
  deprecatedAt?: string
  elementDefaults?: ResourceElementDefaults
}

export type ResourcePreview = {
  kind: 'image' | 'model' | 'audio' | 'document'
  path: string
}

/**
 * Maps an external relative URI recorded inside an asset to another Pack
 * element. The reference is kept verbatim because loaders resolve it relative
 * to the parent file at runtime.
 */
export type ResourceDependencyBinding = {
  referencePath: string
  dependencyElementId: string
  kind?: string
}

export type ResourceElement = {
  id: string
  packId: string
  name: string
  path: string
  category: ResourceCategory
  kind: string
  preview?: ResourcePreview
  specs: Record<string, string | number | boolean>
  /** Explicit semantic capabilities. Empty means the element is manual-only. */
  usageTags?: readonly ResourceUsageTag[]
  /** Controls whether usageTags override or inherit authored Pack/folder policy. */
  usageTagsMode?: ResourceUsageTagsMode
  /** Read-only provenance of the effective usageTags returned by a repository. */
  usageTagsSource?: ResourceUsageTagsSource
  assetKind?: ResourceAssetKind
  capabilities?: readonly ResourceCapability[]
  /** Inspected contents of this logical asset root (for example one GLB). */
  contentProfile?: ResourceContentProfile
  /** Semantic relations are separate from file-path dependency bindings. */
  relations?: readonly ResourceElementRelation[]
  dependencies: readonly string[]
  dependencyBindings?: readonly ResourceDependencyBinding[]
  status: ResourceElementStatus
  styleOverride?: string
  dimensionOverride?: ResourceDimension
}

/**
 * Deterministic, engine-neutral file facts produced by resource inspection.
 * They describe the source asset as authored; they are not gameplay roles or
 * target-engine import settings. Unknown facts stay absent instead of being
 * guessed from filenames or Pack categories.
 */
export type ResourceTechnicalFacts = Record<string, string | number | boolean>

export type ResourceSelectionDependency = {
  key: string
  parentKey: string
  elementId: string
  elementPath: string
  referencePath: string
  kind?: string
}

/**
 * One exact element resolved after Claude Code has already made the artistic
 * choice. It carries no role, score, or generated rationale: the service only
 * validates identity, publication state, version, and the dependency closure.
 */
export type ResourceResolvedElement = {
  packId: string
  packVersion: string
  packName?: string
  packStyle?: string
  packGameTypes?: readonly string[]
  elementId: string
  elementName?: string
  elementPath: string
  category?: ResourceCategory
  usageTags?: readonly ResourceUsageTag[]
  dimension?: ResourceDimension
  assetKind?: ResourceAssetKind
  capabilities?: readonly ResourceCapability[]
  contentProfile?: ResourceContentProfile
  technicalFacts?: ResourceTechnicalFacts
  relations?: readonly ResourceElementRelation[]
  dependencies?: readonly ResourceSelectionDependency[]
}

/**
 * Exact, structured filters for browsing a large Resource Library. These are
 * deliberately not tied to project requirements or authored roles: an Agent
 * may browse broadly, refine the catalog, and choose any reusable collection
 * of elements for its own target-native composition.
 */
export type ResourceCatalogFilter = {
  packIds?: readonly string[]
  dimensions?: readonly ResourceDimension[]
  primaryCategories?: readonly ResourcePackPrimaryCategory[]
  categories?: readonly ResourceCategory[]
  styles?: readonly string[]
  gameTypes?: readonly string[]
  packTags?: readonly string[]
  usageTags?: readonly ResourceUsageTag[]
  assetKinds?: readonly ResourceAssetKind[]
  capabilities?: readonly ResourceCapability[]
  formats?: readonly string[]
}

export type ResourceCatalogRequest = {
  filters?: ResourceCatalogFilter
  /** Opaque catalog cursor returned by the previous page. */
  cursor?: string
  limit?: number
}

export type ResourceCatalogFacets = {
  dimensions: readonly ResourceDimension[]
  primaryCategories: readonly ResourcePackPrimaryCategory[]
  categories: readonly ResourceCategory[]
  styles: readonly string[]
  gameTypes: readonly string[]
  packTags: readonly string[]
  usageTags: readonly ResourceUsageTag[]
  assetKinds: readonly ResourceAssetKind[]
  capabilities: readonly ResourceCapability[]
  formats: readonly string[]
}

export type ResourceCatalogPack = {
  packId: string
  packVersion: string
  packName: string
  style: string
  styles: readonly string[]
  gameTypes: readonly string[]
  dimension: ResourceDimension
  primaryCategory: ResourcePackPrimaryCategory
  categories: readonly ResourceCategory[]
  tags: readonly string[]
  readyElementCount: number
  assetKinds: readonly ResourceAssetKind[]
  usageTags: readonly ResourceUsageTag[]
  capabilities: readonly ResourceCapability[]
  formats: readonly string[]
  description?: string
  license: string
  author?: string
  source?: string
  compatibleEngines: readonly string[]
}

export type ResourceCatalogElement = {
  packId: string
  packVersion: string
  packName: string
  packStyle: string
  packStyles: readonly string[]
  packGameTypes: readonly string[]
  elementId: string
  elementName: string
  elementPath: string
  /** Unsigned authored preview descriptor; catalog browsing never exposes source URLs. */
  preview?: ResourcePreview
  category: ResourceCategory
  dimension: ResourceDimension
  usageTags: readonly ResourceUsageTag[]
  assetKind?: ResourceAssetKind
  capabilities: readonly ResourceCapability[]
  contentProfile?: ResourceContentProfile
  technicalFacts?: ResourceTechnicalFacts
  relations: readonly ResourceElementRelation[]
  dependencyCount: number
}

export type ResourceCatalogPage<T> = {
  items: readonly T[]
  total: number
  nextCursor?: string
  facets: ResourceCatalogFacets
}

export type PackSummary = ResourcePack & {
  elementCount: number
}
