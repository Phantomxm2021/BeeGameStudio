import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { BeeGameAssetManifest } from './asset-contracts'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import { readTileSetResource } from './tilemap-contract'
import { inspectSceneLayout2d } from '../../../scene-editor/src/scene-layout-inspection'
import { resolveSceneCameraView, type SceneCameraInput } from '../../../scene-editor/src/scene-camera'
import { auditBeeGameContentPackage, parseBeeGameContentIndex, type BeeGameContentPackage } from './game-content-package'
import type { BeeGameContentIndex } from './game-content-schema'
import { parseBeeGameContentDocument } from './game-content-schema'
import { projectContentAuthority } from './project-content-authority'
import { inspectUiLayout, inspectUiLayoutBoundaries, summarizeUiLayoutInspection, type UiLayoutInspectionOptions } from '../../../scene-editor/src/ui-layout-inspection'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import { checkDesignLayouts, checkReviewUiLayouts } from './design-layout-check'
import { checkDesignDocumentReferences } from './design-document-references'
import { checkDesignHandoff, DESIGN_HANDOFF_INSTRUCTION } from './design-handoff'
import { AUTHOR_BATCHES } from './project-author'
import { isViewportPair, layoutCameraSource, readUiLayoutCamera } from './ui-layout-audit'
import type { UiResponsiveNode, UiViewport } from '../../../scene-editor/src/ui-responsive'

function inspectUiGeometry(data: { nodes: readonly UiResponsiveNode[]; rootId: string }, viewport: UiViewport, options: UiLayoutInspectionOptions) {
  const nodes = inspectUiLayout(data.nodes, data.rootId, viewport, options)
  const game = options.camera ? nodes.find(node => node.id === options.camera!.nodeId) : undefined
  if (options.camera && (!game || !game.active)) throw new Error('Game-view node must exist and be active in the resolved UI layout.')
  const gameView = game ? { nodeId: game.id, bounds: game.bounds,
    viewport: { width: game.layout!.size![0], height: game.layout!.size![1] } } : undefined
  return { diagnostics: summarizeUiLayoutInspection(nodes),
    boundaryChecks: inspectUiLayoutBoundaries(data.nodes, data.rootId, viewport, options), nodes,
    ...(gameView ? { gameView, cameraView: resolveSceneCameraView(options.camera!.input, gameView.viewport),
      ...(options.camera!.scene ? { sceneInspection: inspectSceneLayout2d(options.camera!.scene, gameView.viewport, options.camera!.tileSet),
        sceneInspectionSpace: 'game-view-local logical pixels; gameView.bounds locates the allocated UI region' } : {}) } : {}) }
}

/** Read-only entry point to the exact host validation used after Content authoring. */
const validationScope = {
  scope: 'content-contract-and-references',
  runtimeVerified: false,
} as const

/** A static estimate of the files implied by staged document dependencies. */
export function summarizeContentLoadFootprint(
  index: BeeGameContentIndex,
  content: BeeGameContentPackage,
  manifest: BeeGameAssetManifest,
  fileSize: (path: string) => number,
) {
  const registry = index.documents
  if (!registry) return undefined
  const contentById = new Map(content.documents.map(document => [document.id, document]))
  const filesFor = (phase: 'startup' | 'on-demand') => {
    const assetIds = new Set<string>()
    for (const entry of registry.filter(document => document.loadPhase === phase))
      for (const assetId of contentById.get(entry.id)?.assetRefs ?? []) assetIds.add(assetId)
    const files = new Set<string>()
    for (const assetId of assetIds) {
      const resource = manifest.resources.find(candidate => candidate.id === assetId)
      for (const path of resource?.file_paths ?? []) files.add(path)
    }
    return { documentCount: registry.filter(document => document.loadPhase === phase).length, assetIds, files }
  }
  const startup = filesFor('startup')
  const onDemand = filesFor('on-demand')
  const deferredFiles = new Set([...onDemand.files].filter(path => !startup.files.has(path)))
  const deferredAssets = new Set([...onDemand.assetIds].filter(id => !startup.assetIds.has(id)))
  const bytes = (files: ReadonlySet<string>) => [...files].reduce((total, path) => total + fileSize(path), 0)
  return {
    basis: 'static manifest-file estimate; deferredOnly excludes startup assets/files; raw bytes, not transfer size or runtime proof',
    startup: { documentCount: startup.documentCount, assetCount: startup.assetIds.size, fileCount: startup.files.size, rawBytes: bytes(startup.files) },
    deferredOnly: { documentCount: onDemand.documentCount, assetCount: deferredAssets.size, fileCount: deferredFiles.size, rawBytes: bytes(deferredFiles) },
  }
}

