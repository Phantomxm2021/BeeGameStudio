import { z } from 'zod/v4'
import type { BeeGameAssetManifest } from './asset-contracts'
import {
  BEEGAME_CONTENT_DOCUMENT_SCHEMA,
  BEEGAME_CONTENT_INDEX,
  BEEGAME_CONTENT_PACKAGE_SCHEMA,
  BEEGAME_CONTENT_ROOT,
} from './game-content-package'

const digest = z.string().regex(/^[a-f0-9]{64}$/)

const inputSchema = z
  .strictObject({
    documentRevision: digest,
    assetManifestRevision: digest,
    manifest: z.unknown(),
  })

export type SceneUiContentAuthoringInput = Readonly<{
  documentRevision: string
  assetManifestRevision: string
  manifest: BeeGameAssetManifest
}>

export type SceneUiContentAuthoringAuthority = Readonly<{
  task: 'GAME_CONTENT'
  allowedPaths: readonly ['content/']
  contract: Readonly<{
    documentRevision: string
    assetManifestRevision: string
    assetManifest: BeeGameAssetManifest
    output: Readonly<{
      root: typeof BEEGAME_CONTENT_ROOT
      index: typeof BEEGAME_CONTENT_INDEX
      packageSchema: typeof BEEGAME_CONTENT_PACKAGE_SCHEMA
      documentSchema: typeof BEEGAME_CONTENT_DOCUMENT_SCHEMA
      kinds: readonly ['scene-2d', 'ui-screen', 'ui-hud', 'ui-flow', 'vfx']
      format: Readonly<Record<string, unknown>>
    }>
    validationCommand: Readonly<{
      executable: string
      args: readonly string[]
    }>
  }>
}>

/**
 * Build the complete authority for one normal direct CLI turn.  This function
 * deliberately says what must be produced, not how the Agent must work.
 */
export function buildSceneUiContentAuthoringAuthority(
  input: SceneUiContentAuthoringInput,
): SceneUiContentAuthoringAuthority {
  const parsed = inputSchema.parse(structuredClone(input))
  const contract = {
    documentRevision: parsed.documentRevision,
    assetManifestRevision: parsed.assetManifestRevision,
    assetManifest: parsed.manifest as BeeGameAssetManifest,
    output: {
      root: BEEGAME_CONTENT_ROOT,
      index: BEEGAME_CONTENT_INDEX,
      packageSchema: BEEGAME_CONTENT_PACKAGE_SCHEMA,
      documentSchema: BEEGAME_CONTENT_DOCUMENT_SCHEMA,
      kinds: ['scene-2d', 'ui-screen', 'ui-hud', 'ui-flow', 'vfx'],
      format: {
        strict: true,
        index: {
          schema: BEEGAME_CONTENT_PACKAGE_SCHEMA,
          id: '<stable-package-id>',
          dimension: '2d',
          documentRevision: parsed.documentRevision,
          assetManifestRevision: parsed.assetManifestRevision,
          entryScene: '<scene-document-id>',
          files: ['scenes/<name>.json', 'ui/<name>.json', 'vfx/<name>.json'],
        },
        sceneDocument: {
          schema: BEEGAME_CONTENT_DOCUMENT_SCHEMA,
          id: '<stable-scene-id>',
          kind: 'scene-2d',
          assetRefs: ['<verified-manifest-resource-id>'],
          data: {
            nodes: [
              {
                id: '<node-id>',
                parentId: '<optional-parent-id>',
                name: '<optional-name>',
                kind: '<node-kind>',
                enabled: true,
                transform: { position: [0, 0], rotation: 0, scale: [1, 1] },
                layer: '<optional-layer>',
                zIndex: 0,
                assetRef: '<optional-declared-asset-id>',
                frameRef: '<optional-manifest-frame-id-for-sprites>',
                components: [
                  {
                    type: '<component-type>',
                    assetRef: '<optional-declared-asset-id>',
                    data: {},
                  },
                ],
                data: {},
              },
            ],
            cameraNodeId: '<optional-node-id>',
          },
        },
        uiDocument: {
          schema: BEEGAME_CONTENT_DOCUMENT_SCHEMA,
          id: '<stable-ui-id>',
          kind: '<ui-screen|ui-hud|ui-flow>',
          assetRefs: ['<verified-manifest-resource-id>'],
          data: {
            rootId: '<root-node-id>',
            nodes: [
              {
                id: '<node-id>',
                parentId: '<optional-parent-id>',
                role: '<ui-role>',
                name: '<optional-name>',
                text: '<optional-text>',
                assetRef: '<optional-declared-asset-id>',
                layout: {
                  anchor: '<optional-anchor>',
                  position: [0, 0],
                  size: [0, 0],
                  rotation: 0,
                  scale: [1, 1],
                },
                bindings: {},
                actions: {},
                style: {},
                data: {},
              },
            ],
          },
        },
        vfxDocument: {
          schema: BEEGAME_CONTENT_DOCUMENT_SCHEMA,
          id: '<stable-vfx-id>',
          kind: 'vfx',
          assetRefs: ['<verified-manifest-resource-id>'],
          data: {
            nodes: [
              {
                id: '<effect-id>',
                parentId: '<optional-parent-id>',
                name: '<optional-name>',
                type: '<effect-type>',
                assetRef: '<optional-declared-asset-id>',
                data: {},
              },
            ],
          },
        },
        rules: [
          'The shown index, document, data and node keys are the complete allowed keys; omit optional placeholder fields instead of adding alternatives.',
          'Every file path in index.files is relative to content/.',
          'Every used assetRef is listed once in the document assetRefs and resolves to a verified Manifest resource.',
        ],
      },
    },
    validationCommand: {
      executable: process.execPath,
      args: [new URL('./game-content-validation-cli.ts', import.meta.url).pathname],
    },
  } as const
  return Object.freeze({
    task: 'GAME_CONTENT',
    allowedPaths: ['content/'] as const,
    contract,
  })
}
