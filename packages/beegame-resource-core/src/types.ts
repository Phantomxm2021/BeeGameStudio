export const RESOURCE_DIMENSIONS = ['2D', '3D', 'agnostic'] as const
export type ResourceDimension = (typeof RESOURCE_DIMENSIONS)[number]

export const RESOURCE_CATEGORIES = [
  'characters',
  'environment',
  'tiles',
  'models',
  'materials',
  'animation',
  'ui',
  'vfx',
  'fonts',
  'audio',
  'textures',
] as const
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number]

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

export type PackSummary = ResourcePack & {
  elementCount: number
}
