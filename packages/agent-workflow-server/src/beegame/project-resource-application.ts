import {
  importBeeGameLibraryResourceInWorkspace,
  readBeeGameAssetManifest,
  refreshBeeGameLibraryImportMetadataInWorkspace,
  type BeeGameAssetManifest,
} from './asset-contracts'
import type {
  ResourceCatalogElementPage,
  ResourceCatalogInput,
  ResourceCatalogPackPage,
  ResourcePackInspectionResult,
  ResourceResolvedSelection,
} from './resource-selection-client'

export type ProjectResourceSelectionClient = {
  browsePacks(input: ResourceCatalogInput): Promise<ResourceCatalogPackPage>
  browsePackElements(packId: string, input: ResourceCatalogInput): Promise<ResourceCatalogElementPage>
  inspectPack(packId: string): Promise<ResourcePackInspectionResult>
  resolveSelections(selections: Array<{ importId: string; packId: string; expectedPackVersion: string; elementId: string; destinationPath?: string; selectionReason: string[] }>): Promise<ResourceResolvedSelection[]>
}

type ProjectResourceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type ProjectResourceImportBatchResult = {
  manifest: BeeGameAssetManifest
  results: Array<{
    importId: string
    status: 'available' | 'failed'
    packId: string
    packVersion: string
    elementId: string
    rootPath?: string
    localFiles?: string[]
    error?: string
  }>
}

export type ProjectResourceMetadataRefreshResult = {
  manifest: BeeGameAssetManifest
  refreshedImportIds: string[]
  unresolvedImportIds: string[]
}

/**
 * Project-side resource application boundary shared by HTTP/UI and native
 * Claude tools. Pack search and signed-resource ownership remain exclusively
 * in the existing Resource Library Service.
 */
export class ProjectResourceApplication {
  constructor(
    private readonly client: ProjectResourceSelectionClient,
    private readonly fetchImpl: ProjectResourceFetch = fetch,
  ) {}

  browsePacks(input: ResourceCatalogInput) {
    return this.client.browsePacks(input)
  }

  browsePackElements(packId: string, input: ResourceCatalogInput) {
    return this.client.browsePackElements(packId, input)
  }

  /**
   * Build one bounded, compact-friendly inventory page for an Agent. Large
   * Pack inventories must remain paginated: returning hundreds of element
   * records at once can force context compaction before the Agent is able to
   * use the stable ids it just discovered.
   */
  async indexPackElements(
    packId: string,
    input: ResourceCatalogInput,
  ): Promise<ResourceCatalogElementPage> {
    const requestedLimit = Math.min(Math.max(Math.trunc(input.limit ?? 48), 1), 64)
    const items: ResourceCatalogElementPage['items'][number][] = []
    const visitedCursors = new Set<string>()
    let cursor = input.cursor
    let total = 0
    let facets: ResourceCatalogElementPage['facets'] | undefined

    while (items.length < requestedLimit) {
      if (cursor) {
        if (visitedCursors.has(cursor)) throw new Error('Resource element catalog returned a repeated cursor')
        visitedCursors.add(cursor)
      }
      const page = await this.client.browsePackElements(packId, {
        ...(input.filters ? { filters: input.filters } : {}),
        ...(cursor ? { cursor } : {}),
        limit: Math.min(64, requestedLimit - items.length),
      })
      items.push(...page.items)
      total = page.total
      facets = page.facets
      cursor = page.nextCursor
      if (!cursor || page.items.length === 0) break
    }

    return {
      items,
      total,
      ...(cursor ? { nextCursor: cursor } : {}),
      facets: facets ?? emptyCatalogFacets(),
    }
  }

  inspectPack(packId: string) {
    return this.client.inspectPack(packId)
  }

  /** Resolve a path copied verbatim from the compact inventory. This is an
   * exact identifier lookup, not semantic matching or automatic selection. */
  async resolveElementIdByExactPath(packId: string, elementPath: string): Promise<string> {
    const visitedCursors = new Set<string>()
    let cursor: string | undefined
    do {
      if (cursor) {
        if (visitedCursors.has(cursor)) throw new Error('Resource element catalog returned a repeated cursor')
        visitedCursors.add(cursor)
      }
      const page = await this.client.browsePackElements(packId, {
        ...(cursor ? { cursor } : {}),
        limit: 64,
      })
      const match = page.items.find(element => element.elementPath === elementPath)
      if (match) return match.elementId
      cursor = page.nextCursor
    } while (cursor)
    throw new Error(`Resource element path is not present in Pack: ${elementPath}`)
  }

