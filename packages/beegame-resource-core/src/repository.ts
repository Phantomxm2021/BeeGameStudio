import { RESOURCE_USAGE_TAGS, type PackSummary, type ResourceCatalogPack, type ResourceCategory, type ResourceCurationBatchInput, type ResourceCurationRejectInput, type ResourceCurationQueue, type ResourceElement, type ResourceFolder, type ResourcePack } from './types'
import { applyResourceSemanticDecision, type ResourceSemanticCommitMode, type ResourceSemanticCommitResult, type ResourceSemanticModelDecision } from './semantic-curation'
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
  createFolder(packId: string, input: { id: string; name: string; parentId?: string }): Promise<ResourceFolder>
  updateFolder(packId: string, folderId: string, input: { name?: string }): Promise<ResourceFolder | undefined>
  deleteFolder(packId: string, folderId: string): Promise<boolean>
  updateElement(packId: string, elementId: string, input: Partial<ResourceElement>): Promise<ResourceElement | undefined>
  commitSemanticDecision?(packId: string, decision: ResourceSemanticModelDecision, generatedAt: string, options?: { commitMode?: ResourceSemanticCommitMode }): Promise<ResourceSemanticCommitResult>
  listCuration?(packId: string): Promise<ResourceCurationQueue>
  confirmCuration?(packId: string, input: ResourceCurationBatchInput): Promise<ResourceElement[]>
  rejectCuration?(packId: string, input: ResourceCurationRejectInput): Promise<ResourceElement[]>
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
  const resolvedElement = (element: ResourceElement): ResourceElement => resolveEffectiveResourceMetadata(element)
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
      const folder = { id: input.id, packId, name: input.name, ...(input.parentId ? { parentId: input.parentId } : {}), path }
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
    async commitSemanticDecision(packId, decision, generatedAt, options) {
      const element = elements.find(candidate => candidate.packId === packId && candidate.id === decision.elementId)
      if (!element) throw new Error('Resource element not found')
      const effective = resolvedElement(element)
      const result = applyResourceSemanticDecision(element, decision, generatedAt, effective.usageTags ?? [], options)
      const stored = validateResourceElement(result.element)
      elements[elements.indexOf(element)] = stored
      return { ...result, element: resolvedElement(stored) }
    },
    async listCuration(packId) {
      const pack = packs.find(item => item.id === packId)
      const scoped = elements.filter(element => element.packId === packId)
      const resolved = pack ? scoped.map(resolvedElement) : scoped
      const items = scoped
        .filter(element => element.status === 'ready' && (element.usageTagsMode !== 'override' || Boolean(element.semanticSuggestion)))
        .map(element => resolvedElement(element))
      return {
        items,
        counts: {
          pendingSuggestions: items.length,
          missingSemanticTags: scoped.filter(element => element.status === 'ready' && element.usageTagsMode !== 'override').length,
          technicalIssues: resolved.filter(element => !element.assetKind || !element.specs.contentHash).length,
          dependencyIssues: resolved.filter(element => element.dependencies.some(id => !scoped.some(candidate => candidate.id === id))).length,
        },
        usageTagOptions: RESOURCE_USAGE_TAGS,
      }
    },
    async confirmCuration(packId, input) {
      if (!input.decisions.length) throw new Error('Resource curation decisions are required')
      const decisionIds = input.decisions.map(decision => decision.elementId)
      if (new Set(decisionIds).size !== decisionIds.length || input.decisions.some(decision => !decision.usageTags.length)) {
        throw new Error('Resource curation decisions are invalid')
      }
      const selected = elements.filter(element => element.packId === packId && decisionIds.includes(element.id))
      if (selected.length !== input.decisions.length) throw new Error('Resource curation element selection is invalid')
      const selectedById = new Map(selected.map(element => [element.id, element]))
      const updates = input.decisions.map(decision => {
        const element = selectedById.get(decision.elementId)
        if (!element) throw new Error('Resource curation element selection is invalid')
        if (decision.sourceContentHash && element.specs.contentHash !== decision.sourceContentHash) throw new Error('Resource curation decision content hash is stale')
        if (element.semanticSuggestion) {
          if (decision.sourceContentHash !== element.semanticSuggestion.sourceContentHash || decision.suggestionRevision !== element.semanticSuggestion.generatorRevision) {
            throw new Error('Resource curation decision is stale')
          }
        }
        return { element, decision }
      })
      for (const { element, decision } of updates) {
        const updated = validateResourceElement({
          ...element,
          usageTags: [...new Set(decision.usageTags)],
          usageTagsMode: 'override',
          ...(decision.styleOverride === undefined ? {} : { styleOverride: decision.styleOverride ?? undefined }),
          semanticSuggestion: undefined,
        })
        elements[elements.indexOf(element)] = updated
      }
      return selected.map(element => resolvedElement(elements.find(candidate => candidate.id === element.id)!))
    },
    async rejectCuration(packId, input) {
      const selected = elements.filter(element => element.packId === packId && input.elementIds.includes(element.id))
      if (selected.length !== input.elementIds.length) throw new Error('Resource curation element selection is invalid')
      for (const element of selected) {
        const { semanticSuggestion: _discarded, ...withoutSuggestion } = element
        elements[elements.indexOf(element)] = withoutSuggestion
      }
      return selected.map(element => resolvedElement(elements.find(candidate => candidate.id === element.id)!))
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
