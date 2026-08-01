import {
  addBeeGameLibraryResourceToWorkspace,
  readBeeGameAssetManifest,
  refreshBeeGameLibraryResourceMetadataInWorkspace,
  type BeeGameAssetManifest,
  type BeeGameProjectResource,
} from './asset-contracts'
import type {
  ResourceCatalogBrowsePage,
  ResourceCatalogInput,
  ResourceResolvedSelection,
} from './resource-selection-client'

export type ProjectResourceSelectionClient = {
  browseCatalog(input: ResourceCatalogInput): Promise<ResourceCatalogBrowsePage>
  resolveResources(
    selections: Array<{
      resourceId: string
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

export type ProjectResourceAcquisition = {
  resourceId: string
  status: 'verified' | 'failed'
  packId: string
  packVersion: string
  elementId: string
  rootPath?: string
  filePaths?: string[]
  error?: string
}

export type ProjectResourceAcquisitionResult = {
  manifest: BeeGameAssetManifest
  resources: ProjectResourceAcquisition[]
}

export type ProjectResourceMetadataRefreshResult = {
  manifest: BeeGameAssetManifest
  refreshedResourceIds: string[]
  unresolvedResourceIds: string[]
}

const MAX_AGENT_CATALOG_PAGE_ITEMS = 64

/**
 * Project-side boundary for browsing and acquiring Resource Library material.
 * It deliberately knows nothing about project-specific game responsibilities.
 * The Agent may browse repeatedly, acquire useful material, and compose it later.
 */
export class ProjectResourceApplication {
  constructor(
    private readonly client: ProjectResourceSelectionClient,
    private readonly fetchImpl: ProjectResourceFetch = fetch,
  ) {}

  browseCatalog(input: ResourceCatalogInput) {
    return this.client.browseCatalog({
      ...input,
      limit: Math.min(
        Math.max(Math.trunc(input.limit ?? MAX_AGENT_CATALOG_PAGE_ITEMS), 1),
        MAX_AGENT_CATALOG_PAGE_ITEMS,
      ),
    })
  }

  async acquireResources(
    workspacePath: string,
    selections: Array<{
      resourceId: string
      packId: string
      expectedPackVersion: string
      elementId: string
      destinationPath: string
      selectionReason: string[]
    }>,
  ): Promise<ProjectResourceAcquisitionResult> {
    const before = await readBeeGameAssetManifest(workspacePath)
    if (!before.project_target?.asset_format_capabilities.length) {
      throw new Error(
        'project_target.asset_format_capabilities must describe the target runtime before resources are acquired',
      )
    }
    const duplicateIds = duplicateValues(
      selections.map(item => item.resourceId),
    )
    if (duplicateIds.length)
      throw new Error(`Resource ids must be unique: ${duplicateIds.join(', ')}`)

    const resolved = await this.client.resolveResources(selections)
    const resolvedById = new Map(
      resolved.map(selection => [selection.resourceId, selection]),
    )
    const resources: ProjectResourceAcquisition[] = []
    for (const request of selections) {
      const selection = resolvedById.get(request.resourceId)
      if (!selection) {
        resources.push({
          resourceId: request.resourceId,
          status: 'failed',
          packId: request.packId,
          packVersion: request.expectedPackVersion,
          elementId: request.elementId,
          error: 'The selected Resource Library element could not be resolved.',
        })
        continue
      }
      try {
        const acquired = await addBeeGameLibraryResourceToWorkspace(
          workspacePath,
          {
            id: request.resourceId,
            destination_path: request.destinationPath,
            pack_id: selection.packId,
            pack_version: selection.packVersion,
            element_id: selection.elementId,
            element_path: selection.elementPath,
            source_url: selection.sourceUrl,
            selection_reason: request.selectionReason,
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
        resources.push({
          resourceId: acquired.resource.id,
          status: 'verified',
          packId: selection.packId,
          packVersion: selection.packVersion,
          elementId: selection.elementId,
          rootPath: acquired.resource.root_path,
          filePaths: acquired.resource.file_paths,
        })
      } catch (error) {
        resources.push({
          resourceId: request.resourceId,
          status: 'failed',
          packId: selection.packId,
          packVersion: selection.packVersion,
          elementId: selection.elementId,
          error: toErrorMessage(error),
        })
      }
    }
    return {
      manifest: await readBeeGameAssetManifest(workspacePath),
      resources,
    }
  }

  async refreshLibraryMetadata(
    workspacePath: string,
  ): Promise<ProjectResourceMetadataRefreshResult> {
    const manifest = await readBeeGameAssetManifest(workspacePath)
    const libraryResources = manifest.resources.filter(
      resource => resource.source.type === 'resource-library',
    )
    const resolved: ResourceResolvedSelection[] = []
    const unresolvedResourceIds: string[] = []
    for (let start = 0; start < libraryResources.length; start += 64) {
      const result = await this.resolveRefreshBatch(
        libraryResources.slice(start, start + 64),
      )
      resolved.push(...result.resolved)
      unresolvedResourceIds.push(...result.unresolvedResourceIds)
    }
    const refreshed = await refreshBeeGameLibraryResourceMetadataInWorkspace(
      workspacePath,
      resolved.map(selection => ({
        resource_id: selection.resourceId,
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
    return { ...refreshed, unresolvedResourceIds }
  }

  private async resolveRefreshBatch(
    resources: BeeGameProjectResource[],
  ): Promise<{
    resolved: ResourceResolvedSelection[]
    unresolvedResourceIds: string[]
  }> {
    if (!resources.length) return { resolved: [], unresolvedResourceIds: [] }
    try {
      const result = await this.client.resolveResources(
        resources.map(resource => {
          if (resource.source.type !== 'resource-library')
            throw new Error(`Resource is not library-backed: ${resource.id}`)
          return {
            resourceId: resource.id,
            packId: resource.source.pack_id,
            expectedPackVersion: resource.source.pack_version,
            elementId: resource.source.element_id,
            selectionReason: resource.selection_reason,
          }
        }),
      )
      const returned = new Set(result.map(item => item.resourceId))
      return {
        resolved: result,
        unresolvedResourceIds: resources
          .filter(resource => !returned.has(resource.id))
          .map(resource => resource.id),
      }
    } catch {
      if (resources.length === 1)
        return { resolved: [], unresolvedResourceIds: [resources[0]!.id] }
      const midpoint = Math.ceil(resources.length / 2)
      const [left, right] = await Promise.all([
        this.resolveRefreshBatch(resources.slice(0, midpoint)),
        this.resolveRefreshBatch(resources.slice(midpoint)),
      ])
      return {
        resolved: [...left.resolved, ...right.resolved],
        unresolvedResourceIds: [
          ...left.unresolvedResourceIds,
          ...right.unresolvedResourceIds,
        ],
      }
    }
  }
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicate = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value)
    seen.add(value)
  }
  return [...duplicate]
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
