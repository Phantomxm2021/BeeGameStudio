import { strictObject, string, unknown } from 'zod/v4'
import { TILEMAP_AUTHORING_CONTRACT } from './tilemap-authoring-contract'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CONTENT_CHECKER_ENTRY, CONTENT_BINDING_ENTRY, MEDIA_PRODUCTION_ENTRY, RESOURCE_PRODUCTION_ENTRY, DRAFT_EDITS_ENTRY, COMPOSE_DRAFT_ENTRY } from './content-checker-runtime'
import { CONTENT_COORDINATE_CONTRACT, UI_ANCHORS, UI_PAINT_PHASES } from '../../../scene-editor/src/content-coordinates'
import { CONTENT_RUNTIME_CONTRACT } from './content-runtime-contract'
import { contentConsumerDistribution } from './game-content-consumer-cli'
import type { BeeGameAssetManifest } from './asset-contracts'
import { PROJECT_GUIDE_TEMPLATE } from './workflow-v3/project-guide'
import {
  BEEGAME_CONTENT_DOCUMENT_SCHEMA,
  BEEGAME_CONTENT_INDEX,
  BEEGAME_CONTENT_PACKAGE_SCHEMA,
  BEEGAME_CONTENT_ROOT,
  BEEGAME_SCENE_ASSET_COMPONENT_TYPES,
  BEEGAME_SCENE_COMPONENT_TYPES,
  CONTENT_RESOURCE_LOCATOR_KEYS,
  BEEGAME_SCENE_MODEL,
  BEEGAME_UI_ASSET_BACKED_ROLES,
  BEEGAME_UI_NODE_ROLES,
} from './game-content-package'

const digest = string().regex(/^[a-f0-9]{64}$/)

export const CONTENT_AUTHORING_CONTRACT_PATH = '.beegame/delivery/content-contract.json'
export const CONTENT_FORMAT_PATH = '.beegame/delivery/content-format.json'
export const CONTENT_CHECKER_PATH = '.beegame/delivery/check-content.mjs'
export const CONTENT_CONSUMER_PATH = '.beegame/delivery/content-consumer.mjs'
export const DESIGN_INSPECTOR_PATH = '.beegame/delivery/inspect-design.mjs'

/** Refresh this BGS-owned entry on resumed turns as well as new authoring. */
export async function materializeContentCheckerEntry(workspacePath: string) {
  await mkdir(dirname(join(workspacePath, CONTENT_CHECKER_PATH)), { recursive: true })
  await writeFile(join(workspacePath, CONTENT_CHECKER_PATH), CONTENT_CHECKER_ENTRY, 'utf8')
  await writeFile(join(workspacePath, '.beegame/delivery/bind-content.mjs'), CONTENT_BINDING_ENTRY, 'utf8')
  await writeFile(join(workspacePath, '.beegame/delivery/media.mjs'), MEDIA_PRODUCTION_ENTRY, 'utf8')
  await writeFile(join(workspacePath, '.beegame/delivery/resources.mjs'), RESOURCE_PRODUCTION_ENTRY, 'utf8')
  await writeFile(join(workspacePath, '.beegame/delivery/edit-drafts.mjs'), DRAFT_EDITS_ENTRY, 'utf8')
  await writeFile(join(workspacePath, '.beegame/delivery/compose-drafts.mjs'), COMPOSE_DRAFT_ENTRY, 'utf8')
}

/** Layout checks consume content authored from selected designs and resources. */
export const DESIGN_CALCULATION_INSTRUCTION = `During document authoring, define gameplay, UI actions/navigation and spatial requirements in prose/sketches; do not create content/ui or content/scenes JSON yet. First produce or select actual complete-screen UI and Scene/prop visual designs, save and Read the pictures; report selected paths with the existing implementation progress. Obtain and inspect the resources needed by the content being authored; unrelated planned resources need not block it. Then author ui-screen/ui-hud files in content/ui and scene-2d/scene-3d files in content/scenes, with actual resource, action and state bindings. Preserve selected composition and gameplay space using layout relationships and actual asset metrics, not screenshot-traced coordinates. Register actual sources in content/index.json. Preserve existing owner-document links; design documents need not be rewritten to enumerate each later file. Use CheckUiLayouts for saved UI geometry; detailsFor also reads the selected file’s authored nodes (text, style, actions and bindings) once alongside its coordinates. Use CheckSceneLayouts for saved Scene structure/static 2D Camera-reference geometry; actual UI game-view framing uses CheckUiLayouts with layoutCamera. Native Edit changes the same sources before rechecking. Standalone CLI checks remain available through the supplied check-content entry. Then use CheckResourcesAndBindings for actual registered files and saved UI/Scene resource references; detailsFor expands current binding operands without narrowing checks. Runtime action/state wiring remains unverified. Existing package checks remain available. Reconcile the technical interfaces for this content before consuming it; later content can remain planned. Record normal delivered-file facts in the Manifest and existing progress record, without reopening locked design documents. Reuse the same files for corrections. These read-only checks do not establish visual quality, complete state coverage, font fit, traversal, interaction or XR comfort.`

