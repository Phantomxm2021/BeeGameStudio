import type {
  ResourceDeliveryCapability,
  ResourceRequirementCandidate,
} from '@bee-game-studio/beegame-resource-core'
import { z } from 'zod/v4'
import { readBeeGameAssetManifest } from './asset-contracts'
import {
  ProjectResourceApplication,
  type ProjectResourceSelectionClient,
} from './project-resource-application'

const MAX_CANDIDATES_PER_REQUIREMENT = 8
const resourceLibraryInputSchema = z
  .object({ action: z.literal('match_requirements') })
  .strict()

type ResourceLibraryInput = z.infer<typeof resourceLibraryInputSchema>
type BuildTool = (definition: Record<string, unknown>) => unknown

/**
 * Agent-facing Resource Library discovery. Requirement semantics come only
 * from the canonical Manifest and target delivery capabilities come only from
 * the configured adapters. The Agent receives one bounded candidate set and
 * cannot page through or mutate the catalog through this tool.
 */
export function createNativeResourceLibraryTool(options: {
  buildTool: BuildTool
  workspacePath: string
  client: ProjectResourceSelectionClient
  deliveryCapabilities: readonly ResourceDeliveryCapability[]
}): unknown {
  const application = new ProjectResourceApplication(options.client)
  let callInFlight = false

  return options.buildTool({
    name: 'ResourceLibrary',
    alwaysLoad: true,
    maxResultSizeChars: 48_000,
    inputSchema: resourceLibraryInputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => true,
    async description() {
      return 'Match every canonical resource requirement against authored Resource Library metadata in one bounded request.'
    },
    async prompt() {
      return [
        'ResourceLibrary provides one bounded match for all requirements in the canonical Asset Manifest.',
        'Call match_requirements once. The service uses structured dimensions, asset kinds, usage tags, capabilities and styles; it never infers suitability from names, paths, keywords or regular expressions.',
        'Source formats are admitted through configured delivery adapters, so a convertible source remains eligible even when its source format differs from the target runtime format.',
        'This tool is discovery-only. Final selection, conversion, acquisition and provisional replacement are committed atomically through CommitResourceInventory.',
      ].join(' ')
    },
    async checkPermissions(input: ResourceLibraryInput) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(_input: ResourceLibraryInput) {
      if (callInFlight) {
        throw new Error('ResourceLibrary accepts one match operation at a time.')
      }
      callInFlight = true
      try {
        const manifest = await readBeeGameAssetManifest(options.workspacePath)
        const result = await application.matchRequirements({
          requirements: manifest.requirements.map(requirement => ({
            requirementId: requirement.id,
            profile: {
              dimensions: requirement.acquisition_profile.dimensions,
              assetKinds: requirement.acquisition_profile.asset_kinds,
              usageTags: requirement.acquisition_profile.usage_tags,
              capabilities: requirement.acquisition_profile.capabilities,
              styles: requirement.acquisition_profile.styles,
            },
          })),
          deliveryCapabilities: options.deliveryCapabilities,
          maxCandidatesPerRequirement: MAX_CANDIDATES_PER_REQUIREMENT,
        })
        return { data: compactMatchResult(result) }
      } finally {
        callInFlight = false
      }
    },
    renderToolUseMessage() {
      return 'Resource Library · match requirements'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(output),
      }
    },
  })
}

function compactMatchResult(result: Awaited<ReturnType<ProjectResourceApplication['matchRequirements']>>) {
  return {
    catalog_revision: result.catalogRevision,
    requirements: result.groups.map(group => ({
      requirement_id: group.requirementId,
      status: group.status,
      candidates: group.candidates.map(compactCandidate),
      unclassified_element_ids: group.unclassifiedElementIds,
    })),
  }
}

function compactCandidate(candidate: ResourceRequirementCandidate) {
  return {
    pack_id: candidate.packId,
    pack_version: candidate.packVersion,
    element_id: candidate.elementId,
    element_name: candidate.elementName,
    element_path: candidate.elementPath,
    category: candidate.category,
    dimension: candidate.dimension,
    asset_kind: candidate.assetKind,
    usage_tags: candidate.usageTags,
    capabilities: candidate.capabilities,
    technical_facts: candidate.technicalFacts,
    dependency_count: candidate.dependencyCount,
    delivery: {
      source_format: candidate.delivery.sourceFormat,
      disposition: candidate.delivery.disposition,
      target_format: candidate.delivery.targetFormat,
      ...(candidate.delivery.adapterId ? { adapter_id: candidate.delivery.adapterId } : {}),
    },
  }
}