export function validateGameContent(workspacePath: string) {
  const started = performance.now()
  let authority
  try { authority = projectContentAuthority(workspacePath) }
  catch (error) {
    return { ...validationScope, valid: false,
      issues: [`Current documents or Asset Manifest are unavailable: ${error instanceof Error ? error.message : String(error)}`],
      contentCount: 0, elapsedMs: Math.round(performance.now() - started) }
  }
  const audit = auditBeeGameContentPackage(workspacePath, authority)
  // The host audit diagnoses missing/malformed indexes. Do not replace its
  // error with an unrelated "accepted manifest required" precondition.
  const nativeIndex = audit.valid
    ? parseBeeGameContentIndex(JSON.parse(readFileSync(resolve(workspacePath, 'content/index.json'), 'utf8'))) : undefined
  const loadFootprint = audit.package && nativeIndex?.documents
    ? summarizeContentLoadFootprint(nativeIndex, audit.package, authority.manifest,
      path => statSync(resolve(workspacePath, path)).size)
    : undefined
  return {
    ...validationScope,
    valid: audit.valid,
    issues: audit.issues,
    authority: { documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision },
    contentCount: audit.package?.documents.length ?? 0,
    ...(loadFootprint ? { loadFootprint } : {}),
    elapsedMs: Math.round(performance.now() - started),
  }
}

/** Inspect only the requested content file, preserving authored values verbatim. */
export function inspectGameContent(workspacePath: string, path?: string, nodeId?: string, viewport?: UiViewport, options: UiLayoutInspectionOptions = {}) {
  const workspace = realpathSync(workspacePath)
  const root = realpathSync(resolve(workspace, 'content'))
  const inside = (parent: string, child: string) => {
    const rel = relative(parent, child)
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  }
  if (!inside(workspace, root)) throw new Error('Content directory is outside the project workspace.')
  const read = (file: string) => {
    const absolute = realpathSync(resolve(root, file))
    if (!inside(root, absolute)) throw new Error('Content file is outside the content directory.')
    return JSON.parse(readFileSync(absolute, 'utf8'))
  }
  const index = parseBeeGameContentIndex(read('index.json'))
  if (!path) {
    if (nodeId) throw new Error('A content-relative file path is required for --node.')
    return { ok: true, scope: 'inspection', index }
  }
  if (isAbsolute(path) || !index.files.includes(path))
    throw new Error('Requested file must be registered in content/index.json.')
  const document = read(path)
  if (viewport) {
    if (document.kind === 'scene-2d') {
      const parsed = parseBeeGameContentDocument(document)
      if (parsed.kind !== 'scene-2d') throw new Error('Expected 2D scene')
      const manifest = readBeeGameAssetManifestSync(workspace)
      const cache = new Map<string, ReturnType<typeof readTileSetResource>>()
      return { ok: true, scope: 'scene-layout-inspection', runtimeVerified: false, viewport,
        ...inspectSceneLayout2d(parsed.data, viewport, (id, member) => {
          const key = JSON.stringify([id, member])
          if (!cache.has(key)) cache.set(key, readTileSetResource(workspace, manifest, id, member))
          return cache.get(key)
        }) }
    }
    if (!['ui-screen', 'ui-hud'].includes(document.kind)) throw new Error('--layout requires a UI screen or HUD')
    return { ok: true, scope: 'layout-inspection', runtimeVerified: false, viewport,
      note: 'Resolved geometry only; ok means inspection ran, not that the layout passed. Overlap candidates include sibling foreground boxes and projected world/screen foreground intersections, exclude backgrounds and parent-child composition, and may be intentional. outsideCameraView diagnoses projected reference-plane geometry beyond framing, not runtime clipping/occlusion. Boundary checks probe declared variant transitions, not supported-size guarantees. Text metrics and appearance require visual inspection. No files are changed.',
      ...inspectUiGeometry(document.data, viewport, options.camera ? options : readUiLayoutCamera(workspacePath, document)) }
  }
  const nodes: Record<string, unknown>[] = Array.isArray(document.data?.nodes)
    ? document.data.nodes : []
  if (nodeId) {
    const matches = nodes.filter(node => node?.id === nodeId)
    if (matches.length !== 1) throw new Error(`Expected one node "${nodeId}", found ${matches.length}.`)
    return { ok: true, scope: 'inspection', path, documentId: document.id, node: matches[0] }
  }
  return {
    ok: true, scope: 'inspection', path, documentId: document.id,
    kind: document.kind, assetRefs: document.assetRefs,
    settings: document.data?.settings, rootId: document.data?.rootId,
    nodeCount: nodes.length, nodeIds: nodes.map(node => node?.id),
  }
}