/** Existing geometry tools remain available without prescribing early JSON. */
export const SPATIAL_CALCULATION_INSTRUCTION = `Spatial calculation entry (run from the project root): bun ${CONTENT_CHECKER_PATH} --help describes commands and return shapes; ${CONTENT_FORMAT_PATH} describes fields. For new work, use these tools after actual visual design selection and corresponding resource preparation, when authoring UI/Scene JSON. Existing saved content can be inspected or repaired in place. --layout-draft workspace-relative-file width height inspects an existing UI or 2D Scene source without a content index; --camera-draft inspects Camera framing; registered content uses --layout content-relative-file width height. The word draft describes input completeness, not permission to create layout before visual design.
UI_UX_SPEC owns UI relationships; content/index.json registers actual content/ui sources. Include relevant active overlays/expanded states; root data.layoutUnderlay {path,clearance:"preserve"|"allow-cover"} and layoutOcclusion express the designed coexistence policy without copied rectangles. Root data.orientation, referenceResolution, targetViewports and minimumControlSize express confirmed support conditions. Use containers, padding and child constraints. The game-view allocation and root data.layoutCamera {nodeId,path} link to the same authored Scene/Camera; an array supports multiple Scenes. Do not duplicate camera values or offsets. --design-layouts checks declared sizes; --review-layouts additionally checks saved Scene structure and existing owner links; later files need no new prose links. Recheck affected inputs, not unchanged results.
Scene design owns placement, collision and Camera. For fixed 2D visibility requirements, settings.requiredVisibleNodeIds identifies required nodes/groups; inspect them in the UI's resolved game-view. Camera framing alone does not prove Scene visibility. Preserve design decisions when binding resources; actual image dimensions, pivots/cropping, fonts and TileSet bounds inform checks. Missing bounds remain unverified; --draft can defer unavailable TileSet bounds, never certify visibility or waive required resources. Do not invent proxy nodes, drop requirements or duplicate sources to silence errors. For static top-left 2D reference-plane UI, use uiLayoutContract.cameraReferencePlane and the same connected source, not per-device projection tables.
Correct conflicting design/resource inputs in their owning sources within authorization. Inspect complete rendered Scene/UI, text and interaction in the actual runtime. Geometry is not visual acceptance, gameplay occlusion, 3D visibility or XR comfort; report unmeasured properties honestly. These commands do not produce resources or implement the game.`

const inputSchema = strictObject({
    documentRevision: digest,
    assetManifestRevision: digest,
    manifest: unknown(),
  })

export type SceneUiContentAuthoringInput = Readonly<{
  documentRevision: string
  assetManifestRevision: string
  manifest: BeeGameAssetManifest
}>

