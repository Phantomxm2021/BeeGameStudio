import { CANONICAL_ASSET_MANIFEST, CURRENT_ASSET_MANIFEST_VERSION } from './types'
import { BEEGAME_JSON_CONTENT_KINDS, BEEGAME_YAML_CONTENT_KINDS } from './authoring-delivery-values'
export const SYSTEM_DELIVERY_CONTRACT_ARTIFACT_PATH = 'systemDeliveryContract' as const
export function buildSystemDeliveryContract() {
  return {
    canonicalAssetManifest: { path: CANONICAL_ASSET_MANIFEST, version: CURRENT_ASSET_MANIFEST_VERSION },
    roots: { runtimeAssets: 'assets/runtime', content: 'assets/content', generatedAdapters: 'assets/generated' },
    content: {
      schema: 'beegame-content-v1',
      requiredFields: ['schema', 'id', 'kind', 'fulfills', 'resources', 'data'],
      referenceSemantics: { fulfills: 'manifest-requirement-ids', resources: 'manifest-resource-ids', physicalPathsOwnedBy: 'canonical-asset-manifest' },
      jsonKinds: [...BEEGAME_JSON_CONTENT_KINDS],
      yamlKinds: [...BEEGAME_YAML_CONTENT_KINDS],
      factOwnership: 'single',
    },
    resourceLoading: { manifestCount: 1, contentRootCount: 1, placeholderUsesCanonicalPath: true, runtimeOrSourceMediaSubstituteAllowed: false, secondaryLoaderAllowed: false },
  } as const
}
