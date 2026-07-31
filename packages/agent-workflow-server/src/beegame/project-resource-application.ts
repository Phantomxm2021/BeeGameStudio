import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  effectiveAssetFormats,
  importBeeGameLibraryResourceInWorkspace,
  readBeeGameAssetManifest,
  refreshBeeGameLibraryImportMetadataInWorkspace,
  type BeeGameAssetManifest,
  type BeeGameResourceImport,
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
  browsePackElements(
    packId: string,
    input: ResourceCatalogInput,
  ): Promise<ResourceCatalogElementPage>
  inspectPack(packId: string): Promise<ResourcePackInspectionResult>
  resolveSelections(
    selections: Array<{
      importId: string
      packId: string
      expectedPackVersion: string
      elementId: string
      destinationPath?: string
      selectionReason: string[]
    }>,
  ): Promise<ResourceResolvedSelection[]>
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

const RESOURCE_INVENTORY_POLICY_PATH =
  '.beegame/resources/inventory-policy.json'
const MAX_AGENT_CATALOG_PAGE_ITEMS = 16

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
    const requestedLimit = Math.min(
      Math.max(Math.trunc(input.limit ?? MAX_AGENT_CATALOG_PAGE_ITEMS), 1),
      MAX_AGENT_CATALOG_PAGE_ITEMS,
    )
    const items: ResourceCatalogElementPage['items'][number][] = []
    const visitedCursors = new Set<string>()
    let cursor = input.cursor
    let total = 0
    let facets: ResourceCatalogElementPage['facets'] | undefined

    while (items.length < requestedLimit) {
      if (cursor) {
        if (visitedCursors.has(cursor))
          throw new Error('Resource element catalog returned a repeated cursor')
        visitedCursors.add(cursor)
      }
      const page = await this.client.browsePackElements(packId, {
        ...(input.filters ? { filters: input.filters } : {}),
        ...(cursor ? { cursor } : {}),
        limit: Math.min(
          MAX_AGENT_CATALOG_PAGE_ITEMS,
          requestedLimit - items.length,
        ),
      })
      if (page.items.length > requestedLimit - items.length) {
        throw new Error(
          'Resource element catalog exceeded the requested bounded page size',
        )
      }
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
  async resolveElementIdByExactPath(
    packId: string,
    elementPath: string,
  ): Promise<string> {
    const visitedCursors = new Set<string>()
    let cursor: string | undefined
    do {
      if (cursor) {
        if (visitedCursors.has(cursor))
          throw new Error('Resource element catalog returned a repeated cursor')
        visitedCursors.add(cursor)
      }
      const page = await this.client.browsePackElements(packId, {
        ...(cursor ? { cursor } : {}),
        limit: 64,
      })
      const match = page.items.find(
        element => element.elementPath === elementPath,
      )
      if (match) return match.elementId
      cursor = page.nextCursor
    } while (cursor)
    throw new Error(
      `Resource element path is not present in Pack: ${elementPath}`,
    )
  }

  async importExplicitSelections(
    workspacePath: string,
    selections: Array<{
      importId: string
      requirementIds?: string[]
      packId: string
      expectedPackVersion: string
      elementId: string
      destinationPath: string
      selectionReason: string[]
    }>,
  ): Promise<ProjectResourceImportBatchResult> {
    const manifestBeforeImport = await readBeeGameAssetManifest(workspacePath)
    const targetFormats =
      manifestBeforeImport.project_target?.asset_format_capabilities?.filter(
        format => typeof format === 'string' && format.trim(),
      ) ?? []
    if (targetFormats.length === 0) {
      return {
        manifest: manifestBeforeImport,
        results: selections.map(selection => ({
          importId: selection.importId,
          status: 'failed' as const,
          packId: selection.packId,
          packVersion: selection.expectedPackVersion,
          elementId: selection.elementId,
          error:
            'Target runtime project_target.asset_format_capabilities must be recorded in assets/asset-manifest.json before Resource Library import',
        })),
      }
    }
    const importBudget = manifestBeforeImport.requirements.reduce(
      (total, requirement) =>
        total + (requirement.resource_requirement?.import_budget ?? 0),
      0,
    )
    const existingImportIds = new Set(
      (manifestBeforeImport.imports ?? []).map(
        resourceImport => resourceImport.id,
      ),
    )
    const requestedNewImportIds = new Set(
      selections
        .map(selection => selection.importId)
        .filter(importId => !existingImportIds.has(importId)),
    )
    if (requestedNewImportIds.size > 0 && importBudget <= 0) {
      throw new Error(
        'Resource import budget must be declared in requirement.resource_requirement.import_budget before importing new inventory',
      )
    }
    if (requestedNewImportIds.size > 0) {
      await assertInventoryCeiling(workspacePath, importBudget)
    }
    if (
      (manifestBeforeImport.imports?.length ?? 0) + requestedNewImportIds.size >
      importBudget
    ) {
      throw new Error(
        `Resource import budget exceeded: ${manifestBeforeImport.imports?.length ?? 0} existing + ${requestedNewImportIds.size} new > ${importBudget}`,
      )
    }
    const resolved = await this.client.resolveSelections(
      selections.map(selection => ({
        importId: selection.importId,
        packId: selection.packId,
        expectedPackVersion: selection.expectedPackVersion,
        elementId: selection.elementId,
        destinationPath: selection.destinationPath,
        selectionReason: selection.selectionReason,
      })),
    )
    const resolvedById = new Map(
      resolved.map(selection => [selection.importId, selection]),
    )
    const results: ProjectResourceImportBatchResult['results'] = []
    for (const requested of selections) {
      const selection = resolvedById.get(requested.importId)
      if (!selection) {
        results.push({
          importId: requested.importId,
          status: 'failed',
          packId: requested.packId,
          packVersion: '',
          elementId: requested.elementId,
          error: 'Explicit resource selection could not be resolved',
        })
        continue
      }
      const requirementIssue = importRequirementIssue(
        manifestBeforeImport,
        requested.requirementIds ?? [],
        selection.elementPath,
      )
      if (requirementIssue) {
        results.push({
          importId: requested.importId,
          status: 'failed',
          packId: requested.packId,
          packVersion: selection.packVersion,
          elementId: selection.elementId,
          error: requirementIssue,
        })
        continue
      }
      try {
        const imported = await importBeeGameLibraryResourceInWorkspace(
          workspacePath,
          {
            id: requested.importId,
            ...(requested.requirementIds?.length
              ? { requirement_ids: requested.requirementIds }
              : {}),
            destination_path: requested.destinationPath,
            pack_id: selection.packId,
            pack_version: selection.packVersion,
            element_id: selection.elementId,
            element_path: selection.elementPath,
            source_url: selection.sourceUrl,
            selection_reason: requested.selectionReason,
            ...(selection.assetKind ? { asset_kind: selection.assetKind } : {}),
            ...(selection.capabilities?.length
              ? { capabilities: selection.capabilities }
              : {}),
            ...(selection.contentProfile
              ? { content_profile: selection.contentProfile }
              : {}),
            ...(selection.technicalFacts
              ? { technical_facts: selection.technicalFacts }
              : {}),
            dependencies: selection.dependencies?.map(dependency => ({
              key: dependency.key,
              parent_key: dependency.parentKey,
              element_id: dependency.elementId,
              element_path: dependency.elementPath,
              reference_path: dependency.referencePath,
              source_url: dependency.sourceUrl,
              ...(dependency.kind ? { kind: dependency.kind } : {}),
            })),
          },
          this.fetchImpl,
        )
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
        results.push({
          importId: requested.importId,
          status: 'failed',
          packId: requested.packId,
          packVersion: selection.packVersion,
          elementId: requested.elementId,
          error: toErrorMessage(error),
        })
      }
    }
    const manifest = await readBeeGameAssetManifest(workspacePath)
    return { manifest, results }
  }

  async refreshImportedMetadata(
    workspacePath: string,
  ): Promise<ProjectResourceMetadataRefreshResult> {
    const manifest = await readBeeGameAssetManifest(workspacePath)
    const libraryImports = (manifest.imports ?? []).filter(
      resourceImport => resourceImport.source.type === 'resource-library',
    )
    const resolved: ResourceResolvedSelection[] = []
    const unresolvedImportIds: string[] = []
    const importsByPack = new Map<string, typeof libraryImports>()
    for (const resourceImport of libraryImports) {
      const packId = resourceImport.source.pack_id!
      importsByPack.set(packId, [
        ...(importsByPack.get(packId) ?? []),
        resourceImport,
      ])
    }
    for (const imports of importsByPack.values()) {
      for (let start = 0; start < imports.length; start += 64) {
        const result = await this.resolveRefreshBatchResiliently(
          imports.slice(start, start + 64),
        )
        resolved.push(...result.resolved)
        unresolvedImportIds.push(...result.unresolvedImportIds)
      }
    }
    const refreshed = await refreshBeeGameLibraryImportMetadataInWorkspace(
      workspacePath,
      resolved.map(selection => ({
        import_id: selection.importId,
        pack_id: selection.packId,
        pack_version: selection.packVersion,
        element_id: selection.elementId,
        ...(selection.assetKind ? { asset_kind: selection.assetKind } : {}),
        ...(selection.capabilities
          ? { capabilities: selection.capabilities }
          : {}),
        ...(selection.contentProfile
          ? { content_profile: selection.contentProfile }
          : {}),
        ...(selection.technicalFacts
          ? { technical_facts: selection.technicalFacts }
          : {}),
      })),
    )
    return { ...refreshed, unresolvedImportIds }
  }

  private async resolveRefreshBatchResiliently(
    imports: BeeGameResourceImport[],
  ): Promise<{
    resolved: ResourceResolvedSelection[]
    unresolvedImportIds: string[]
  }> {
    if (imports.length === 0) return { resolved: [], unresolvedImportIds: [] }
    try {
      const result = await this.client.resolveSelections(
        imports.map(resourceImport => ({
          importId: resourceImport.id,
          packId: resourceImport.source.pack_id!,
          expectedPackVersion: resourceImport.source.pack_version!,
          elementId: resourceImport.source.element_id!,
          selectionReason: resourceImport.selection_reason.length
            ? resourceImport.selection_reason
            : ['refresh-existing-import-metadata'],
        })),
      )
      const returned = new Set(result.map(selection => selection.importId))
      return {
        resolved: result,
        unresolvedImportIds: imports
          .filter(resourceImport => !returned.has(resourceImport.id))
          .map(resourceImport => resourceImport.id),
      }
    } catch {
      if (imports.length === 1) {
        return { resolved: [], unresolvedImportIds: [imports[0]!.id] }
      }
      const midpoint = Math.ceil(imports.length / 2)
      const [left, right] = await Promise.all([
        this.resolveRefreshBatchResiliently(imports.slice(0, midpoint)),
        this.resolveRefreshBatchResiliently(imports.slice(midpoint)),
      ])
      return {
        resolved: [...left.resolved, ...right.resolved],
        unresolvedImportIds: [
          ...left.unresolvedImportIds,
          ...right.unresolvedImportIds,
        ],
      }
    }
  }
}

