import type { PackSummary, ResourceCatalogPack, ResourceCategory, ResourceElement, ResourceFolder, ResourcePack } from './types'
import { validateResourceElement, validateResourcePack } from './validation'
import { assertResourcePackPublishable } from './publish-readiness'
import { resolveEffectiveResourceMetadata } from './metadata-policy'

export type { ResourceElement, ResourceFolder, ResourcePack } from './types'

export type ResourceRepository = {
  listPacks(): Promise<PackSummary[]>
  /** Pre-aggregated published Pack catalog; avoids loading every element. */
  listCatalogPacks?(): Promise<ResourceCatalogPack[]>
  getPack(packId: string): Promise<PackSummary | undefined>
  listElements(packId: string, category?: ResourceCategory): Promise<ResourceElement[]>
  getElement(packId: string, elementId: string): Promise<ResourceElement | undefined>
  createPack(pack: ResourcePack, options?: { createdBy?: string }): Promise<ResourcePack>
  listFolders(packId: string): Promise<ResourceFolder[]>
  createFolder(packId: string, input: { id: string; name: string; parentId?: string; elementDefaults?: ResourceFolder['elementDefaults'] }): Promise<ResourceFolder>
  updateFolder(packId: string, folderId: string, input: { name?: string; elementDefaults?: ResourceFolder['elementDefaults'] }): Promise<ResourceFolder | undefined>
  deleteFolder(packId: string, folderId: string): Promise<boolean>
  updateElement(packId: string, elementId: string, input: Partial<ResourceElement>): Promise<ResourceElement | undefined>
  deleteElement(packId: string, elementId: string): Promise<boolean>
  publishPack(packId: string): Promise<ResourcePack>
  archivePack(packId: string): Promise<ResourcePack>
  deletePack(packId: string): Promise<boolean>
}

export function createInMemoryResourceRepository(input: {
  packs: ResourcePack[]
  elements: ResourceElement[]
}): ResourceRepository {
  const packs = input.packs.map(validateResourcePack)
  const elements = input.elements.map(validateResourceElement)
  const folders: ResourceFolder[] = []
  const summary = (pack: ResourcePack): PackSummary => ({
    ...pack,
    elementCount: elements.filter(element => element.packId === pack.id).length,
  })
  const resolvedElement = (element: ResourceElement): ResourceElement => {
    const pack = packs.find(item => item.id === element.packId)
    return pack ? resolveEffectiveResourceMetadata(pack, folders.filter(folder => folder.packId === element.packId), element) : element
  }
  return {
    async listPacks() {
      return packs.map(summary).sort((a, b) => a.name.localeCompare(b.name))
    },
    async getPack(packId) {
      const pack = packs.find(item => item.id === packId)
      return pack ? summary(pack) : undefined
    },
    async listElements(packId, category) {
      return elements
        .filter(element => element.packId === packId && (!category || element.category === category))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(resolvedElement)
    },
    async getElement(packId, elementId) {
      const element = elements.find(element => element.packId === packId && element.id === elementId)
      return element ? resolvedElement(element) : undefined
    },
    async createPack(pack) {
      const validated = validateResourcePack(pack)
      packs.push(validated)
      return validated
    },
    async listFolders(packId) {
      return folders.filter(folder => folder.packId === packId).sort((a, b) => a.path.localeCompare(b.path))
    },
    async createFolder(packId, input) {
      const parent = input.parentId ? folders.find(folder => folder.id === input.parentId && folder.packId === packId) : undefined
      if (input.parentId && !parent) throw new Error('Parent folder not found')
      const path = parent ? `${parent.path}/${input.name}` : input.name
      if (folders.some(folder => folder.packId === packId && folder.path === path)) throw new Error('Folder path already exists')
      const folder = { id: input.id, packId, name: input.name, ...(input.parentId ? { parentId: input.parentId } : {}), path, ...(input.elementDefaults ? { elementDefaults: input.elementDefaults } : {}) }
      folders.push(folder)
      return folder
    },
    async updateFolder(packId, folderId, input) {
      const folder = folders.find(item => item.id === folderId && item.packId === packId)
      if (!folder) return undefined
      const name = input.name?.trim() ?? folder.name
      if (!name || name.includes('/') || name.includes('\\')) throw new Error('Folder name is invalid')
      const oldPath = folder.path
      const parent = folder.parentId ? folders.find(item => item.id === folder.parentId && item.packId === packId) : undefined
      const path = parent ? `${parent.path}/${name}` : name
      if (folders.some(item => item.packId === packId && item.id !== folderId && item.path === path)) throw new Error('Folder path already exists')
      const replacePath = (value: string) => value === oldPath ? path : value.startsWith(`${oldPath}/`) ? `${path}${value.slice(oldPath.length)}` : value
      for (const item of folders) if (item.packId === packId) item.path = replacePath(item.path)
      for (const item of elements) if (item.packId === packId) item.path = replacePath(item.path)
      folder.name = name
      if (input.elementDefaults !== undefined) folder.elementDefaults = input.elementDefaults
      return folder
    },
    async deleteFolder(packId, folderId) {
      const folder = folders.find(item => item.id === folderId && item.packId === packId)
      if (!folder) return false
      const folderPrefix = `${folder.path}/`
      for (let cursor = elements.length - 1; cursor >= 0; cursor -= 1) {
        const element = elements[cursor]
        if (element.packId === packId && (element.path === folder.path || element.path.startsWith(folderPrefix))) elements.splice(cursor, 1)
      }
      for (let cursor = folders.length - 1; cursor >= 0; cursor -= 1) {
        const candidate = folders[cursor]
        if (candidate.packId === packId && (candidate.path === folder.path || candidate.path.startsWith(folderPrefix))) folders.splice(cursor, 1)
      }
      return true
    },
    async updateElement(packId, elementId, input) {
      const element = elements.find(item => item.id === elementId && item.packId === packId)
      if (!element) return undefined
      const updated = validateResourceElement({ ...element, ...input, packId, id: elementId })
      elements[elements.indexOf(element)] = updated
      return updated
    },
    async deleteElement(packId, elementId) {
      const element = elements.find(item => item.id === elementId && item.packId === packId)
      if (!element) return false
      elements.splice(elements.indexOf(element), 1)
      return true
    },
    async publishPack(packId) {
      const pack = packs.find(item => item.id === packId)
      if (!pack) throw new Error('Resource Pack not found')
      assertResourcePackPublishable(pack, elements.filter((element) => element.packId === packId).map(resolvedElement))
      const { deprecatedAt: _deprecatedAt, ...activePack } = pack
      const published = { ...activePack, status: 'published' as const }
      packs[packs.indexOf(pack)] = published
      return published
    },
    async archivePack(packId) {
      const pack = packs.find(item => item.id === packId)
      if (!pack) throw new Error('Resource Pack not found')
      const archived = { ...pack, status: 'archived' as const, deprecatedAt: pack.deprecatedAt ?? new Date().toISOString() }
      packs[packs.indexOf(pack)] = archived
      return archived
    },
    async deletePack(packId) {
      const index = packs.findIndex(item => item.id === packId)
      if (index < 0) return false
      packs.splice(index, 1)
      for (let cursor = elements.length - 1; cursor >= 0; cursor -= 1) {
        if (elements[cursor].packId === packId) elements.splice(cursor, 1)
      }
      for (let cursor = folders.length - 1; cursor >= 0; cursor -= 1) {
        if (folders[cursor].packId === packId) folders.splice(cursor, 1)
      }
      return true
    },
  }
}
