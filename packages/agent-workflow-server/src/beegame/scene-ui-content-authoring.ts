import { z } from 'zod/v4'
import { TILEMAP_AUTHORING_CONTRACT } from './tilemap-authoring-contract'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTENT_COORDINATE_CONTRACT, UI_ANCHORS, UI_PAINT_PHASES } from '../../../scene-editor/src/content-coordinates'
import { CONTENT_RUNTIME_CONTRACT } from './content-runtime-contract'
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

export const CONTENT_AUTHORING_CONTRACT_PATH = '.beegame/delivery/content-contract.json'
export const CONTENT_FORMAT_PATH = '.beegame/delivery/content-format.json'
export const CONTENT_CHECKER_PATH = '.beegame/delivery/check-content.mjs'

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

let checkerBundle: Promise<string> | undefined
function bundledContentChecker(): Promise<string> {
  // Repeated in-process builds in our Bun 1.3 regression fixture report wrong
  // source paths/read failures. Keep compilation out of the long-lived runtime.
  return checkerBundle ??= (async () => {
    const child = Bun.spawn([process.execPath, 'build',
      fileURLToPath(new URL('./game-content-validation-cli.ts', import.meta.url)),
      '--target=bun', '--minify'], { stdout: 'pipe', stderr: 'pipe' })
    const [code, source, error] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    if (code !== 0 || !source) throw new Error(`Cannot publish content checker: ${error}`)
    return source
  })().catch(error => { checkerBundle = undefined; throw error })
}

/** Design-time format is not the later project-specific authority snapshot. */
export async function materializeSceneUiFormat(workspacePath: string) {
  const format = structuredClone(buildSceneUiContentAuthoringAuthority({
    documentRevision: '0'.repeat(64), assetManifestRevision: '0'.repeat(64),
    manifest: {} as BeeGameAssetManifest,
  }).contract.output.format) as Record<string, any>
  delete format.index.documentRevision
  delete format.index.assetManifestRevision
  format.revisionFields = 'documentRevision and assetManifestRevision are required BGS-supplied metadata, not Agent-defined hashes. Their actual values are supplied in content-contract.json when content authoring begins; none are available at design time.'
  await mkdir(dirname(join(workspacePath, CONTENT_FORMAT_PATH)), { recursive: true })
  await writeFile(join(workspacePath, CONTENT_FORMAT_PATH), JSON.stringify(format, null, 2) + '\n')
}

/** Keep large reference material in a readable file, not in every model request. */
export async function materializeSceneUiAuthoringContract(workspacePath: string, task: SceneUiContentAuthoringAuthority) {
  const authoringContractPath = CONTENT_AUTHORING_CONTRACT_PATH
  const target = join(workspacePath, authoringContractPath)
  await mkdir(dirname(target), { recursive: true })
  const inputs = {
    documentRevision: task.contract.documentRevision,
    assetManifestRevision: task.contract.assetManifestRevision,
    authoringContractPath,
    assetManifestPath: 'assets/asset-manifest.json',
    validationCommand: `bun ${CONTENT_CHECKER_PATH}`,
    authorityCommand: `bun ${CONTENT_CHECKER_PATH} --authority`,
    inspectionCommand: `bun ${CONTENT_CHECKER_PATH} --inspect [content-relative-file [--node id]]`,
    revisionUsage: 'Copy these BGS-supplied values into content/index.json; they are not hash algorithms to design. If docs/resources change during this turn, --authority reads their current values locally. The checker is read-only and uses the same implementation as BGS.',
  }
  await writeFile(join(workspacePath, CONTENT_CHECKER_PATH), await bundledContentChecker(), 'utf8')
  await materializeSceneUiFormat(workspacePath)
  await writeFile(target, JSON.stringify({ ...task.contract.output.format, inputs }, null, 2) + '\n')
  return inputs
}

