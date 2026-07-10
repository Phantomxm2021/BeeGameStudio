import type { PackSummary, ResourceCategory, ResourceElement, ResourcePack } from './types'
import { validateResourceElement, validateResourcePack } from './validation'

export type { ResourceElement, ResourcePack } from './types'

export type ResourceRepository = {
  listPacks(): Promise<PackSummary[]>
  getPack(packId: string): Promise<PackSummary | undefined>
  listElements(packId: string, category?: ResourceCategory): Promise<ResourceElement[]>
  getElement(packId: string, elementId: string): Promise<ResourceElement | undefined>
}

export function createInMemoryResourceRepository(input: {
  packs: ResourcePack[]
  elements: ResourceElement[]
}): ResourceRepository {
  const packs = input.packs.map(validateResourcePack)
  const elements = input.elements.map(validateResourceElement)
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
  }
}
