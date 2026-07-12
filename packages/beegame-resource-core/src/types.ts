export const RESOURCE_DIMENSIONS = ['2D', '3D', 'agnostic'] as const
export type ResourceDimension = (typeof RESOURCE_DIMENSIONS)[number]

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

export type ResourceFolder = {
  id: string
  packId: string
  name: string
  parentId?: string
  path: string
}

export type ResourcePack = {
  id: string
  name: string
  style: string
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
  dependencies: readonly string[]
  dependencyBindings?: readonly ResourceDependencyBinding[]
  status: ResourceElementStatus
  styleOverride?: string
  dimensionOverride?: ResourceDimension
}

export type ResourceSlotRequirement = {
  slotId: string
  category?: ResourceCategory
  dimension?: ResourceDimension
  acceptedFormats?: readonly string[]
  styles?: readonly string[]
  gameTypes?: readonly string[]
  tags?: readonly string[]
  purpose?: string
}

export type ResourceSelection = {
  slotId: string
  packId: string
  packVersion: string
  elementId: string
  elementPath: string
  score: number
  reasons: readonly string[]
  dependencies?: readonly ResourceSelectionDependency[]
}

export type ResourceSelectionDependency = {
  key: string
  parentKey: string
  elementId: string
  elementPath: string
  referencePath: string
  kind?: string
}

export type ResourceSelectionManifest = {
  selections: readonly ResourceSelection[]
  unmatchedSlotIds: readonly string[]
}

export type PackSummary = ResourcePack & {
  elementCount: number
}