  async importExplicitSelections(
    workspacePath: string,
    selections: Array<{ importId: string; packId: string; expectedPackVersion: string; elementId: string; destinationPath: string; selectionReason: string[] }>,
  ): Promise<ProjectResourceImportBatchResult> {
    const resolved = await this.client.resolveSelections(selections.map(selection => ({
      importId: selection.importId,
      packId: selection.packId,
      expectedPackVersion: selection.expectedPackVersion,
      elementId: selection.elementId,
      destinationPath: selection.destinationPath,
      selectionReason: selection.selectionReason,
    })))
    const resolvedById = new Map(resolved.map(selection => [selection.importId, selection]))
    const results: ProjectResourceImportBatchResult['results'] = []
    for (const requested of selections) {
      const selection = resolvedById.get(requested.importId)
      if (!selection) {
        results.push({ importId: requested.importId, status: 'failed', packId: requested.packId, packVersion: '', elementId: requested.elementId, error: 'Explicit resource selection could not be resolved' })
        continue
      }
      try {
        const imported = await importBeeGameLibraryResourceInWorkspace(workspacePath, {
          id: requested.importId,
          destination_path: requested.destinationPath,
          pack_id: selection.packId,
          pack_version: selection.packVersion,
          element_id: selection.elementId,
          element_path: selection.elementPath,
          source_url: selection.sourceUrl,
          selection_reason: requested.selectionReason,
          ...(selection.assetKind ? { asset_kind: selection.assetKind } : {}),
          ...(selection.capabilities?.length ? { capabilities: selection.capabilities } : {}),
          ...(selection.contentProfile ? { content_profile: selection.contentProfile } : {}),
          ...(selection.technicalFacts ? { technical_facts: selection.technicalFacts } : {}),
          dependencies: selection.dependencies?.map(dependency => ({
            key: dependency.key,
            parent_key: dependency.parentKey,
            element_id: dependency.elementId,
            element_path: dependency.elementPath,
            reference_path: dependency.referencePath,
            source_url: dependency.sourceUrl,
            ...(dependency.kind ? { kind: dependency.kind } : {}),
          })),
        }, this.fetchImpl)
        results.push({
          importId: imported.resourceImport.id,
          status: 'available',
          packId: selection.packId,
          packVersion: selection.packVersion,
          elementId: selection.elementId,
          rootPath: imported.resourceImport.root_path,
          localFiles: imported.resourceImport.local_files,
        })
      } catch (error) {
        results.push({ importId: requested.importId, status: 'failed', packId: requested.packId, packVersion: selection.packVersion, elementId: requested.elementId, error: toErrorMessage(error) })
      }
    }
    return { manifest: await readBeeGameAssetManifest(workspacePath), results }
  }

  async refreshImportedMetadata(workspacePath: string): Promise<ProjectResourceMetadataRefreshResult> {
    const manifest = await readBeeGameAssetManifest(workspacePath)
    const libraryImports = (manifest.imports ?? []).filter(resourceImport => resourceImport.source.type === 'resource-library')
    const resolved: ResourceResolvedSelection[] = []
    const unresolvedImportIds: string[] = []
    for (let start = 0; start < libraryImports.length; start += 64) {
      const batch = libraryImports.slice(start, start + 64)
      try {
        const result = await this.client.resolveSelections(batch.map(resourceImport => ({
          importId: resourceImport.id,
          packId: resourceImport.source.pack_id!,
          expectedPackVersion: resourceImport.source.pack_version!,
          elementId: resourceImport.source.element_id!,
          selectionReason: resourceImport.selection_reason.length ? resourceImport.selection_reason : ['refresh-existing-import-metadata'],
        })))
        resolved.push(...result)
        const returned = new Set(result.map(selection => selection.importId))
        unresolvedImportIds.push(...batch.filter(resourceImport => !returned.has(resourceImport.id)).map(resourceImport => resourceImport.id))
      } catch {
        unresolvedImportIds.push(...batch.map(resourceImport => resourceImport.id))
      }
    }
    const refreshed = await refreshBeeGameLibraryImportMetadataInWorkspace(workspacePath, resolved.map(selection => ({
      import_id: selection.importId,
      pack_id: selection.packId,
      pack_version: selection.packVersion,
      element_id: selection.elementId,
      ...(selection.assetKind ? { asset_kind: selection.assetKind } : {}),
      ...(selection.capabilities ? { capabilities: selection.capabilities } : {}),
      ...(selection.contentProfile ? { content_profile: selection.contentProfile } : {}),
      ...(selection.technicalFacts ? { technical_facts: selection.technicalFacts } : {}),
    })))
    return { ...refreshed, unresolvedImportIds }
  }

}

function emptyCatalogFacets(): ResourceCatalogElementPage['facets'] {
  return {
    dimensions: [],
    primaryCategories: [],
    categories: [],
    styles: [],
    gameTypes: [],
    packTags: [],
    usageTags: [],
    assetKinds: [],
    capabilities: [],
    formats: [],
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Resource operation failed'
}
