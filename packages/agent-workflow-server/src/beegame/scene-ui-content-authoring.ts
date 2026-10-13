import { strictObject, string, unknown } from 'zod/v4'
import { TILEMAP_AUTHORING_CONTRACT } from './tilemap-authoring-contract'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CONTENT_CHECKER_ENTRY, CONTENT_BINDING_ENTRY, MEDIA_PRODUCTION_ENTRY, RESOURCE_PRODUCTION_ENTRY, DRAFT_EDITS_ENTRY, COMPOSE_DRAFT_ENTRY } from './content-checker-runtime'
import { CONTENT_COORDINATE_CONTRACT, UI_ANCHORS, UI_PAINT_PHASES } from '../../../scene-editor/src/content-coordinates'
import { CONTENT_RUNTIME_CONTRACT } from './content-runtime-contract'
import { bundleContentConsumer } from './game-content-consumer-cli'
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

/** Begin UI data once; geometry is reviewed before production bindings exist. */
export const DESIGN_CALCULATION_INSTRUCTION = `During document authoring/review, define composition, interaction and spatial requirements in the documents. UI begins linked ui-screen/ui-hud files directly in content/ui; Scene begins linked scene-2d/scene-3d files directly in content/scenes. During UI drafting use bun ${CONTENT_CHECKER_PATH} --design-layouts --draft for saved geometry without unfinished prose/links; only missing TileSet visual bounds defer until resource binding, not a visibility PASS. An actual Scene question can use --layout-draft on its same saved source. After documents are saved, use the supplied host --review-layouts report for owner-linked Scene drafts and UI geometry; rerun with the supplied confirmed direction/dimension when inputs or options change or a result is missing. Do not repeat unchanged checks merely to summarize them. A shared UI may declare multiple {nodeId,path} layoutCamera links; each Scene is checked. Do not replace unavailable required geometry with proxy nodes. The host independently checks them before release. Content completes resources and supported bindings in these same files, not another copy, and checks --design-layouts without --draft. Scene placement, collision geometry, Camera and unknown fields are protected; known resource selectors and UI action bindings may be completed. Missing bindings remain pending; planning does not claim full package/resource completion. No throwaway layout package, partial HTML sample or generated rectangle appendix is required. Retain cited inputs and their assumptions/limits. Content checks actual delivered fonts and complete rendering from saved sources; gameplay and interaction remain target-runtime acceptance. Geometry alone does not establish state coverage, text fit, appearance, traversal or XR comfort.`

