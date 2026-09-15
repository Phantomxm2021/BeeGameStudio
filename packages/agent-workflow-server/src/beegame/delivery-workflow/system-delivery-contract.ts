import {
  BEEGAME_RESOURCE_ROOTS,
  CURRENT_ASSET_MANIFEST_VERSION,
} from '../asset-contracts'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_DIMENSIONS,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'
import {
  BEEGAME_CONTENT_SCHEMA,
} from '../content-contracts'
import { CANONICAL_ASSET_MANIFEST } from './types'

export function buildSystemDeliveryContract() {
  return {
    canonicalAssetManifest: {
      path: CANONICAL_ASSET_MANIFEST,
      version: CURRENT_ASSET_MANIFEST_VERSION,
      indexFields: ['version', 'project_target', 'modules'],
      projectTargetFields: [
        'platform',
        'runtime',
        'asset_format_capabilities',
        'resource_library_usage',
        'runtime_asset_root',
        'content_root',
        'generated_asset_root',
      ],
      modules: {
        requirements: {
          root: 'assets/manifest/requirements',
          cardinality: 'exactly_one',
          fields: ['requirements'],
          requirementFields: [
            'id',
            'name',
            'purpose',
            'required',
            'acquisition_profile',
          ],
          acquisitionProfileFields: [
            'dimensions',
            'asset_kinds',
            'usage_tags',
            'capabilities',
            'styles',
            'acceptance_criteria',
            'sourcing_policy',
            'coverage',
          ],
          coverage: {
            type: 'non_empty_array',
            itemFields: [
              'asset_kinds',
              'usage_tags',
              'capabilities',
              'relation_kinds',
              'embedded_kinds',
            ],
            rule:
              'each item declares at least one listed field using canonical value arrays',
          },
          sourcingPolicyFields: [
            'allowed_source_kinds',
            'license_constraints',
            'responsible_party',
            'handoff_criteria',
          ],
        },
        resources: {
          root: 'assets/manifest/resources',
          cardinality: 'one_per_resource',
          fields: [
            'id',
            'source',
            'root_path',
            'file_paths',
            'local_file_hashes',
            'provisional',
            'status',
            'selected_at',
            'selection_reason',
            'dimension',
            'asset_kind',
            'capabilities',
            'usage_tags',
            'styles',
            'relation_kinds',
            'embedded_kinds',
            'content_profile',
            'technical_facts',
            'dependencies',
            'error',
          ],
          agentAuthoredSourceFields: ['type', 'created_at', 'reason'],
          webSourceFields: [
            'type',
            'source_url',
            'page_url',
            'license',
            'license_url',
            'author',
            'retrieved_at',
          ],
          statuses: ['available', 'verified', 'failed'],
        },
      },
      canonicalValues: {
        dimensions: [...RESOURCE_DIMENSIONS],
        assetKinds: [...RESOURCE_ASSET_KINDS],
        usageTags: [...RESOURCE_USAGE_TAGS],
        capabilities: [...RESOURCE_CAPABILITIES],
      },
      rules: [
        'asset_format_capabilities are lowercase filename extensions without dots',
        'modules.requirements is one JSON path string',
        'modules.resources is an array of JSON path strings',
        'a resource root_path is one file and must also appear in file_paths',
        'web and agent-authored resource files belong under runtime_asset_root; generated_asset_root is only for converted Resource Library deliveries',
        'a web source requires a direct source_url, containing page_url, explicit license and retrieved_at; license_url and author are optional provenance',
        'when acquisition_profile.coverage is present, acquisition_profile.capabilities must be empty',
        'each resource-realization acquisition-profile node maps to one requirement whose id is the described logical resource requirementId; copy required, name, purpose, dimensions, assetKinds, usageTags, capabilities, styles, acceptanceCriteria, sourcingPolicy and coverage exactly, changing only camelCase field names to the documented snake_case Manifest names',
        'dependencies are Resource Library provenance objects, not resource ids; omit dependencies for direct agent-authored resources',
        'omit optional resource fields when they are not needed',
        'use exactly one canonical Manifest, one content root and canonical asset paths; do not create a secondary loader',
      ],
    },
    content: {
      schema: BEEGAME_CONTENT_SCHEMA,
      requiredFields: ['schema', 'id', 'kind', 'fulfills', 'resources', 'data'],
      referenceSemantics: {
        fulfills: 'manifest-requirement-ids',
        resources: 'manifest-resource-ids',
        physicalPathsOwnedBy: 'canonical-asset-manifest',
      },
      factOwnership: 'single',
      resourceRegistryDataFields: ['bindings'],
      bindingFields: ['requirementId', 'resourceIds'],
    },
  } as const
}
