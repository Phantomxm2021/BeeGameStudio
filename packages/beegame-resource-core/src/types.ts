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
}

export type ResourcePreview = {
  kind: 'image' | 'model' | 'audio' | 'document'
  path: string
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
  dependencies: readonly string[]
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
}

export type ResourceSelectionManifest = {
  selections: readonly ResourceSelection[]
  unmatchedSlotIds: readonly string[]
}

export type PackSummary = ResourcePack & {
  elementCount: number
}