/** Design-time format is not the later project-specific authority snapshot. */
export async function materializeSceneUiFormat(workspacePath: string) {
  const format = structuredClone(sceneUiContentFormat()) as Record<string, any>
  format.layoutDraftInspectionCommand = `bun ${CONTENT_CHECKER_PATH} --layout-draft workspace-relative-file width height`
  format.sceneLayoutBatchInspectionCommand = `bun ${CONTENT_CHECKER_PATH} --scene-layouts --report`
  format.designLayoutInspectionCommand = `bun ${CONTENT_CHECKER_PATH} --design-layouts --report`
  format.designLayoutDraftInspectionCommand = `bun ${CONTENT_CHECKER_PATH} --design-layouts --draft --report`
  format.reviewLayoutInspectionCommand = `bun ${CONTENT_CHECKER_PATH} --review-layouts --report`
  format.cameraDraftInspectionCommand = `bun ${CONTENT_CHECKER_PATH} --camera-draft workspace-relative-camera-file width height`
  format.layoutCameraInspectionCommand = `bun ${CONTENT_CHECKER_PATH} --layout-draft workspace-relative-ui-file host-width host-height --game-view node-id --camera workspace-relative-camera-file`
  await mkdir(dirname(join(workspacePath, CONTENT_FORMAT_PATH)), { recursive: true })
  await writeFile(join(workspacePath, CONTENT_FORMAT_PATH), JSON.stringify(format, null, 2) + '\n')
  // Design geometry tool; no Manifest/index prerequisite or additional Agent turn.
  await materializeContentCheckerEntry(workspacePath)
  for (const [name, body] of Object.entries(await contentConsumerDistribution()))
    await writeFile(join(workspacePath, dirname(CONTENT_CONSUMER_PATH), name), body, 'utf8')
  await writeFile(join(workspacePath, DESIGN_INSPECTOR_PATH), await readFile(new URL('./design-browser-inspection.mjs', import.meta.url)), 'utf8')
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
    inspectionCommand: 'bun .beegame/delivery/bind-content.mjs --inspect content/ui/FILE.json content/scenes/FILE.json',
    layoutInspectionCommand: `bun ${CONTENT_CHECKER_PATH} --design-layouts --report`,
    revisionUsage: 'New indexes need no revision hashes. Supplied legacy tags remain compatibility metadata, not design or runtime approval.',
  }
  await materializeSceneUiFormat(workspacePath)
  // Project-specific revision inputs are not another copy of the format reference.
  // Keep the existing index example/digests, with all supported fields in one file.
  await writeFile(target, JSON.stringify({ index: task.contract.output.format.index,
    formatReference: CONTENT_FORMAT_PATH, inputs }, null, 2) + '\n')
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
  const format = sceneUiContentFormat()
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
      format: { ...format, index: { ...format.index,
        documentRevision: parsed.documentRevision, assetManifestRevision: parsed.assetManifestRevision } },
    },
  } as const
  return Object.freeze({ contract })
}

/** Public, executable author inputs. The UI/index pair is a complete resource-
 * free package; the Scene is an unbound draft, not delivered artwork. */
export const CONTENT_DRAFT_EXAMPLES = {
  index: { schema: 'beegame-content-package.v2', id: 'interface', dimension: '2d',
    entryScene: 'menu', files: ['ui/menu.json'], documents: [
      { id: 'menu', kind: 'ui-screen', path: 'ui/menu.json', loadPhase: 'startup' },
    ] },
  ui: { schema: 'beegame-content.v1', id: 'menu', kind: 'ui-screen', assetRefs: [], data: {
    rootId: 'root', nodes: [
      { id: 'root', role: 'screen-root', data: { orientation: 'Landscape', referenceResolution: [960, 540],
        targetViewports: [[960, 540]], minimumControlSize: [44, 44] },
        layout: { container: { direction: 'column', align: 'center', justify: 'center', gap: 16 } } },
      { id: 'play', role: 'button', parentId: 'root', text: 'Play', actions: { click: 'play' }, layout: { size: [160, 48] } },
    ],
  } },
  camera: { orthographic: true, orthographicSize: 2.7, pixelsPerUnit: 100,
    viewport: { width: 960, height: 540 }, framing: 'expand' },
  scene: { schema: 'beegame-content.v1', id: 'world', kind: 'scene-2d', assetRefs: [], data: {
    settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 960, height: 540, pixelsPerUnit: 100 },
      requiredVisibleNodeIds: ['shape'] }, cameraNodeId: 'camera', nodes: [
      { id: 'camera', transform: { position: [480, 270, 0] }, components: [{ id: 'camera-component', type: 'camera',
        data: { orthographic: true, orthographicSize: 2.7, coordinateSpace: 'logical-pixels',
          viewport: { width: 960, height: 540 }, framing: 'expand' } }] },
      { id: 'shape', transform: { position: [480, 270, 0] }, components: [
        { id: 'shape-sprite', type: 'sprite-renderer', data: { size: [100, 100] } },
        { id: 'shape-collider', type: 'box-collider-2d', data: { size: [100, 100], offset: [0, 0], isTrigger: false } },
      ] },
    ],
  } },
}

