import {
  addBeeGameLibraryResourceToWorkspace,
  readBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from './asset-contracts'
import type {
  ResourceRequirementMatchRequest,
} from '@bee-game-studio/beegame-resource-core'
import type {
  ResourceRequirementMatchResponse,
  ResourceResolvedSelection,
} from './resource-selection-client'

export type ProjectResourceSelectionClient = {
  matchRequirements(
    input: ResourceRequirementMatchRequest,
  ): Promise<ResourceRequirementMatchResponse>
  resolveResources(
    catalogRevision: string,
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

type ProjectResourceConvert = (
  files: Array<{ name: string; bytes: Uint8Array }>,
  delivery: {
    disposition: 'direct' | 'convert'
    source_format: string
    target_format: string
    adapter_id?: string
  },
) => Promise<{ filename: string; bytes: Uint8Array }>

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

/**
 * Project-side boundary for browsing and acquiring Resource Library material.
 * It deliberately knows nothing about project-specific game responsibilities.
 * The Agent may browse repeatedly, acquire useful material, and compose it later.
 */
export class ProjectResourceApplication {
  constructor(
    private readonly client: ProjectResourceSelectionClient,
    private readonly fetchImpl: ProjectResourceFetch = fetch,
    private readonly convert?: ProjectResourceConvert,
  ) {}

  matchRequirements(input: ResourceRequirementMatchRequest) {
    return this.client.matchRequirements(input)
  }

  async acquireResources(
    workspacePath: string,
    catalogRevision: string,
    selections: Array<{
      resourceId: string
      packId: string
      expectedPackVersion: string
      elementId: string
      destinationPath: string
      selectionReason: string[]
      delivery?: {
        disposition: 'direct' | 'convert'
        sourceFormat: string
        targetFormat: string
        adapterId?: string
      }
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

    const resolved = await this.client.resolveResources(catalogRevision, selections)
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
            source_hash: selection.sourceHash,
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
            ...(request.delivery
              ? {
                  delivery: {
                    disposition: request.delivery.disposition,
                    source_format: request.delivery.sourceFormat,
                    target_format: request.delivery.targetFormat,
                    ...(request.delivery.adapterId
                      ? { adapter_id: request.delivery.adapterId }
                      : {}),
                  },
                }
              : {}),
            dependencies: selection.dependencies?.map(dependency => ({
              key: dependency.key,
              parent_key: dependency.parentKey,
              element_id: dependency.elementId,
              element_path: dependency.elementPath,
              reference_path: dependency.referencePath,
                  source_url: dependency.sourceUrl,
                  source_hash: dependency.sourceHash,
              ...(dependency.kind ? { kind: dependency.kind } : {}),
            })),
          },
          this.fetchImpl,
          { ...(this.convert ? { convert: this.convert } : {}) },
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
