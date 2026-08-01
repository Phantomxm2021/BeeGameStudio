import {
  BEEGAME_RESOURCE_ROOTS,
  CURRENT_ASSET_MANIFEST_VERSION,
} from '../asset-contracts'
import {
  BEEGAME_CONTENT_SCHEMA,
  BEEGAME_JSON_CONTENT_KINDS,
  BEEGAME_YAML_CONTENT_KINDS,
} from '../content-contracts'
import { CANONICAL_ASSET_MANIFEST } from './types'

export const SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH =
  'systemDeliveryContract' as const

export function buildSystemDeliveryContract() {
  return {
    canonicalAssetManifest: {
      path: CANONICAL_ASSET_MANIFEST,
      version: CURRENT_ASSET_MANIFEST_VERSION,
    },
    roots: {
      runtimeAssets: BEEGAME_RESOURCE_ROOTS.runtime,
      content: BEEGAME_RESOURCE_ROOTS.content,
      generatedAdapters: BEEGAME_RESOURCE_ROOTS.generated,
    },
    content: {
      schema: BEEGAME_CONTENT_SCHEMA,
      requiredFields: ['schema', 'id', 'kind', 'fulfills', 'resources', 'data'],
      jsonKinds: [...BEEGAME_JSON_CONTENT_KINDS],
      yamlKinds: [...BEEGAME_YAML_CONTENT_KINDS],
      factOwnership: 'single',
    },
    resourceLoading: {
      manifestCount: 1,
      contentRootCount: 1,
      placeholderUsesCanonicalPath: true,
      runtimeOrSourceMediaSubstituteAllowed: false,
      secondaryLoaderAllowed: false,
    },
  } as const
}