/** Pure schema/reference, never a project version or authoring authority. */
export function sceneUiContentFormat() {
  return {
        projectGuide: PROJECT_GUIDE_TEMPLATE,
        strict: true,
        coordinates: CONTENT_COORDINATE_CONTRACT,
        runtimeConsumption: CONTENT_RUNTIME_CONTRACT,
        tilemap: TILEMAP_AUTHORING_CONTRACT,
        examples: CONTENT_DRAFT_EXAMPLES,
        index: {
          schema: BEEGAME_CONTENT_PACKAGE_SCHEMA,
          id: '<stable-package-id>',
          dimension: '<2d|3d>',
          entryScene: '<startup scene, ui-screen or ui-hud document id>',
          sceneModel: BEEGAME_SCENE_MODEL,
          files: ['scenes/<name>.json', 'ui/<name>.json', 'vfx/<name>.json'],
          documents: [
            { id: '<scene-document-id>', path: 'scenes/<name>.json', kind: 'scene-2d', loadPhase: 'startup' },
            { id: '<initial-screen-id>', path: 'ui/<name>.json', kind: 'ui-screen', loadPhase: 'startup' },
            { id: '<other-document-id>', path: 'vfx/<name>.json', kind: 'vfx', loadPhase: 'on-demand' },
          ],
        },
        revisionFields: 'New indexes omit documentRevision and assetManifestRevision; no metadata calculation/copy step is needed. Existing SHA-256 tags remain readable for legacy callers, but --current and measurement check actual files/resources rather than requiring tag refresh. sceneModel defaults to game-object-v2 when omitted; another supplied value is invalid. entryScene retains its existing name and may select a startup ui-screen/ui-hud for a pure UI project; no empty Scene is required. --format examples returns executable index/UI inputs and an unbound Scene draft, not a design or quality verdict.',
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
          planningBindings: 'New Scene/UI sources use selected actual visual designs and corresponding delivered resources. Existing sources are repaired in place. Known locator fields are ' + CONTENT_RESOURCE_LOCATOR_KEYS.join(', ') + ': component.assetRef and component.data member/atlasMember/frame on asset-consuming components only; Scene Text fonts use data.font.assetRef/member. UI allows node.assetRef on asset-backed roles, their data member/atlasMember/frame, data.font assetRef/member, and locators in data/style image/texture references. Author UI actions/bindings from the interface design alongside resource bindings. Other authored fields, including colors, opacity, typography and unknown data, remain design decisions. Names alone do not exempt nested gameplay data. Bind resources in the same files, validate references and recalculate actual geometry/fonts; bindings do not certify design compliance.',
          viewportAdaptation: 'Scene coordinates and the authored Camera viewport describe a reference frame, not the browser canvas size. At runtime the game applies its documented camera framing choice (for example preserve vertical span, preserve horizontal span or intentional letterbox) against the actual host container; do not resize world transforms or bake a second layout into code. Keep screen UI adaptation separate from world-camera framing. This format does not implement a game engine.',
          componentTypes: BEEGAME_SCENE_COMPONENT_TYPES,
          assetComponentTypes: BEEGAME_SCENE_ASSET_COMPONENT_TYPES,
          tilemapHierarchy: TILEMAP_AUTHORING_CONTRACT.coordinates,
          requiredData: {
            // The ordinary Scene format selection must contain the versioned
            // component shapes it advertises, not require source-code probing.
            grid: TILEMAP_AUTHORING_CONTRACT.examples.grid.data,
            tilemap: TILEMAP_AUTHORING_CONTRACT.examples.tilemap.data,
            'tilemap-renderer': TILEMAP_AUTHORING_CONTRACT.examples.renderer.data,
            camera: {
              orthographic: '<boolean>',
              orthographicSize: '<positive half-height in world units; independent of map/reference size; logical-pixel visible height = 2 * orthographicSize * pixelsPerUnit>',
              fieldOfView: '<number in (0,180) when perspective>',
              coordinateSpace: '<logical-pixels|world-units>',
              viewport: { width: '<positive-number>', height: '<positive-number>' },
              framing: '<keep-height|keep-width|expand|letterbox; omitted means keep-height>',
              nearClip: '<optional positive world-unit depth>',
              farClip: '<optional world-unit depth greater than nearClip>',
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
              { id: '<root-node-id>', role: '<screen-root|hud-root|flow-root, matching document kind>',
                data: { orientation: '<Landscape|Portrait>', referenceResolution: ['<positive-width>', '<positive-height>'],
                  targetViewports: [['<positive-width>', '<positive-height>']], minimumControlSize: ['<positive-width>', '<positive-height>'],
                  compactMaxWidth: '<optional-positive-width>' } },
              {
                id: '<node-id>',
                parentId: '<root-node-id or another existing parent-id>',
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
                  size: ['<optional nonnegative width; 0 is zero, not auto>', '<optional nonnegative height; 0 is zero, not auto>'],
                  rotation: 0,
                  scale: [1, 1],
                  minSize: ['<optional-min-width>', '<optional-min-height>'],
                  maxSize: ['<optional-max-width>', '<optional-max-height>'],
                  container: { direction: '<row|column|grid>', gap: '<optional-logical-pixels>',
                    padding: ['<top>', '<right>', '<bottom>', '<left>'], columns: '<required-positive-integer-for-grid>',
                    wrap: '<optional-boolean>', justify: '<start|center|end|space-between>', align: '<start|center|end|stretch>' },
                  item: { grow: '<optional-nonnegative>', shrink: '<optional-nonnegative>', basis: '<optional-logical-pixels>', absolute: '<optional-boolean>' },
                },
                responsive: {
                  compact: { enabled: true, layout: { size: [160, 48],
                    container: { direction: 'column', padding: [8, 8, 8, 8] } }, style: {} },
                },
                bindings: {},
                actions: {},
                style: {},
                data: {},
              },
            ],
          },
        },
        sceneVisibilityContract: {
          requiredVisibleNodeIds: 'Optional Scene data.settings.requiredVisibleNodeIds is a nonempty unique list of authored node/group IDs for fixed 2D camera views. Groups include enabled visual descendants. Only explicitly required geometry must fit; offscreen optional content is allowed. Inactive, empty or unknown geometry is unverified, never a successful visibility proof. This does not move nodes or choose framing.',
          inspection: 'Scene --layout-draft reports requiredVisibility.status, checkedNodeIds, outside and unavailable. When geometry is known it reports camera-local bounds in world units and supportedAspect {min,max}; min=0 and max=null mean no lower/upper ratio bound, supportedAspect=null means no ratio can fit with this camera/policy. These are Scene-viewport ratios, not necessarily whole-window ratios. Required geometry outside the reference view is not automatically fixed by letterbox.',
          limits: 'Static XY bound containment only; does not verify depth clipping, alpha/occlusion, readability, dynamic camera/movement, gameplay or XR. Omitted requirements are not evidence of complete Scene visibility. Use the existing framing modes and runtime input conversion; never automatically fit every Scene object.',
        },
        uiLayoutContract: {
          model: "Screen UI: parentId hierarchy, Yoga layout geometry, style appearance, actions/bindings behavior. Resolve style aliases, variants and font inheritance before measurement/rendering without rewriting source. Scene uses separate objects/components; UI Toolkit is a reference, not the output format.",
          anchors: UI_ANCHORS,
          referenceResolution: "Root data.referenceResolution=[width,height] in logical pixels; root layout.size, if present, matches it. Screen roots resolve to the actual host viewport; world-space roots retain authored size.",
          orientation: "Root data.orientation=Landscape|Portrait follows confirmed screen direction. Runtime shows a rotation/size message for unsupported hosts. World-space XR UI is not a screen orientation target.",
          minimumControlSize: "Root data.minimumControlSize is the project-agreed positive [width,height] in final host logical pixels, not local layout.minSize. Only represented interactive regions can be measured.",
          layoutCamera: "Root data.layoutCamera={nodeId,path} or an array links this UI game-view node ID to a workspace-relative Camera input or scene-2d source (which supplies cameraNodeId). Check requiredVisibleNodeIds in that allocation. --game-view/--camera selects a variant. Missing TileSet bounds may defer at Review, not resource-bound Content checks. This is inspection linkage, not a second runtime camera.",
          linkedGameViewExample: {
            note: 'Example nodes for a ui-hud data.nodes array with rootId:"root". Replace the path, dimensions and direction with the actual design; this is a link/allocation example, not a complete HUD or font-fit proof.',
            nodes: [
              { id: 'root', role: 'hud-root', data: { orientation: 'Landscape', referenceResolution: [960, 540], targetViewports: [[960, 540]],
                minimumControlSize: [44, 44], layoutCamera: { nodeId: 'game-view', path: 'content/scenes/world.json' } },
                layout: { container: { direction: 'column' } } },
              { id: 'game-view', role: 'container', parentId: 'root', layout: {
                size: [960, 540], item: { grow: 1, shrink: 1 } } },
            ],
          },
          layoutUnderlay: "Root data.layoutUnderlay={path:\"content/ui/<file>.json\",clearance:\"preserve\"|\"allow-cover\"} links a retained UI layer. Links stay in collected content/ui, match orientation and have no cycles. Resolve both sources at overlay targets. preserve checks marked protected regions against marked occluders through the chain; allow-cover permits inherited coverage only, not viewport/local violations. It neither renders layers nor suppresses input; runtime must implement the designed state.",
          targetViewports: "Root data.targetViewports lists positive [width,height] host sizes selected for this composition. Checks combine them with referenceResolution (or root layout.size), with no implicit phone/device size. --design-layouts checks saved geometry; --review-layouts also checks saved Scene structure and existing owner links. New content follows selected visual designs and ready resources; inspection does not authorize earlier production.",
          responsive: "node.responsive.compact and .portrait override enabled/layout/style. compact applies at width <= root data.compactMaxWidth (default 600); portrait at height>width, after compact. Missing fields inherit. An override container still requires direction and grid columns. Choose thresholds from composition needs, not device labels.",
          anchor: "top/middle/bottom-left/center/right; position is an offset from that parent anchor. Child pivot defaults to the same anchor; data.anchor={x,y} overrides only the pivot. A centered panel uses position [0,0]; subtracting half its size offsets it twice.",
          stretch: "Use layout.anchorMin/anchorMax in [0,1] and layout.sizeDelta in logical pixels together, or omit all three. Equal anchors keep fixed size; separated anchors stretch. position is a pivot offset.",
          containers: "layout.container: row, column or equal-width grid with columns; enabled children follow document order. gap/padding [top,right,bottom,left] use logical pixels; justify/align/wrap control allocation. layout.item supports grow, shrink (default 0), basis, absolute:true. Flow owns position/size; do not combine flow children with stretch anchors. minSize/maxSize constrain allocation. Auto text sizing requires actual-font measurement. Scrolling/clipping remain runtime responsibilities.",
          cameraReferencePlane: "A direct game-view child with data.space=\"camera-reference-2d\", layout.size=[Camera.viewport.width,Camera.viewport.height], layout.item.absolute=true projects the static top-left 2D reference plane. Plane center maps to Camera viewport center; orthographic:true and positive pixelsPerUnit are required. Framing includes game-view offset; minima use final transformed edges, not local size. This is not world-space XR or moving/rotated/3D cameras. Rendering, clipping and pointer mapping require runtime support.",
          layoutOcclusion: "data.layoutOcclusion=\"protected\" marks a positive rectangle that must stay in its viewport/Camera and avoid marked \"occluder\" rectangles. Use the owning coordinate space (camera-reference-2d for world reference), enabled ancestors and selected variants. Unmarked overlap is diagnostic, not automatic failure; backgrounds/transparency are not inferred. Markers do not change rendering or prove gameplay visibility. Geometry belongs in layout, not data; data.anchor remains a pivot override.",
          layoutDiagnostics: "outsideViewport, outsideParent, outsideContentArea, outsideCameraView, belowMinimumControlSize and overlapCandidates describe computed geometry. Overlap candidates exclude backgrounds and parent-child composition; interpret them against the design. Minima use transformed edges, not rotated AABBs; flow padding excludes absolute overlays. Boundary probes respect declared orientation but do not guarantee supported sizes. Missing real-font metrics stay unmeasured; ok is not acceptance.",
          containerConsumer: "Optional helpers: initializeUiLayout(), resolveUiNodesForViewport(), inspectUiLayout(). Await initialization for containers; anchors-only layouts are synchronous. Auto text size needs measureText. Native engines may map relationships to native containers; compare actual rectangles. These helpers do not supply a game engine.",
          inspectionResults: "readUiData returns {rootId,nodes}; inspectUiLayout returns computed nodes; inspectUiLayoutInBrowser returns {viewport,nodes,textMeasurements,note}. Computed id,parentId,active,layout,bounds,corners,diagnostics omit authored role/style/text/actions; join by id. bounds/corners use host space; layout uses local space. --details expands geometry. No rendering is implied.",
          textStyle: "style.fontSize/color/align/verticalAlign/lineHeight; fontSize and lineHeight are logical-pixel lengths (DOM lineHeight needs px), not unitless multipliers. Omitted lineHeight uses renderer defaults. Actual fonts use data.font.assetRef.",
          textFit: "Measure legal labels and longest supported counter/language values using delivered fonts and authored sizes. Fit bounds/spacing to measurements; preserve counters rather than arbitrary wrapping, shrinking or Editor-only overrides. Runtime rendering is still required for visual acceptance.",
          browserInspection: "inspectUiLayoutInBrowser(nodes,rootId,viewport,{fontFamily,fontFaces?,textSamples?,camera?}). fontFamily is an explicit candidate callback; fontFaces uses assetRef or JSON.stringify([assetRef,member]) keys for loaded/registered FontFaces. textSamples maps node IDs to legal text. Results distinguish candidate and registered fonts; no source mutation, asset loading, screen rendering, glyph-coverage or aesthetic certification. See consumer.mjs --api for runtime helpers.",
          browserInspectionCommand: "Use the current node preview.mjs --help for supplied runtime observation commands. No legacy inspector or fixed consumer path is implied by this format reference.",
          image: "assetRef plus optional data.member selects the image; data.frame is an exact case-sensitive delivered atlas frame name without extension.",
          nineSlice: "data.image.type=\"sliced\", data.nineSlice.border=[left,right,top,bottom]. data.frame names an existing packed frame or meta.nine_slice composite (tl,tr,bl,br,h,v,c).",
          appearance: "style.opacity, background (CSS color or {color,opacity,radius}), gradient (color array), border ({width,color,radius}), cornerRadius; shapes use style.shape/color.",
          paintOrder: { phases: UI_PAINT_PHASES, rule: CONTENT_COORDINATE_CONTRACT.uiPaint },
          example: "A top-center title at [0,92] in a 960x540 root is centered at x=480. A centered 240px progress track with left-pivot fill uses middle-center, data.anchor={x:0,y:0.5}, position=[-118,70].",
        },
        uiVocabulary: {
          behaviorBindings: {
            schema: 'actions and bindings are string-to-string maps, not objects containing event/payload/conditions. Keep stable node IDs; an action handler receives the action ID and node ID.',
            example: { actions: { click: 'game.start' }, bindings: { text: 'session.label', enabled: 'session.showStart' } },
            enabled: 'enabled controls node/subtree activation and visibility, not a visible button\'s disabled/interactable state. A false enabled binding removes the node from the shared surface. Keep visible-disabled behavior in the project action/control adapter; do not bind canStart/canCharge to enabled when the control must remain visible.',
            sharedSurface: 'The optional createProductionUiSurface supports actions.click and bindings.text/enabled/widthRatio/styleColor. Pass onAction(action,nodeId) and a flat state dictionary keyed by exact binding strings: text accepts strings/numbers, enabled booleans, widthRatio a number 0..1 for fixed layout.size without stretch anchors (also responsive fixed sizes), styleColor a string for text color or non-text backgroundColor. Compose progress bars from existing containers/shapes and widthRatio. Dots are literal keys. Other properties, missing/invalid state and data.visibleWhen fail; expressions, payload, litWhen and enabledWhen are not interpreted.',
            placement: 'When a project binding entry is actually supplied, inspect exact saved node IDs, then use --current mapping.json. The pure format reference does not create that entry. A supplied actions/bindings map replaces the old map; resource data/style merge. Binding does not authorize removing a color, resizing a sprite or redesigning the source.',
          },
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
          "Content is the editable Scene/UI authority. Cover planned screens/levels with registered documents; shared scenes/procedural configs must express their variations. Do not recreate layouts in code or invent unregistered document kinds.",
          "This registry accepts Scene, UI and VFX. Shared gameplay tuning may live in project-owned JSON outside content/; keep one source rather than duplicating it across scenes.",
          "The chosen engine/framework loads assets, consumes authored hierarchy/transforms/layout/text/cells/bindings and implements gameplay. Compiled caches are derived, not editable authority. To verify consumption, change relevant data in a temporary copy and inspect the target result without changing layout code. Structure/reference checks do not prove design coverage, visual agreement or playability.",
          "The shown keys are the allowed keys. Omit optional placeholders rather than invent alternatives. index.files paths are relative to content/.",
          "index.documents lists each index.files entry exactly once with canonical id,path,kind,loadPhase. entryScene and UI needed for the first interactive frame use startup; other documents use on-demand. Load each at its declared phase.",
          "List every used assetRef once in document.assetRefs, resolving to a verified Manifest resource. Text fonts use data.font={assetRef,member?} with nonempty strings. loadProductionResources loads fonts into a resource-keyed map (renderProductionScene2d fifth argument); bound fonts use that face regardless of load order, with no silent fallback. fontFamily applies only without binding.",
          `sceneModel defaults to ${BEEGAME_SCENE_MODEL}. Every scene node is a GameObject; node.kind is forbidden. Transform has three components; 2D uses XY and an orthographic Camera, 3D uses coordinateSystem {origin:"world",units:"meters"}. See coordinates for conventions.`,
          "Gameplay identity belongs in node.semantic; capabilities use sceneVocabulary.componentTypes. Components require stable IDs unique across the scene, independent of array order. Behavior metadata is node.data.behaviors=[{id,kind,config}] with IDs unique within the node. No script/MonoBehaviour components or scriptId fields.",
          "Visible objects require actual renderers: sprite-renderer with an asset, tilemap plus tilemap-renderer for grids, world-space Canvas Image/Text for solid graphics/labels, Light2D spot for vision cones, particle-system plus particle-system-renderer for particles. Empty objects and Colliders/triggers are not graphics; collision uses concrete 2D/3D Colliders.",
          "Scene nodes never own assetRef/frameRef. Only sceneVocabulary.assetComponentTypes may own component.assetRef. SpriteRenderer, MeshFilter, SkinnedMeshRenderer and Tilemap require verified assets; Image may omit one only for intentional solid color on a Canvas (data color/opacity, supported by the renderer). ParticleSystemRenderer requires a texture when designed. Multi-file selection uses component.data.member.",
          "A 2D Camera requires orthographic:true, coordinateSpace, orthographicSize and viewport. coordinateSystem width/height are reference extents, not map bounds or fixed host size; pixelsPerUnit converts units. Camera transform defines the view, orthographicSize its reference half-height, viewport the reference aspect. framing preserves height/width, expands without reference cropping, or letterboxes. World transforms/collisions stay unchanged. Optional resolveSceneCameraView computes projection only; the engine owns dynamic rendering. Static bounds do not prove playability/occlusion. XR uses device projection.",
          "ParticleSystemRenderer shares its GameObject with ParticleSystem; MeshRenderer requires MeshFilter; TilemapRenderer requires Tilemap. Do not mix Rigidbody and Rigidbody2D on one object.",
          "Scene-wide settings belong in data.settings or Camera components/nodes, not a world-config node.",
          "UI roles and roots come from uiVocabulary.roles/rootByDocumentKind. Roles describe purposes, not asset kinds or custom visual names. ui-flow contains flow-root and flow-screen only; visual layouts use ui-screen/ui-hud.",
          "Each assetBackedRole requires node.assetRef; nested data.image.assetRef is not a substitute. Other roles omit node.assetRef, using supported nested data/style references when needed. Multi-file resources use data.member (or equivalent texture/sprite member); never guess filenames or frames.",
          "Scene Canvas owns RectTransform; descendant Image/Text require RectTransform and CanvasRenderer. See coordinates.rectTransform for anchorMin,anchorMax,anchoredPosition,sizeDelta,pivot. Screen UI uses its separate layout tree. Optional renderProductionScene2d supports world-space Canvas Image/Text, not screen-space Canvas or component sorting overrides; paint order is settings.layers then node.zIndex, stable for ties. It is static presentation, not a full engine.",
          "The optional static PNG preview supports rectangular 2D Tilemaps/images/atlas frames. It is a diagnostic, not gameplay verification; do not replace valid Tilemap data with sprites for preview limitations.",
        ],
  } as const
}