export type SceneUiContentAuthoringAuthority = Readonly<{
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
        coordinates: CONTENT_COORDINATE_CONTRACT,
        runtimeConsumption: CONTENT_RUNTIME_CONTRACT,
        tilemap: TILEMAP_AUTHORING_CONTRACT,
        index: {
          schema: BEEGAME_CONTENT_PACKAGE_SCHEMA,
          id: '<stable-package-id>',
          dimension: '<2d|3d>',
          documentRevision: parsed.documentRevision,
          assetManifestRevision: parsed.assetManifestRevision,
          entryScene: '<scene-document-id>',
          sceneModel: BEEGAME_SCENE_MODEL,
          files: ['scenes/<name>.json', 'ui/<name>.json', 'vfx/<name>.json'],
          documents: [
            { id: '<scene-document-id>', path: 'scenes/<name>.json', kind: 'scene-2d', loadPhase: 'startup' },
            { id: '<initial-screen-id>', path: 'ui/<name>.json', kind: 'ui-screen', loadPhase: 'startup' },
            { id: '<other-document-id>', path: 'vfx/<name>.json', kind: 'vfx', loadPhase: 'on-demand' },
          ],
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
          viewportAdaptation: 'Scene coordinates and the authored Camera viewport describe a reference frame, not the browser canvas size. At runtime the game applies its documented camera framing choice (for example preserve vertical span, preserve horizontal span or intentional letterbox) against the actual host container; do not resize world transforms or bake a second layout into code. Keep screen UI adaptation separate from world-camera framing. This format does not implement a game engine.',
          componentTypes: BEEGAME_SCENE_COMPONENT_TYPES,
          assetComponentTypes: BEEGAME_SCENE_ASSET_COMPONENT_TYPES,
          requiredData: {
            camera: {
              orthographic: '<boolean>',
              orthographicSize: '<positive-number; for scene-2d must equal settings.coordinateSystem.height / (2 * settings.coordinateSystem.pixelsPerUnit)>',
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
                  anchorMin: ['<optional-number-0-to-1>', '<optional-number-0-to-1>'],
                  anchorMax: ['<optional-number-0-to-1>', '<optional-number-0-to-1>'],
                  sizeDelta: ['<optional-number>', '<optional-number>'],
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
        uiLayoutContract: {
          anchors: UI_ANCHORS,
          referenceResolution: 'Root data.referenceResolution is [width, height] in logical pixels: a design reference, not a fixed browser or iframe size. Root layout.size, if present, must match it. Screen-space root resolves to the actual viewport; world-space UI retains its authored root size.',
          targetViewports: 'Root data.targetViewports optionally lists the required host [width,height] pairs for layout bounds checks; the reference size is always included. Without it, checks use representative desktop window/iframe sizes, not an unrequested phone target. Include mobile sizes only when mobile is a confirmed target.',
          responsive: 'The base layout is the reference composition. Optional node.responsive.compact and node.responsive.portrait may override enabled, layout fields and style fields. Compact applies when viewport width <= root data.compactMaxWidth (default 600 logical pixels); portrait applies when height>width, after compact. Set a larger compactMaxWidth only if a supported mobile landscape viewport requires it. Unspecified fields inherit. Keep essential controls readable and inside the target safe area; do not stretch the entire composition indiscriminately.',
          anchor: 'top/middle/bottom-left/center/right. Position is an offset from that anchor on the parent rectangle. The child pivot defaults to the same anchor, not [0,0]; data.anchor {x,y} may override only the child pivot. Example: a 300px-wide button centered in a 390px portrait viewport uses top-center, position [0,y], size [300,h] and renders from x=45; position [-150,y] would clip it. A middle-center panel at position [0,0] is centered; position [-width/2,-height/2] offsets it twice and can clip it.',
          stretch: 'For resizable panels, strips and HUD regions, use paired layout.anchorMin and layout.anchorMax in [0,1] parent coordinates and layout.sizeDelta in logical pixels; omit all three for ordinary fixed-size controls. Equal anchors retain fixed size; separated anchors stretch with the parent. layout.position remains a pivot offset. Keep fixed-size controls where intentional; do not encode the entire screen as one fixed-size panel.',
          textStyle: 'Use style.fontSize, style.color, style.align, style.verticalAlign and style.lineHeight. For an actual font file use data.font.assetRef; do not invent font asset aliases.',
          textFit: 'After loading the actual font file, measure HUD values and labels at their authored font size (including the largest expected score/time/count and each supported language). Size text bounds and spacing to fit those measurements, not character-count estimates. Keep numeric counters intact; do not rely on arbitrary character wrapping, runtime shrinking, or editor-specific layout overrides to hide undersized bounds. Check both the generated UI and target runtime before reporting visual acceptance.',
          image: 'Use assetRef + optional data.member for the image file, data.frame for an exact case-sensitive atlas frame name (without extension). Inspect the delivered atlas; never guess names.',
          nineSlice: 'Use data.image.type=sliced and data.nineSlice.border=[left,right,top,bottom]. data.frame may name an explicit meta.nine_slice composite made from tl,tr,bl,br,h,v,c frames, or a single packed frame. Never invent a panel frame absent from both tables.',
          appearance: 'Use style.opacity, style.background (CSS color or {color,opacity,radius}), style.gradient (color array), style.border ({width,color,radius}), style.cornerRadius. Shape uses style.shape and style.color.',
          paintOrder: { phases: UI_PAINT_PHASES, rule: CONTENT_COORDINATE_CONTRACT.uiPaint },
          example: '960x540 root; top-center title at [0,92] is centered at x=480. A centered 240px progress track with a left-pivot fill uses middle-center + data.anchor={x:0,y:0.5}, position=[-118,70], not middle-left.',
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
          'Content is the editable source of Scene/UI layout, not a placeholder for layout to be recreated in runtime source. Cover each planned screen and authored level through registered documents; shared scenes and procedural behavior configs are valid only when they actually express the intended variations using the declared format. Do not invent an unregistered level-file kind.',
          'This registry accepts Scene, UI and VFX documents only. Shared gameplay tuning or other project-specific data may live in one project-owned JSON file outside content/ and be loaded by the game; do not duplicate shared values in every scene or claim an unsupported content document kind.',
          'Runtime code implements asset loading, data parsing and gameplay behavior in the chosen framework/engine. It consumes node IDs/hierarchy, transforms, text/images, layout, Tilemap cells and bindings from these documents; it does not maintain a second hand-authored copy. Compiled or cached artifacts are derived, not editable authority.',
          'Verify data consumption by changing a relevant source layout/text/image/cell in a temporary copy and checking the target runtime result without editing its layout code. Compare coverage and composition against the design; this format checker only verifies structure/references, not game-design quality or playability.',
          'The shown index, document, data and node keys are the complete allowed keys; omit optional placeholder fields instead of adding alternatives.',
          'Every file path in index.files is relative to content/.',
          'Index documents is the runtime load registry: list every index.files entry exactly once with its canonical id, path, kind and loadPhase. Mark entryScene and only the UI documents needed for the first interactive frame as startup; mark other screens, scenes and VFX on-demand. Fetch startup documents first and fetch on-demand documents only when the game enters or needs them.',
          'Every used assetRef is listed once in the document assetRefs and resolves to a verified Manifest resource.',
          `The index must declare sceneModel "${BEEGAME_SCENE_MODEL}". Every scene node is a GameObject; node.kind is forbidden.`,
          'Use the GameObject/Component structure for both dimensions, with coordinate semantics defined by format.coordinates, not inferred from an engine name. Transform has three components; 2D uses the XY plane and an orthographic Camera. In a 3D scene replace the 2D coordinateSystem example with {origin:"world",units:"meters"}.',
          'Put gameplay identity such as player, enemy, tree, anchor or checkpoint in node.semantic. Put renderer, physics, audio, animation, lighting and camera capabilities in components using exactly format.sceneVocabulary.componentTypes. Every component requires a stable unique id that is independent of array order. An empty GameObject has no renderer. Gameplay behavior metadata belongs in node.data.behaviors as entries with stable id, kind and config; do not add script or MonoBehaviour components.',
          'Every visible object must retain a real renderer: use sprite-renderer for authored 2D graphics, tilemap + tilemap-renderer for grid environments when appropriate (format.tilemap), world-space canvas + canvas-renderer + image/text for solid-color meters and labels, Light2D spot data for a 2D vision cone, and particle-system + particle-system-renderer for particles.',
          'Scene nodes never own assetRef or frameRef directly. Only component types listed in format.sceneVocabulary.assetComponentTypes may own component.assetRef. SpriteRenderer, MeshFilter, SkinnedMeshRenderer and Tilemap require a verified component.assetRef; a textured Image requires one, while an intentionally solid-color Image does not. Select a specific multi-file member in component.data.member.',
          'Use only the declared component vocabulary. Visible shapes require SpriteRenderer with an asset or a Canvas Image graphic, collision requires a concrete 2D or 3D Collider, and Camera serves both dimensions. A 2D Camera must be orthographic and declare coordinateSpace, orthographicSize and viewport; the scene settings coordinateSystem is the single authority for logical-pixels width, height and pixelsPerUnit. Script components and scriptId fields do not belong in scene documents.',
          'ParticleSystem owns simulation modules; ParticleSystemRenderer owns its material/texture and must share the GameObject. MeshRenderer requires MeshFilter. TilemapRenderer requires Tilemap. Never mix Rigidbody with Rigidbody2D on one GameObject.',
          'Put scene-wide world, camera and layer settings in scene data.settings or on a camera component/node. Do not encode settings as a world-config node.',
          'UI node role is a closed vocabulary: use exactly one value from format.uiVocabulary.roles. Never invent a role from a visual name, business label, control variant or implementation class.',
          'A UI role describes the authored object purpose, not an asset kind. Every node with an assetBackedRole (image, sprite, nineSlicePanel) requires node.assetRef; a nested data.image.assetRef is not a substitute. Other roles must keep node.assetRef absent and place any referenced image or texture in their existing nested data/style reference.',
          'Use the exact root role in format.uiVocabulary.rootByDocumentKind. A ui-flow document contains only its flow-root plus flow-screen children; visual UI belongs in ui-screen or ui-hud documents.',
          'For a multi-file visual resource, set data.member (or the equivalent nested texture/sprite action member) whenever the node needs a file other than the resource root; do not rely on filename guessing.',
          'Visible authored world graphics must use a real renderer plus a verified asset. A scene Image may omit assetRef only when it is an intentionally solid-color Unity UI graphic on a Canvas; encode its color/opacity in data. Collider and trigger components are non-visual. A nine-slice panel that uses an image remains an asset-backed UI node and must reference its verified image resource and member.',
          'A ParticleSystem alone is never considered rendered. Put particle-system-renderer on the same GameObject; give that renderer a verified texture asset when the design calls for textured particles.',
          'Canvas owns a RectTransform; Image/Text require RectTransform and CanvasRenderer and must be descendants of a Canvas. RectTransform data uses anchorMin, anchorMax, anchoredPosition, sizeDelta and pivot with the top-left conventions in format.coordinates.rectTransform, not target-engine defaults.',
          'The optional static PNG preview supports rectangular 2D Tilemaps and their referenced images/atlas frames. It is a diagnostic snapshot, not game rendering or gameplay verification. Do not replace valid Tilemap data with sprites to work around preview limitations.',
        ],
      },
    },
  } as const
  return Object.freeze({
    contract,
  })
}