/** UI geometry starts in planning; Content completes its resource and behavior bindings. */
export const SPATIAL_CALCULATION_INSTRUCTION = `Spatial calculation entry (run from the project root): \`bun ${CONTENT_CHECKER_PATH} --help\` provides commands, minimal UI/Scene/camera inputs and return shapes. Read relevant fields in ${CONTENT_FORMAT_PATH} when needed; the bundled implementation is not the API reference. Use \`bun ${CONTENT_CHECKER_PATH} --layout-draft workspace-relative-file width height\` for a temporary UI or 2D Scene draft, without a Manifest or content index. Registered content uses \`--layout content-relative-file width height\`. For camera framing, including perspective 3D, use \`--camera-draft workspace-relative-camera-file width height\` on the same command; that file contains the camera's orthographic, orthographicSize or fieldOfView, reference viewport and framing fields.
Reviewed inputs: UI_UX_SPEC owns layout selection and saves linked ui-screen/ui-hud constraints in content/ui. Use the supplied host --review-layouts report at Review; after affected corrections rerun with the confirmed orientation/dimension flags supplied by the task. BGS independently recomputes these inputs before release. Include active geometry-changing overlays/expanded states, not disabled substitutes. If an overlay retains a separate UI layer, root data.layoutUnderlay links {path,clearance:"preserve"|"allow-cover"} to its actual content/ui source. Match the state's prose policy; do not infer coexistence from filenames or copy underlying rectangles. Mark actual protected regions and covering elements with layoutOcclusion. Content completes resource and behavior bindings in these same content/ui files after resource delivery, preserving reviewed identities, hierarchy, geometry and variants; it does not select another composition. Scene design owns world/framing requirements; Tech describes consumption rather than duplicating rectangles. Keep root data.orientation as Landscape or Portrait, referenceResolution, targetViewports (the smallest supported and relevant transition sizes), and minimumControlSize for controls in final host logical pixels. Limit targets to the confirmed direction. Use containers, padding and child constraints for allocation. For connected 2D layouts, root data.layoutCamera {nodeId,path} links the game-view to the authored camera/Scene input; do not copy camera values. Explicit --game-view/--camera options override the link. Run \`bun ${CONTENT_CHECKER_PATH} --design-layouts\` to recompute saved formal inputs at Content completion. These checks establish allocation, control minima and declared clearance, not prose agreement, state coverage, fonts or visual quality. Different state-specific compositions may share inputs when they express the designed differences.
For informational UI tied to the static top-left 2D camera reference plane, keep one world rectangle in the full-host draft using format.uiLayoutContract.cameraReferencePlane; the same connected command projects it together with screen UI. Do not replace the combined input with per-device copied projection rectangles.
For fixed 2D views with complete-visibility requirements, Scene settings.requiredVisibleNodeIds names the nodes or groups that must fit; groups include enabled visual descendants. The Scene inspector reports requiredVisibility as passed, failed or unverified and derives the permitted Scene-viewport aspect interval from actual camera-local geometry. A sample passing size does not guarantee all hosts above a minimum size. Reconcile these limits with the UI's allocated game-view and support conditions; select the appropriate existing framing policy rather than altering geometry to hide clipping. root data.layoutCamera may be one {nodeId,path} link or a nonempty array of these links for multiple levels sharing the same UI. Joint Review and Content check every linked Scene, not only the first. Use --game-view/--camera to inspect one explicit variant. Standalone camera inputs remain supported but cannot prove Scene object visibility.
Before resources exist, use --review-layouts on saved owner-linked drafts. Only unavailable TileSet-dependent visual bounds are returned as deferred (required after binding, before Content release), not a visibility PASS or a design repair. Missing visual sizes, invalid links, offscreen known geometry and control/layout errors still block. Do not replace required-visible nodes with artificial proxy nodes, drop requirements, or duplicate UI files to silence a resource dependency. Content and acceptance checks remain strict and require actual delivered TileSet bounds.
The eight-document author/review milestone defines composition, interaction, legal labels/counter ranges and typography constraints in documents and owner-linked Scene/UI layout sources; it requires no temporary layout package or calculation appendix. Scene retains its authored Camera and spatial rules. For supported 2D framing, UI links that same Scene with layoutCamera and checks requiredVisibleNodeIds in the resolved game-view, not against guessed window dimensions. Content completes the same sources with real resources and checks delivered fonts, image proportions/pivots/cropping and TileSet geometry; implementation/acceptance inspect complete rendered Scene/UI compositions, wrapping, appearance and interaction. An actual resource that invalidates design needs the existing affected-owner revision, not silently reduced requirements. State unmeasured checks honestly instead of treating geometry as visual acceptance.
These read-only commands do not create resources, approve a design or implement the game. Unmeasured text, gameplay occlusion, 3D object visibility and XR comfort are not verified by rectangle or camera-framing calculations. XR device projection is not replaced by flat-window fitting. State those limits instead of treating command success as a quality PASS.`

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
  format.revisionFields = 'documentRevision and assetManifestRevision are required BGS-supplied metadata, not Agent-defined hashes. Their actual values are supplied in content-contract.json when content authoring begins; none are available at design time.'
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
  await writeFile(join(workspacePath, CONTENT_CONSUMER_PATH), await bundleContentConsumer(), 'utf8')
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
    authorityCommand: `bun ${CONTENT_CHECKER_PATH} --authority`,
    inspectionCommand: 'bun .beegame/delivery/bind-content.mjs --inspect content/ui/FILE.json content/scenes/FILE.json',
    layoutInspectionCommand: `bun ${CONTENT_CHECKER_PATH} --design-layouts --report`,
    revisionUsage: 'Copy these BGS-supplied values into content/index.json; they are not hash algorithms to design. If docs/resources change during this turn, --authority reads their current values locally. The checker is read-only and uses the same implementation as BGS.',
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