function readWorkspaceDraft(workspacePath: string, path: string) {
  const workspace = realpathSync(workspacePath)
  const file = realpathSync(resolve(workspace, path))
  const rel = relative(workspace, file)
  if (isAbsolute(path) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Layout draft must be inside the project workspace.')
  return JSON.parse(readFileSync(file, 'utf8'))
}

export const CONTENT_CHECK_HELP = `Usage: bun .beegame/delivery/check-content.mjs [workspace] [command] [--details]
  --help                    Commands, minimal inputs and result shapes (no files required)
  --design-references [--author-batch n] [--document NAME.md]
                           Local draft scope allows pending parallel owners; final batch check omits --document
  --design-handoff n        Check critical delivery tables/evidence for author batch n; not semantic acceptance
  --design-handoff-help     Read the small consumer-facing table contract, not a whole-document schema
  --format [section-name ...] List actual format sections or read selected sections together; no index/resources required
                           Example: bun .beegame/delivery/check-content.mjs --format coordinates
  --layout-draft file w h    Inspect workspace-relative UI/Scene draft; no index/resources required
    [--game-view node-id --camera workspace-relative-camera-or-scene.json]
    [--appendix]             Emit Markdown geometry tables for this size and declared targetViewports
                           Save stdout to docs/calc/layout.md; reference it from UI_UX_SPEC
  --camera-draft file w h    Inspect camera framing only
  --design-layouts          Check saved content/ui geometry during drafting/Content; no prose/index/resources required
  --review-layouts          Recompute linked content/ui constraints before Review release; no index/resources required
  --layout file w h          Inspect content-relative registered UI/Scene; requires content/index.json
  --inspect [file [--node id]]  Read registered content or one exact authored node
  --authority               Read current content revision metadata
  (no command)              Validate the content package and references; not runtime acceptance

Minimal UI draft (save as a workspace-relative JSON file):
{"schema":"beegame-content.v1","id":"menu","kind":"ui-screen","assetRefs":[],"data":{"rootId":"root","nodes":[{"id":"root","role":"screen-root","data":{"orientation":"Landscape","referenceResolution":[960,540],"targetViewports":[[960,540]],"minimumControlSize":[44,44]},"layout":{"container":{"direction":"column","align":"center","justify":"center","gap":16}}},{"id":"play","role":"button","parentId":"root","text":"Play","layout":{"size":[160,48]}}]}}
Camera draft: {"orthographic":true,"orthographicSize":2.7,"pixelsPerUnit":100,"viewport":{"width":960,"height":540},"framing":"expand"}
Minimal Scene draft: {"schema":"beegame-content.v1","id":"world","kind":"scene-2d","assetRefs":[],"data":{"settings":{"coordinateSystem":{"pixelsPerUnit":100},"requiredVisibleNodeIds":["shape"]},"cameraNodeId":"camera","nodes":[{"id":"camera","components":[{"id":"cam","type":"camera","data":{"orthographic":true,"orthographicSize":2.7,"viewport":{"width":960,"height":540},"framing":"expand"}}]},{"id":"shape","components":[{"id":"sprite","type":"sprite-renderer","data":{"size":[100,100]}}]}]}}
Commands: --layout-draft menu.json 960 540; --camera-draft camera.json 960 540.
Full fields and Scene component examples: .beegame/delivery/content-format.json.

Results: ok means inspection executed, not that geometry/design passed. UI diagnostics list
outsideViewport, outsideParent, outsideContentArea, outsideCameraView, belowMinimumControlSize,
overlapCandidates and textFit; inspect boundaryChecks too. Connected UI includes gameView
{nodeId,bounds,viewport}, cameraView and sceneInspection.requiredVisibility.
Scene results contain view, requiredVisibility and concise diagnostics for cropped/unknown geometry.
Default output omits full computed nodes; --details includes all computed rectangles and projections.
Computed nodes are diagnostics, NOT authored role/style/text or renderable game objects.
Browser helper inspectUiLayout returns a node array; inspectUiLayoutInBrowser returns
{viewport,nodes,textMeasurements,note}. Match computed id to the original source node for
authored content; bounds are host-space, layout is local. Neither helper renders a screen.
No files are changed. Unmeasured fonts, occlusion, gameplay and visual quality remain unverified.`

/** Diagnose argv boundaries before interpreting an input or platform capability. */
function commandViewport(args: string[]): UiViewport {
  const width = Number(args[2]), height = Number(args[3])
  if (!args[2]?.trim() || !args[3]?.trim() || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('Usage: ' + args[0] + ' file width height. Width and height must be two separate positive numeric arguments; received ' + JSON.stringify(args.slice(2, 4)) +
      '. In shell loops, pass each dimension separately; a space-separated pair is not two arguments.')
  return { width, height }
}

/** Generated design evidence, not another coordinate implementation or Content document. */
export function generateUiLayoutAppendix(workspacePath: string, args: string[]) {
  if (args[0] !== '--layout-draft') throw new Error('--appendix requires --layout-draft')
  const initial = runContentCommand(workspacePath, args)
  if (initial.scope !== 'layout-draft-inspection') throw new Error('--appendix requires a UI screen or HUD')
  const document = parseBeeGameContentDocument(readWorkspaceDraft(workspacePath, args[1]!))
  if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud') throw new Error('Expected UI draft')
  const options = args[6] === '--camera'
    ? { camera: layoutCameraSource(args[5]!, readWorkspaceDraft(workspacePath, args[7]!), workspacePath) }
    : readUiLayoutCamera(workspacePath, document)
  const root = document.data.nodes.find(node => node.id === document.data.rootId)
  const targets = root?.data?.targetViewports
  if (targets !== undefined && (!Array.isArray(targets) || !targets.every(isViewportPair)))
    throw new Error('targetViewports must contain positive [width, height] pairs')
  const sizes = new Map<string, [number, number]>()
  for (const size of [[Number(args[2]), Number(args[3])], ...(targets ?? [])] as [number, number][])
    sizes.set(JSON.stringify(size), size)
  const cell = (value: unknown) => JSON.stringify(value ?? null).replaceAll('|', '&#124;').replaceAll('\n', ' ')
  const sources = [args[1]!, ...(args[6] === '--camera' ? [args[7]!] :
    typeof root?.data?.layoutCamera === 'object' && root.data.layoutCamera !== null &&
    'path' in root.data.layoutCamera ? [String(root.data.layoutCamera.path)] : [])]
  const lines = ['# Calculated UI layout', '',
    'Generated by the shared layout inspector. Local positions/sizes and anchor/pivot are distinct from host-space bounds. No model-derived coordinates.',
    'Geometry samples and declared variant boundary probes only, not all-size, font, visual or runtime acceptance. Overlap candidates require design interpretation. Sources below cover the UI and directly linked camera/Scene, not transitive resources.', '',
    ...sources.map(path => {
      readWorkspaceDraft(workspacePath, path)
      const hash = createHash('sha256').update(readFileSync(resolve(workspacePath, path))).digest('hex')
      return `Source: ${cell(path)}; SHA-256: ${hash}`
    }), '']
  for (const [width, height] of sizes.values()) {
    const result = inspectUiGeometry(document.data, { width, height }, options)
    lines.push(`## ${width} × ${height}`, '',
      '| ID | Parent | Active | Local position | Local size | Anchor | Pivot | Host bounds | Text fit |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const node of result.nodes) lines.push('| ' + [
      node.id, node.parentId, node.active, node.layout?.position, node.layout?.size,
      node.layout?.anchor, node.pivot, node.bounds, node.textFit,
    ].map(cell).join(' | ') + ' |')
    lines.push('', 'Diagnostics (inspection ran; this is not a PASS):', '',
      '```json', JSON.stringify({ diagnostics: result.diagnostics, boundaryChecks: result.boundaryChecks,
        ...('gameView' in result ? { gameView: result.gameView, cameraView: result.cameraView,
          sceneInspection: result.sceneInspection } : {}) }, null, 2), '```', '')
  }
  return lines.join('\n')
}

/** CLI presentation only; library/Editor inspection APIs retain their full results. */
export function formatGameContentResult<T>(result: T, details = false) {
  if (details) return result
  if (!result || typeof result !== 'object' || !('scope' in result) ||
      !String(result.scope).includes('layout')) return result
  const compactScene = (scene: Record<string, any>) => {
    const { nodes, ...rest } = scene
    if (!Array.isArray(nodes)) return scene
    return { ...rest, nodeCount: nodes.length, diagnostics: {
      outsideCameraView: nodes.filter(n => n.enabled && n.fullyInside === false).map(n => n.id),
      geometryUnavailable: nodes.filter(n => n.enabled && n.geometryUnavailable)
        .map(n => ({ id: n.id, reason: n.geometryUnavailable })),
    } }
  }
  const { nodes, sceneInspection, ...rest } = result as Record<string, any>
  const compact = 'view' in rest ? compactScene(result as Record<string, any>)
    : { ...rest, ...(Array.isArray(nodes) ? { nodeCount: nodes.length, diagnostics: { ...rest.diagnostics,
      textFit: { unmeasured: nodes.filter(n => n.active && n.textFit === 'unmeasured').map(n => n.id),
        exceedsIntrinsicBounds: nodes.filter(n => n.active && n.textFit === 'exceeds-intrinsic-bounds').map(n => n.id) },
    } } : {}) }
  return { ...compact, ...(sceneInspection ? { sceneInspection: compactScene(sceneInspection) } : {}) }
}

export function runGameContentCommand(workspacePath: string, args: string[] = []) {
  if (args.length === 1 && args[0] === '--design-handoff-help') return { ok: true, scope: 'design-handoff-help', instruction: DESIGN_HANDOFF_INSTRUCTION }
  if (args[0] === '--design-handoff') {
    const batch = Number(args[1]) - 1
    if (args.length !== 2 || !Number.isInteger(batch) || !AUTHOR_BATCHES[batch]) throw new Error('Usage: --design-handoff 1-based-batch-number')
    return { scope: 'design-handoff', runtimeVerified: false,
      ...checkDesignHandoff(workspacePath, [...new Set(AUTHOR_BATCHES.slice(0, batch + 1).flat())], {
        technicalBaseline: batch < AUTHOR_BATCHES.length - 1, nextConsumers: AUTHOR_BATCHES[batch + 1] ?? ['resources'],
      }) }
  }
  if (args.length === 1 && args[0] === '--help') return { ok: true, scope: 'help', help: CONTENT_CHECK_HELP }
  const details = args.at(-1) === '--details'
  return runContentCommand(workspacePath, details ? args.slice(0, -1) : args)
}

function runContentCommand(workspacePath: string, args: string[]) {
  if (args[0] === '--format') {
    const format = readWorkspaceDraft(workspacePath, '.beegame/delivery/content-format.json')
    if (!format || typeof format !== 'object' || Array.isArray(format)) throw new Error('Invalid content format')
    if (args.length === 1) return { ok: true, scope: 'content-format-sections', sections: Object.keys(format) }
    const sections = [...new Set(args.slice(1))]
    for (const section of sections)
      if (!Object.hasOwn(format, section)) throw new Error(`Unknown content format section: ${section}; example: --format coordinates`)
    if (sections.length > 1) return { ok: true, scope: 'content-format-selection',
      values: Object.fromEntries(sections.map(section => [section, (format as Record<string, unknown>)[section]])) }
    return { ok: true, scope: 'content-format-section', section: args[1], value: (format as Record<string, unknown>)[args[1]!] }
  }
  if (args[0] === '--design-references') {
    let batch: number | undefined, document: string | undefined
    for (let i = 1; i < args.length; i += 2) {
      if (args[i] === '--author-batch' && batch === undefined && /^[1-9]\d*$/.test(args[i + 1] ?? '')) batch = Number(args[i + 1]) - 1
      else if (args[i] === '--document' && document === undefined && args[i + 1]) document = args[i + 1]
      else throw new Error('Usage: --design-references [--author-batch 1-based-batch-number] [--document NAME.md]')
    }
    return { scope: 'design-document-references', runtimeVerified: false,
      ...checkDesignDocumentReferences(workspacePath, batch, document) }
  }
  if (args.length === 1 && args[0] === '--review-layouts') return {
    ...checkReviewUiLayouts(workspacePath), runtimeVerified: false, scope: 'review-layout-geometry',
  }
  if (args.length === 1 && args[0] === '--design-layouts') return {
    scope: 'design-layout-geometry', runtimeVerified: false,
    note: 'Recomputes saved UI inputs at reference, target and transition sizes without prose/index/resources. Does not prove complete screen/state coverage, agreement with prose, visual quality or gameplay.',
    ...checkDesignLayouts(workspacePath),
  }
  if (args[0] === '--layout-draft' || args[0] === '--camera-draft') {
    const viewport = commandViewport(args)
    const connected = args[0] === '--layout-draft' && args.length === 8 &&
      args[4] === '--game-view' && Boolean(args[5]) && args[6] === '--camera' && Boolean(args[7])
    if ((!connected && args.length !== 4) || !args[1])
      throw new Error(`Usage: ${args[0]} workspace-relative-file width height${args[0] === '--layout-draft' ? ' [--game-view node-id --camera workspace-relative-camera-file]' : ''}`)
    const source = readWorkspaceDraft(workspacePath, args[1])
    if (args[0] === '--camera-draft') return {
      ok: true, scope: 'camera-framing-draft-inspection', runtimeVerified: false, viewport,
      note: 'Camera framing only; does not project objects, verify gameplay occlusion or establish XR comfort.',
      view: resolveSceneCameraView(source as SceneCameraInput, viewport),
    }
    const document = parseBeeGameContentDocument(source)
    if (document.kind === 'scene-2d' && !connected) return { ok: true, scope: 'scene-layout-draft-inspection', runtimeVerified: false, viewport,
      ...inspectSceneLayout2d(document.data, viewport) }
    if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud') throw new Error('Layout draft requires a UI screen, HUD or 2D scene')
    const options: UiLayoutInspectionOptions = connected ? {
      camera: layoutCameraSource(args[5], readWorkspaceDraft(workspacePath, args[7]), workspacePath),
    } : readUiLayoutCamera(workspacePath, document)
    return { ok: true, scope: 'layout-draft-inspection', runtimeVerified: false, viewport,
      note: 'Geometry only; ok means inspection ran, not that the layout passed. No content index, resources or acceptance are required or changed. Overlap candidates include sibling foreground boxes and projected world/screen foreground intersections, exclude backgrounds and parent-child composition, and may be intentional. outsideCameraView diagnoses projected reference-plane geometry beyond framing, not runtime clipping/occlusion. Boundary checks probe declared variant transitions, not supported-size guarantees. Text metrics remain unmeasured without the actual font.',
      ...inspectUiGeometry(document.data, viewport, options) }
  }
  if (args[0] === '--layout') {
    const viewport = commandViewport(args)
    const connected = args.length === 8 && args[4] === '--game-view' && Boolean(args[5]) && args[6] === '--camera' && Boolean(args[7])
    if ((!connected && args.length !== 4) || !args[1]) throw new Error('Usage: --layout content-relative-file width height [--game-view node-id --camera workspace-relative-camera-file]')
    const options: UiLayoutInspectionOptions = connected ? {
      camera: layoutCameraSource(args[5], readWorkspaceDraft(workspacePath, args[7]), workspacePath),
    } : {}
    return inspectGameContent(workspacePath, args[1], undefined, viewport, options)
  }
  if (args.length === 1 && args[0] === '--authority') {
    const { manifest: _manifest, ...authority } = projectContentAuthority(workspacePath)
    return { ok: true, scope: 'content-authority', ...authority }
  }
  if (args.length === 0) return validateGameContent(workspacePath)
  if (args[0] !== '--inspect' ||
      !(args.length === 1 || args.length === 2 ||
        (args.length === 4 && args[2] === '--node' && args[3] && !args[1]?.startsWith('--'))))
    throw new Error('Usage: [workspace] [--authority | --review-layouts | --design-layouts | --inspect [content-relative-file [--node id]] | --layout file width height | --layout-draft file width height [--game-view node-id --camera camera-file] | --camera-draft file width height]')
  return inspectGameContent(workspacePath, args[1], args[3])
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    const workspace = args[0] && !args[0].startsWith('--') ? args.shift()! : process.cwd()
    if (args[0] === '--layout' || args[0] === '--layout-draft' || args[0] === '--design-layouts' || args[0] === '--review-layouts') await initializeUiLayout()
    if (args.at(-1) === '--appendix') {
      console.log(generateUiLayoutAppendix(resolve(workspace), args.slice(0, -1)))
      process.exit(0)
    }
    const result = runGameContentCommand(resolve(workspace), args)
    console.log('help' in result ? result.help : JSON.stringify(formatGameContentResult(result, args.at(-1) === '--details'), null, 2))
    process.exitCode = ('valid' in result ? result.valid : result.ok) ? 0 : 1
  } catch (error) {
    console.log(JSON.stringify({ valid: false, issues: [error instanceof Error ? error.message : String(error)] }))
    process.exitCode = 1
  }
}
