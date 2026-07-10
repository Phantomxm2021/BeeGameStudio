import type { PackSummary, ResourceCategory, ResourceElement, ResourceFolder, ResourcePack } from './types'
import { validateResourceElement, validateResourcePack } from './validation'

export type { ResourceElement, ResourceFolder, ResourcePack } from './types'

export type ResourceRepository = {
  listPacks(): Promise<PackSummary[]>
  getPack(packId: string): Promise<PackSummary | undefined>
  listElements(packId: string, category?: ResourceCategory): Promise<ResourceElement[]>
  getElement(packId: string, elementId: string): Promise<ResourceElement | undefined>
  createPack(pack: ResourcePack): Promise<ResourcePack>
  listFolders(packId: string): Promise<ResourceFolder[]>
  createFolder(packId: string, input: { id: string; name: string; parentId?: string }): Promise<ResourceFolder>
  publishPack(packId: string): Promise<ResourcePack>
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
    },
    async getElement(packId, elementId) {
      return elements.find(element => element.packId === packId && element.id === elementId)
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
      const folder = { id: input.id, packId, name: input.name, ...(input.parentId ? { parentId: input.parentId } : {}), path }
      folders.push(folder)
      return folder
    },
    async publishPack(packId) {
      const pack = packs.find(item => item.id === packId)
      if (!pack) throw new Error('Resource Pack not found')
      if (elements.some(element => element.packId === packId && ['queued', 'uploading', 'failed'].includes(element.status))) throw new Error('Pack has incomplete uploads')
      const published = { ...pack, status: 'published' as const }
      packs[packs.indexOf(pack)] = published
      return published
    },
  }
}