/** Pure schema/reference, never a project version or authoring authority. */
export function sceneUiContentFormat() {
  return {
        projectGuide: PROJECT_GUIDE_TEMPLATE,
        strict: true,
        coordinates: CONTENT_COORDINATE_CONTRACT,
        runtimeConsumption: CONTENT_RUNTIME_CONTRACT,
        tilemap: TILEMAP_AUTHORING_CONTRACT,
        index: {
          schema: BEEGAME_CONTENT_PACKAGE_SCHEMA,
          documentRevision: '<required compatibility field: first autonomous index uses --package-metadata FILE ... indexMetadata.documentRevision; later --current retains the saved tag. Legacy design baseline uses --authority; do not invent approval>',
          assetManifestRevision: '<required actual Manifest hash: first index uses --package-metadata FILE ... indexMetadata.assetManifestRevision; later --current supplies registry.assetManifestRevision. Legacy --authority remains supported>',
          id: '<stable-package-id>',
          dimension: '<2d|3d>',
          entryScene: '<scene-document-id>',
          sceneModel: BEEGAME_SCENE_MODEL,
          files: ['scenes/<name>.json', 'ui/<name>.json', 'vfx/<name>.json'],
          documents: [
            { id: '<scene-document-id>', path: 'scenes/<name>.json', kind: 'scene-2d', loadPhase: 'startup' },
            { id: '<initial-screen-id>', path: 'ui/<name>.json', kind: 'ui-screen', loadPhase: 'startup' },
            { id: '<other-document-id>', path: 'vfx/<name>.json', kind: 'vfx', loadPhase: 'on-demand' },
          ],
        },
        revisionFields: 'Index revision fields are required metadata. Before a first autonomous index, --package-metadata content/scenes/FILE.json content/ui/FILE.json ... returns indexMetadata derived from those actual saved inputs/Manifest; author still chooses files, entry, dimension and load policy. It writes no files and does not certify design. Legacy --authority reads the eight-document/resource baseline. After saving an autonomous index, --current checks real content/resources while retaining its documentRevision compatibility tag; prose edits do not churn that tag. Measurement still binds source/reports. Draft checks need no index. Do not invent hashes or approval.',
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
          planningBindings: 'Owner-linked Scene drafts use this same schema before resource delivery. Known locator fields are ' + CONTENT_RESOURCE_LOCATOR_KEYS.join(', ') + ': component.assetRef and component.data member/atlasMember/frame on asset-consuming components only. UI allows node.assetRef on asset-backed roles, their data member/atlasMember/frame, data.font assetRef/member, and locators in data/style image/texture references. UI actions/bindings are completed downstream. Other authored fields, including colors, opacity, typography and unknown data, remain design decisions. Names alone do not exempt nested gameplay data. Bind resources in the same files, validate references and recalculate actual geometry/fonts; bindings do not certify design compliance.',
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
          anchors: UI_ANCHORS,
          referenceResolution: 'Root data.referenceResolution is [width, height] in logical pixels: a design reference, not a fixed browser or iframe size. Root layout.size, if present, must match it. Screen-space root resolves to the actual viewport; world-space UI retains its authored root size.',
          orientation: 'Root data.orientation is Landscape or Portrait, matching the confirmed screen-game direction. Other directions and below-minimum hosts show a rotation/size message in the runtime, rather than requiring another HUD composition. VR/AR world UI is not a screen orientation target.',
          minimumControlSize: 'Root data.minimumControlSize is the project-agreed positive [width,height] minimum in final host logical pixels for controls/actions. It is not a global platform constant or local layout.minSize. Declare the actual interactive region as a node/action; an unrepresented larger hitbox in prose is not checked geometry.',
          layoutCamera: 'Root data.layoutCamera links {nodeId,path}, or a nonempty array of these links when multiple Scenes share this UI. nodeId is the game-view node ID in THIS UI, not the Camera node ID in the Scene. Each path is workspace-relative to an existing Camera input or scene-2d document; that Scene supplies its own cameraNodeId. Review/Content check all links and each Scene requiredVisibleNodeIds inside the game-view. For inspecting one variant use explicit --game-view/--camera. This is inspection linkage, not a duplicate runtime camera or renderer. Missing TileSet visual bounds defer only at Review; actual resource-bound Content checks remain required.',
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
          layoutUnderlay: 'For a composition that retains another screen-space UI layer, root data.layoutUnderlay is {path:"content/ui/<actual-file>.json",clearance:"preserve"|"allow-cover"}. Both sources keep their own geometry and are resolved at this overlay\'s authored host targets. preserve checks active protected regions in the retained chain against this layer\'s declared occluders; it requires actual protection/occluder markers. allow-cover explicitly permits covering inherited protection in this state, not exceeding the viewport or a local protected region. This policy must agree with the state-specific prose and Scene requirements; the checker cannot establish that agreement or infer an omitted link. Links must stay in collected content/ui files, have matching orientation and no cycles. Mark retained layers for relevant expanded states instead of copying their coordinates. This link describes composition/inspection, not automatic rendering or input suppression: Content and runtime still consume the actual underlying sources and implement the specified state behavior.',
          targetViewports: 'Root data.targetViewports lists required host [width,height] pairs for this composition, including its smallest supported size and relevant transition sizes; the reference size is included. There are no implicit desktop or phone targets. UI starts these same content/ui files during planning; --design-layouts checks their saved geometry without prose/index/resources, and --review-layouts additionally checks the completed UI document links. Content later completes bindings in place.',
          responsive: 'The base layout is the reference composition. Optional node.responsive.compact and node.responsive.portrait may override enabled, layout fields and style fields; responsive is a node field, not a layout field. A declared override layout.container requires direction (and columns for grid), even if changing only padding or gap. Compact applies when viewport width <= root data.compactMaxWidth (default 600 logical pixels); portrait applies when height>width, after compact. Use variants relevant to the confirmed direction and choose compactMaxWidth from required container space, not device or input labels. Unspecified fields inherit. Keep essential controls readable and inside the target safe area; do not stretch the entire composition indiscriminately.',
          anchor: 'top/middle/bottom-left/center/right. Position is an offset from that anchor on the parent rectangle. The child pivot defaults to the same anchor, not [0,0]; data.anchor {x,y} may override only the child pivot. Example: a 300px-wide button centered in a 390px portrait viewport uses top-center, position [0,y], size [300,h] and renders from x=45; position [-150,y] would clip it. A middle-center panel at position [0,0] is centered; position [-width/2,-height/2] offsets it twice and can clip it.',
          stretch: 'For resizable panels, strips and HUD regions, use paired layout.anchorMin and layout.anchorMax in [0,1] parent coordinates and layout.sizeDelta in logical pixels; omit all three for ordinary fixed-size controls. Equal anchors retain fixed size; separated anchors stretch with the parent. layout.position remains a pivot offset. Keep fixed-size controls where intentional; do not encode the entire screen as one fixed-size panel.',
          containers: 'Optional layout.container allocates enabled children in document order: row, column, or an equal-width grid with columns. gap and padding [top,right,bottom,left] are logical pixels; justify and align describe placement, wrap allows row/column wrapping. Child layout.item supports grow, shrink (default 0: do not silently shrink controls), basis, or absolute:true to opt out as an anchored overlay. Flow owns child position/size; do not combine flow children with stretch anchors. minSize/maxSize constrain allocation. Responsive variants may change container direction/columns. Text auto-sizing requires actual-font measurements; fixed text bounds still need font-fit checks. Unsupported scroll/clipping behavior remains an explicit runtime responsibility, not an automatic layout fallback.',
          cameraReferencePlane: 'For UI attached to the static top-left logical-pixel 2D camera reference frame, add a container directly beneath the connected game-view with data.space:"camera-reference-2d", layout.size:[Camera.viewport.width,Camera.viewport.height] and layout.item.absolute:true. Local size/minSize do not guarantee a host-pixel minimum after projection. The inspector projects geometry for informational and interactive nodes; minimumControlSize is checked on final transformed control edges. This does not implement rendering, clipping or pointer mapping: verify those in the target runtime before claiming interaction support. The camera requires orthographic:true and positive pixelsPerUnit; its span/framing determine projection including game-view offset. The plane center corresponds to the Camera viewport center. This is not space:"world" XR UI or arbitrary moving/rotated/3D Scene cameras.',
          layoutOcclusion: 'Optional data.layoutOcclusion="protected" declares a positive rectangular region that must remain within its viewport/Camera and must not intersect rectangles explicitly marked data.layoutOcclusion="occluder". Represent the region in its owning coordinate space using existing nodes/layout; world-reference regions use the connected camera-reference-2d plane, not copied screen coordinates. Checks use final transformed rectangles, enabled ancestors and selected variants. Use only for actual design clearance requirements; unmarked overlaps remain diagnostic candidates, and backgrounds or transparent pixels are not automatically classified. This is geometric clearance, not pixel-level visibility or gameplay certification; omitted declarations provide no clearance evidence. These markers do not change rendering. Layout fields belong in layout, not data; data.anchor remains the supported x/y pivot override, and unrelated task metadata remains extensible.',
          layoutDiagnostics: 'Inspection returns computed rectangles and diagnostics for outsideViewport, outsideParent, outsideContentArea, projected outsideCameraView, belowMinimumControlSize and overlapCandidates. Overlaps include sibling foreground and projected world/screen intersections, exclude backgrounds and parent-child composition, and require design interpretation. Final control minima use transformed edge lengths, not rotated bounding-box extents. Padding checks apply to flow, not absolute overlays. Boundary probes are limited by root orientation when declared, and are not supported-size guarantees. Text without actual font metrics remains unmeasured. ok means inspection ran, not whole-design acceptance.',
          containerConsumer: 'The optional portable helper exports initializeUiLayout(), resolveUiNodesForViewport() and inspectUiLayout(). Await initializeUiLayout once before using containers, then resolve at actual host dimensions; anchors-only layouts remain synchronous without initialization. Supply measureText for intrinsic auto-sized text. Target engines may instead map the same declared relationships to native layout groups; compare actual rectangles, not just JSON loading. This is optional layout math, not a required game engine.',
          inspectionResults: 'readUiData(document) returns {rootId,nodes}; inspectUiLayout(nodes,rootId,viewport,options?) returns an array of computed nodes; inspectUiLayoutInBrowser returns {viewport,nodes,textMeasurements,note}. Computed nodes expose id,parentId,active,layout,bounds,corners and diagnostics, not authored role/style/text/actions. Associate by id with the original authored nodes to consume content. bounds/corners use host space while layout uses local space; preserve that distinction. CLI output is concise by default; --details includes full geometry. These helpers do not render a scene or UI.',
          textStyle: 'Use style.fontSize, style.color, style.align, style.verticalAlign and style.lineHeight. Explicit fontSize and lineHeight are logical-pixel lengths, not unitless CSS multipliers; convert lineHeight to a CSS px string in DOM renderers. An omitted lineHeight uses the renderer default. For an actual font file use data.font.assetRef; do not invent font asset aliases.',
          textFit: 'After loading the actual font file, measure HUD values and labels at their authored font size (including the largest expected score/time/count and each supported language). Size text bounds and spacing to fit those measurements, not character-count estimates. Keep numeric counters intact; do not rely on arbitrary character wrapping, runtime shrinking, or editor-specific layout overrides to hide undersized bounds. Check both the generated UI and target runtime before reporting visual acceptance.',
          browserInspection: 'The supplied browser helper exports inspectUiLayoutInBrowser(nodes, rootId, viewport, {fontFamily, fontFaces?, textSamples?, camera?}). fontFamily is an explicit candidate-family callback; fontFaces maps assetRef (default font) or JSON.stringify([assetRef, member]) (explicit font member) to loaded FontFaces already registered in document.fonts; the supplied inspector handles registration. textSamples maps text node IDs to legal labels/counter strings, including longest supported values. It returns shared layout diagnostics and textMeasurements with candidate-font or registered-font basis. It does not mutate source text, load resource files, render a screen, prove glyph coverage or approve aesthetics. Render the same final inputs with existing preview tools; preliminary candidate checks do not replace delivered-font and runtime checks.',
          browserInspectionCommand: `Optional legacy entry, only when actually supplied: node ${DESIGN_INSPECTOR_PATH} --help; helper: .beegame/delivery/content-consumer.mjs. The pure format reference does not create these files. This command measures final inputs and optionally captures an existing project-local HTML composition without a game package/server. It does not render a substitute composition or certify aesthetics.`,
          image: 'Use assetRef + optional data.member for the image file, data.frame for an exact case-sensitive atlas frame name (without extension). Inspect the delivered atlas; never guess names.',
          nineSlice: 'Use data.image.type=sliced and data.nineSlice.border=[left,right,top,bottom]. data.frame may name an explicit meta.nine_slice composite made from tl,tr,bl,br,h,v,c frames, or a single packed frame. Never invent a panel frame absent from both tables.',
          appearance: 'Use style.opacity, style.background (CSS color or {color,opacity,radius}), style.gradient (color array), style.border ({width,color,radius}), style.cornerRadius. Shape uses style.shape and style.color.',
          paintOrder: { phases: UI_PAINT_PHASES, rule: CONTENT_COORDINATE_CONTRACT.uiPaint },
          example: '960x540 root; top-center title at [0,92] is centered at x=480. A centered 240px progress track with a left-pivot fill uses middle-center + data.anchor={x:0,y:0.5}, position=[-118,70], not middle-left.',
        },
        uiVocabulary: {
          behaviorBindings: {
            schema: 'actions and bindings are string-to-string maps, not objects containing event/payload/conditions. Keep stable node IDs; an action handler receives the action ID and node ID.',
            example: { actions: { click: 'game.start' }, bindings: { text: 'session.label', enabled: 'session.canStart' } },
            sharedSurface: 'The optional createProductionUiSurface supports actions.click and bindings.text/enabled. Pass onAction(action,nodeId) and a flat state dictionary keyed by the exact binding strings; text values are strings/numbers, enabled values booleans. Dots in a state key are not object traversal. It rejects other properties, absent state and data.visibleWhen; it does not interpret expressions, payload, litWhen or enabledWhen. A custom runtime may implement additional declared semantics, but the shared surface does not.',
            placement: 'When an authority-backed binding entry is actually supplied, use it with mapping.json for exact node IDs (legacy example: bun .beegame/delivery/bind-content.mjs mapping.json). The pure format reference supplies neither that entry nor project authority. A supplied actions/bindings map replaces the old map; resource data/style merge. Binding is not authority to remove a color, resize a sprite or redesign the source.',
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
          'Use only the declared component vocabulary. Visible shapes require SpriteRenderer with an asset or a Canvas Image graphic, collision requires a concrete 2D or 3D Collider, and Camera serves both dimensions. A 2D Camera must be orthographic and declare coordinateSpace, orthographicSize and viewport. coordinateSystem width/height describe the authoring reference, not the map boundary or fixed host size; pixelsPerUnit converts logical pixels to world units. Camera position/rotation determines the view; orthographicSize determines its reference half-height, not map height. Camera viewport describes the reference aspect. framing preserves height, preserves width, expands without cropping the reference view, or intentionally letterboxes. World transforms/collisions stay unchanged. The optional resolveSceneCameraView helper computes projection only; the target engine owns rendering and dynamic camera behavior. inspectSceneLayout2d reports static geometric bounds, not playability or occlusion. XR uses device projection, not this flat-host fitting helper. Script components and scriptId fields do not belong in scene documents.',
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
  } as const
}
