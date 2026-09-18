import { z } from 'zod/v4'
import type { BeeGameAssetManifest } from './asset-contracts'
import {
  BEEGAME_CONTENT_DOCUMENT_SCHEMA,
  BEEGAME_CONTENT_INDEX,
  BEEGAME_CONTENT_PACKAGE_SCHEMA,
  BEEGAME_CONTENT_ROOT,
  BEEGAME_SCENE_ASSET_COMPONENT_TYPES,
  BEEGAME_SCENE_COMPONENT_TYPES,
  BEEGAME_SCENE_MODEL,
  BEEGAME_UI_ASSET_BACKED_ROLES,
  BEEGAME_UI_NODE_ROLES,
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
      kinds: readonly ['scene-2d', 'scene-3d', 'ui-screen', 'ui-hud', 'ui-flow', 'vfx']
      format: Readonly<Record<string, unknown>>
    }>
    validationCommand: Readonly<{
      executable: string
      args: readonly string[]
    }>
    previewCommand: Readonly<{
      executable: string
      args: readonly string[]
      outputRoot: 'content/previews/'
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
      kinds: ['scene-2d', 'scene-3d', 'ui-screen', 'ui-hud', 'ui-flow', 'vfx'],
      format: {
        strict: true,
        index: {
          schema: BEEGAME_CONTENT_PACKAGE_SCHEMA,
          id: '<stable-package-id>',
          dimension: '<2d|3d>',
          documentRevision: parsed.documentRevision,
          assetManifestRevision: parsed.assetManifestRevision,
          entryScene: '<scene-document-id>',
          sceneModel: BEEGAME_SCENE_MODEL,
          files: ['scenes/<name>.json', 'ui/<name>.json', 'vfx/<name>.json'],
        },
        sceneDocument: {
          schema: BEEGAME_CONTENT_DOCUMENT_SCHEMA,
          id: '<stable-scene-id>',
          kind: '<scene-2d|scene-3d; must match index.dimension>',
          assetRefs: ['<verified-manifest-resource-id>'],
          data: {
            settings: {
              coordinateSystem: {
                origin: 'top-left',
                units: 'logical-pixels',
                width: '<positive-number>',
                height: '<positive-number>',
                pixelsPerUnit: '<positive-number>',
              },
            },
            nodes: [
              {
                id: '<node-id>',
                parentId: '<optional-parent-id>',
                name: '<optional-name>',
                semantic: ['<optional-gameplay-identity-such-as-player-or-tree>'],
                enabled: true,
                transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                layer: '<optional-layer>',
                zIndex: 0,
                components: [
                  {
                    id: '<stable-component-id; unique across the scene>',
                    type: '<one canonical type from format.sceneVocabulary.componentTypes>',
                    assetRef: '<only-for-a-type-in-format.sceneVocabulary.assetComponentTypes>',
                    data: {},
                  },
                ],
                data: {
                  behaviors: [
                    {
                      id: '<stable-behavior-id; unique within the node>',
                      kind: '<open gameplay behavior kind owned by the runtime>',
                      config: {},
                    },
                  ],
                  authoredMetadata: '<optional-node-level-metadata-only>',
                },
              },
            ],
            cameraNodeId: '<optional-node-id>',
          },
        },
        sceneVocabulary: {
          model: BEEGAME_SCENE_MODEL,
          componentTypes: BEEGAME_SCENE_COMPONENT_TYPES,
          assetComponentTypes: BEEGAME_SCENE_ASSET_COMPONENT_TYPES,
          requiredData: {
            camera: {
              orthographic: '<boolean>',
              orthographicSize: '<positive-number when orthographic>',
              fieldOfView: '<number in (0,180) when perspective>',
              coordinateSpace: '<logical-pixels|world-units>',
              viewport: { width: '<positive-number>', height: '<positive-number>' },
            },
            'rect-transform': {
              anchorMin: ['<number>', '<number>'],
              anchorMax: ['<number>', '<number>'],
              anchoredPosition: ['<number>', '<number>'],
              sizeDelta: ['<number>', '<number>'],
              pivot: ['<number>', '<number>'],
            },
            'box-collider-2d': { size: ['<number>', '<number>'], offset: ['<number>', '<number>'], isTrigger: '<boolean>' },
            'circle-collider-2d': { radius: '<positive-number>', offset: ['<number>', '<number>'], isTrigger: '<boolean>' },
            'capsule-collider-2d': { size: ['<number>', '<number>'], offset: ['<number>', '<number>'], direction: '<horizontal|vertical>', isTrigger: '<boolean>' },
            'polygon-collider-2d': { points: [['<number>', '<number>']], offset: ['<number>', '<number>'], isTrigger: '<boolean>' },
            'rigidbody-2d': { bodyType: '<dynamic|kinematic|static>' },
            'box-collider': { size: ['<number>', '<number>', '<number>'], center: ['<number>', '<number>', '<number>'], isTrigger: '<boolean>' },
            'sphere-collider': { radius: '<positive-number>', center: ['<number>', '<number>', '<number>'], isTrigger: '<boolean>' },
            'capsule-collider': { radius: '<positive-number>', height: '<positive-number>', center: ['<number>', '<number>', '<number>'], direction: '<x|y|z>', isTrigger: '<boolean>' },
            'mesh-collider': { convex: '<boolean>', isTrigger: '<boolean>' },
            rigidbody: { isKinematic: '<boolean>', useGravity: '<boolean>', mass: '<positive-number>' },
            canvas: { renderMode: '<screen-space-overlay|screen-space-camera|world-space>' },
            text: { text: '<string>' },
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
                role: '<one canonical role from format.uiVocabulary.roles>',
                enabled: true,
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
        uiVocabulary: {
          roles: BEEGAME_UI_NODE_ROLES,
          rootByDocumentKind: {
            'ui-screen': 'screen-root',
            'ui-hud': 'hud-root',
            'ui-flow': 'flow-root',
          },
          flowChildRole: 'flow-screen',
          assetBackedRoles: BEEGAME_UI_ASSET_BACKED_ROLES,
          structuralRoles: ['screen-root', 'hud-root', 'flow-root', 'flow-screen', 'container'],
          controlRoles: ['button', 'slider', 'toggle', 'dropdown', 'tab'],
          graphicRoles: ['text', 'image', 'sprite', 'nineSlicePanel', 'shape', 'keycap'],
          behaviorRoles: ['toast', 'worldPrompt', 'capsuleSegment', 'emitter'],
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
          `The index must declare sceneModel "${BEEGAME_SCENE_MODEL}". Every scene node is a GameObject; node.kind is forbidden.`,
          'Use one Unity-style GameObject/Component model for both dimensions. Transform is always 3D. A 2D scene uses the XY plane, Z ordering and an orthographic Camera; a 3D scene uses full XYZ space.',
          'Put gameplay identity such as player, enemy, tree, anchor or checkpoint in node.semantic. Put renderer, physics, audio, animation, lighting and camera capabilities in components using exactly format.sceneVocabulary.componentTypes. Every component requires a stable unique id that is independent of array order. An empty GameObject has no renderer. Gameplay behavior metadata belongs in node.data.behaviors as entries with stable id, kind and config; do not add script or MonoBehaviour components.',
          'Every visible object must retain a real renderer: use sprite-renderer for authored 2D graphics, world-space canvas + canvas-renderer + image/text for solid-color meters and labels, Light2D spot data for a 2D vision cone, and particle-system + particle-system-renderer for particles.',
          'Scene nodes never own assetRef or frameRef directly. Only component types listed in format.sceneVocabulary.assetComponentTypes may own component.assetRef. SpriteRenderer, MeshFilter, SkinnedMeshRenderer and Tilemap require a verified component.assetRef; a textured Image requires one, while an intentionally solid-color Image does not. Select a specific multi-file member in component.data.member.',
          'Use only the declared component vocabulary. Visible shapes require SpriteRenderer with an asset or a Canvas Image graphic, collision requires a concrete 2D or 3D Collider, and Camera serves both dimensions. A 2D Camera must be orthographic and declare coordinateSpace, orthographicSize and viewport; the scene settings coordinateSystem is the single authority for logical-pixels width, height and pixelsPerUnit. Script components and scriptId fields do not belong in scene documents.',
          'ParticleSystem owns simulation modules; ParticleSystemRenderer owns its material/texture and must share the GameObject. MeshRenderer requires MeshFilter. TilemapRenderer requires Tilemap. Never mix Rigidbody with Rigidbody2D on one GameObject.',
          'Put scene-wide world, camera and layer settings in scene data.settings or on a camera component/node. Do not encode settings as a world-config node.',
          'UI node role is a closed vocabulary: use exactly one value from format.uiVocabulary.roles. Never invent a role from a visual name, business label, control variant or implementation class.',
          'A UI role describes the authored object purpose, not an asset kind. Only format.uiVocabulary.assetBackedRoles may own node.assetRef; structural, control, procedural and behavior roles must keep node.assetRef absent and place any referenced image or texture in their existing nested data/style reference.',
          'Use the exact root role in format.uiVocabulary.rootByDocumentKind. A ui-flow document contains only its flow-root plus flow-screen children; visual UI belongs in ui-screen or ui-hud documents.',
          'For a multi-file visual resource, set data.member (or the equivalent nested texture/sprite action member) whenever the node needs a file other than the resource root; do not rely on filename guessing.',
          'Visible authored world graphics must use a real renderer plus a verified asset. A scene Image may omit assetRef only when it is an intentionally solid-color Unity UI graphic on a Canvas; encode its color/opacity in data. Collider and trigger components are non-visual. A nine-slice panel that uses an image remains an asset-backed UI node and must reference its verified image resource and member.',
          'A ParticleSystem alone is never considered rendered. Put particle-system-renderer on the same GameObject; give that renderer a verified texture asset when the design calls for textured particles.',
          'Canvas, Image and Text follow Unity UI dependencies: Canvas owns a RectTransform; Image/Text require RectTransform and CanvasRenderer and must be descendants of a Canvas. RectTransform data uses anchorMin, anchorMax, anchoredPosition, sizeDelta and pivot.',
        ],
      },
    },
    validationCommand: {
      executable: process.execPath,
      args: [new URL('./game-content-validation-cli.ts', import.meta.url).pathname],
    },
    previewCommand: {
      executable: process.execPath,
      args: [
        new URL('./scene-content-preview-cli.ts', import.meta.url).pathname,
        '.',
      ],
      outputRoot: 'content/previews/' as const,
    },
  } as const
  return Object.freeze({
    task: 'GAME_CONTENT',
    allowedPaths: ['content/'] as const,
    contract,
  })
}