function importRequirementIssue(
  manifest: BeeGameAssetManifest,
  requirementIds: string[],
  elementPath: string,
): string | undefined {
  if (!requirementIds.length) return undefined
  const extension = elementPath.split('.').at(-1)?.trim().toLowerCase() ?? ''
  for (const requirementId of requirementIds) {
    const requirement = manifest.requirements.find(
      candidate => candidate.id === requirementId,
    )
    if (!requirement)
      return `Resource requirement does not exist: ${requirementId}`
    if (!requirement.resource_requirement)
      return `Resource requirement does not accept imported files: ${requirementId}`
    const formats = effectiveAssetFormats(requirement, manifest.project_target)
    if (!extension || !formats.includes(extension)) {
      return `Resource format .${extension || 'unknown'} is not accepted by requirement ${requirementId}`
    }
  }
  return undefined
}

async function assertInventoryCeiling(
  workspacePath: string,
  declaredBudget: number,
): Promise<void> {
  const path = join(resolve(workspacePath), RESOURCE_INVENTORY_POLICY_PATH)
  if (!existsSync(path)) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      JSON.stringify({ version: 1, inventoryCeiling: declaredBudget }),
      'utf8',
    )
    return
  }
  let policy: unknown
  try {
    policy = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(
      'Resource inventory policy is invalid and must be repaired before importing new inventory',
    )
  }
  const ceiling =
    policy &&
    typeof policy === 'object' &&
    !Array.isArray(policy) &&
    (policy as Record<string, unknown>).version === 1 &&
    Number.isInteger((policy as Record<string, unknown>).inventoryCeiling)
      ? Number((policy as Record<string, unknown>).inventoryCeiling)
      : undefined
  if (ceiling === undefined || ceiling < 0) {
    throw new Error(
      'Resource inventory policy is invalid and must be repaired before importing new inventory',
    )
  }
  if (declaredBudget > ceiling) {
    throw new Error(
      `Resource import budget cannot be increased after inventory selection begins: ${declaredBudget} declared > ${ceiling} locked`,
    )
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
