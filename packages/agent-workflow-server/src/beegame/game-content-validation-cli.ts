import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
export { runContentBindingCli } from './content-binding'
export { runDraftEditsCli } from './draft-edits'
export { runComposeDraftCli } from './draft-composition'
import { readDesignSections, reviewSourceSnapshot } from './design-source-reading'
import { sceneUiContentFormat } from './scene-ui-content-authoring'
export { CONTENT_DRAFT_EXAMPLES } from './scene-ui-content-authoring'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { BeeGameAssetManifest } from './asset-contracts'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import { createSceneTileSetResolver, readTileSetResource } from './tilemap-contract'
import { inspectSceneLayout2d, sceneCameraInput2d, sceneWorldTransforms2d } from '../../../scene-editor/src/scene-layout-inspection'
import { resolveSceneCameraView, type SceneCameraInput } from '../../../scene-editor/src/scene-camera'
import { auditBeeGameContentPackage, parseBeeGameContentIndex, contentDraftStructureIssues, type BeeGameContentPackage } from './game-content-package'
import type { BeeGameContentIndex } from './game-content-schema'
import { parseBeeGameContentDocument } from './game-content-schema'
import { projectGuideTemplate } from './workflow-v3/project-guide'
import { inspectUiLayout, inspectUiLayoutBoundaries, summarizeUiLayoutInspection, type UiLayoutInspectionOptions } from '../../../scene-editor/src/ui-layout-inspection'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import { checkDesignLayouts, checkReviewDesignLayouts } from './design-layout-check'
import { checkDesignDocumentReferences } from './design-document-references'
import { formatLayoutReport, formatUiLayoutTable, retainLayoutReport } from './layout-report'
export { formatLayoutReport, formatUiLayoutTable, formatUiLayoutMeasurement, formatSceneLayoutInspection } from './layout-report'
import { isViewportPair, layoutCameraSource, readUiLayoutCamera, type LayoutConstraints } from './ui-layout-audit'
import type { UiResponsiveNode, UiViewport } from '../../../scene-editor/src/ui-responsive'
import { point2d } from '../../../scene-editor/src/content-coordinates'
import { collectContentSourceFiles } from './content-source-files'

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

/** Package checks only; runtime and design quality need separate evidence. */
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
  try {
    // Source/report freshness remains the measurement/export layer's responsibility.
    parseBeeGameContentIndex(readWorkspaceDraft(workspacePath, 'content/index.json'))
    const manifest = readBeeGameAssetManifestSync(workspacePath)
    authority = { manifest }
  }
  catch (error) {
    const missingIndex = (error as NodeJS.ErrnoException).code === 'ENOENT' &&
      (error as NodeJS.ErrnoException).path?.endsWith(`${sep}content${sep}index.json`)
    return { ...validationScope, valid: false,
      issues: [`Saved content/index.json or Asset Manifest are unavailable: ${error instanceof Error ? error.message : String(error)}${missingIndex ? '. Use --format examples for a complete minimal index and Scene/UI inputs; no revision hashes are required.' : ''}`],
      contentCount: 0, elapsedMs: Math.round(performance.now() - started) }
  }
  const audit = auditBeeGameContentPackage(workspacePath, authority)
  const issues = audit.issues
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
    issues,
    designVerified: false,
    note: 'Current registered content and real resources only. Optional legacy revision tags are NOT a verified design baseline and need no manual refresh. Actual source/resource bytes are checked and bound by measurement. No source files are changed. Design agreement, runtime use and quality remain unverified.',
    registry: { assetManifestRevision: createHash('sha256').update(JSON.stringify(authority.manifest)).digest('hex') },
    contentCount: audit.package?.documents.length ?? 0,
    ...(loadFootprint ? { loadFootprint } : {}),
    elapsedMs: Math.round(performance.now() - started),
  }
}

/** First registry metadata from explicit saved operands, not a design release.
 * Reads no prose, writes nothing and chooses neither files nor runtime policy. */
export function currentPackageMetadata(workspacePath: string, paths: string[]) {
  if (!paths.length || paths.some(path => path.startsWith('--')))
    throw Error('Usage: --package-metadata content/scenes/FILE.json content/ui/FILE.json ...; supply the saved content files for the intended index')
  const root = realpathSync(workspacePath), inputs = [], issues: string[] = [], ids = new Set<string>()
  for (const path of [...new Set(paths)].sort()) try {
    if (!/^content\/(ui|scenes|vfx)\/.+\.json$/.test(path) || path.includes('\\') ||
        path.split('/').some(part => !part || part === '.' || part === '..'))
      throw Error('Expected an explicit workspace-relative JSON in content/ui, content/scenes or content/vfx')
    const expected = resolve(root, path)
    if (realpathSync(expected) !== expected) throw Error('Content operands must not follow symlinks')
    const bytes = readFileSync(expected), document = parseBeeGameContentDocument(JSON.parse(bytes.toString('utf8')))
    if (ids.has(document.id)) throw Error('Duplicate document id ' + document.id)
    ids.add(document.id)
    inputs.push({ path, id: document.id, kind: document.kind, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') })
  } catch (error) { issues.push(path + ': ' + (error instanceof Error ? error.message : String(error))) }
  let manifest: BeeGameAssetManifest | undefined
  try { manifest = readBeeGameAssetManifestSync(root) }
  catch (error) { issues.push('Asset Manifest: ' + (error instanceof Error ? error.message : String(error))) }
  return { scope: 'current-package-metadata', workspace: root, contentRoot: resolve(root, 'content'),
    valid: !issues.length, designVerified: false, runtimeVerified: false,
    inputs, issues, ...(!issues.length && manifest ? { indexMetadata: {
      documentRevision: createHash('sha256').update(JSON.stringify(inputs.map(({path,sha256}) => [path,sha256]))).digest('hex'),
      assetManifestRevision: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    } } : {}),
    note: 'Read-only first-index compatibility metadata from the listed saved content bytes and actual Manifest, NOT a design baseline or approval. Author chooses registry/files/entry/load policy. No index or eight documents required; no files created. After saving the index use --current for package/resources and target-runtime checks for actual consumption. This snapshot is not an atomic lock or proof of complete coverage.' }
}

/** Inspect only the requested content file, preserving authored values verbatim. */
export function inspectGameContent(workspacePath: string, path?: string, nodeId?: string, viewport?: UiViewport, options: UiLayoutInspectionOptions = {}) {
  // Both spellings resolve the same registered input, never a public/ copy.
  if (path?.startsWith('content/')) path = path.slice('content/'.length)
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
    throw new Error('Requested file must be registered in content/index.json; use its files entry (for example ui/menu.json), or content/ui/menu.json. No public/content copy is checked.')
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

/** Exact saved values, without a package index or an LLM-generated summary. */
export function inspectContentDraft(workspacePath: string, path: string, selectors: string[] = []) {
  const document = parseBeeGameContentDocument(readWorkspaceDraft(workspacePath, path))
  const nodes = 'nodes' in document.data ? document.data.nodes : undefined
  const selectedNodes = [], fields = []
  for (let i = 0; i < selectors.length; i += 2) {
    const kind = selectors[i], value = selectors[i + 1]
    if (!value || (kind !== '--node' && kind !== '--pointer'))
      throw new Error('Usage: --inspect-draft file [--node id | --pointer /json/pointer] ...')
    if (kind === '--node') {
      const matches = nodes?.filter(node => node.id === value) ?? []
      if (matches.length !== 1) throw new Error(`Expected one node "${value}", found ${matches.length}.`)
      selectedNodes.push(matches[0])
    } else {
      if (!value.startsWith('/') || /~(?![01])/.test(value)) throw new Error('Expected a JSON pointer starting with /; escape ~ as ~0 and / as ~1.')
      let current: unknown = document
      for (const part of value.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        if (!current || typeof current !== 'object' || !Object.hasOwn(current, part))
          throw new Error('Saved draft has no field at ' + value)
        current = (current as Record<string, unknown>)[part]
      }
      fields.push({ pointer: value, value: current })
    }
  }
  return { ok: true, scope: 'draft-source-inspection', runtimeVerified: false, path,
    documentId: document.id, kind: document.kind,
    ...(selectors.length ? { nodes: selectedNodes, fields } : {
      assetRefs: document.assetRefs, nodeCount: nodes?.length ?? 0, nodeIds: nodes?.map(node => node.id) ?? [],
      ...('settings' in document.data ? { settings: document.data.settings } : {}),
      ...('rootId' in document.data ? { rootId: document.data.rootId } : {}),
    }),
    note: 'Selected values are saved source, not a completeness, geometry, resource or gameplay verdict.' }
}

export const CURRENT_CONTENT_CHECK_HELP = `Usage: bun <supplied-check-content-entry> [workspace] [command] [--details]
  (no command), --current   Check saved index/content and real resource references; not design agreement, runtime or quality acceptance
  --package-metadata FILE ... Legacy compatibility hashes only; not needed for new indexes; no writes
  --format [SECTION ...]    List format sections or read selected sections together; projectGuide is optional navigation, not a new design contract
  --format examples         Executable minimal UI/index and an unbound Scene draft; no manual revision hashes
  --check-drafts FILE ...   Check saved draft structure together; resource bindings remain pending
  --inspect-draft FILE [--node ID | --pointer /json/pointer] ... Read exact draft fields together
  --layout-draft FILE W H [--game-view ID --camera FILE] Inspect UI/Scene geometry without an index; --appendix prints UI/HUD coordinate tables
  --camera-draft FILE W H   Inspect a Camera input or the authored Camera in a scene-2d document
  --scene-layouts [W H ...] [--report] Batch saved Scenes at authored viewports, or explicit viewport pairs
  --design-layouts [--draft] [--report] Check saved UI geometry; --draft only defers missing TileSet bounds
  --layout FILE W H [--nodes ID ...] Inspect registered content-relative layout; requires content/index.json; --appendix prints full UI/HUD coordinate tables
  --inspect [FILE [--node ID]] Read registered content
  --scene-point FILE NODE W H Derive saved Scene world/logical-screen coordinates; not rendered pixels
  --read-design JSON        Batch exact sections: [{"document":"GDD.md","sections":["Exact heading"]}]
  --review-sources FILE ... [--details] Batch saved source hashes/headings; --details adds text, not a semantic review
FILE is workspace-relative unless stated otherwise. Use --format for actual fields, not the generated runtime bundle.
--report produces human-readable text and a saved JSON report path; omit it for JSON. --details retains full observations.
--appendix replaces JSON with the existing UI/HUD coordinate tables and diagnostics; use it after FILE W H or the --game-view/--camera pair.
Checks inspect selected saved inputs only. They do not create design records or certify complete gameplay/visual quality.
`

export const CONTENT_CHECK_HELP = CURRENT_CONTENT_CHECK_HELP

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
  const registered = args[0] === '--layout'
  if (!registered && args[0] !== '--layout-draft') throw new Error('--appendix requires --layout or --layout-draft')
  // Validate the registered input through the same entry before reading it;
  // the readable presentation must not bypass the index or path checks.
  const initial = runContentCommand(workspacePath, args)
  if (initial.scope !== 'layout-draft-inspection' && initial.scope !== 'layout-inspection') throw new Error('--appendix requires a UI screen or HUD')
  const sourcePath = registered && !args[1]!.startsWith('content/') ? 'content/' + args[1]! : args[1]!
  const document = parseBeeGameContentDocument(readWorkspaceDraft(workspacePath, sourcePath))
  if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud') throw new Error('Expected UI screen or HUD')
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
  const sources = [sourcePath, ...(args[6] === '--camera' ? [args[7]!] :
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
    lines.push(`## ${width} × ${height}`, '', formatUiLayoutTable(result.nodes))
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

/** Location evidence is a current snapshot, not a filesystem lock or runtime
 * proof. It identifies which root and saved inputs the command targets, so a
 * generator writing a public/ copy cannot masquerade as fixing that input. */
function contentInputLocation(workspacePath: string, args: string[], result: Record<string, any>) {
  const root = realpathSync(workspacePath), paths = new Set<string>()
  for (const file of result.files ?? []) if (typeof file === 'string') paths.add(file)
  const command = args[0]
  if (['--layout-draft', '--camera-draft', '--inspect-draft', '--scene-point'].includes(command ?? '') && args[1]) paths.add(args[1])
  if (command === '--check-drafts') for (const path of args.slice(1)) if (!path.startsWith('--')) paths.add(path)
  if (command === '--layout' || command === '--inspect') {
    paths.add('content/index.json')
    if (args[1]) paths.add(args[1].startsWith('content/') ? args[1] : 'content/' + args[1])
  }
  if (!args.length || command === '--current') {
    paths.add('content/index.json')
    try {
      const index = parseBeeGameContentIndex(JSON.parse(readFileSync(resolve(root, 'content/index.json'), 'utf8')))
      for (const file of index.files) paths.add('content/' + file)
    } catch { /* The package result reports the invalid/missing index. */ }
  }
  for (let i = 0; i < args.length; i++) if (args[i] === '--camera' && args[i + 1]) paths.add(args[i + 1]!)
  const sources: Array<{ path: string; resolvedPath?: string; sha256?: string; bytes?: number; state?: string }> = []
  for (const path of paths) {
    try {
      const target = realpathSync(resolve(root, path)), part = relative(root, target)
      if (isAbsolute(path) || isAbsolute(part) || part === '..' || part.startsWith('..' + sep)) {
        sources.push({ path, state: 'outside-workspace' }); continue
      }
      const raw = readFileSync(target)
      sources.push({ path, resolvedPath: part.split(sep).join('/'), sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length })
      // Include the actual linked Scene/underlay, not just the invoking UI.
      let data: any
      try { data = JSON.parse(raw.toString('utf8')).data } catch { continue }
      const owner = Array.isArray(data?.nodes) ? data.nodes.find((node: any) => node?.id === data.rootId)?.data : undefined
      const cameras = Array.isArray(owner?.layoutCamera) ? owner.layoutCamera : owner?.layoutCamera ? [owner.layoutCamera] : []
      for (const link of [...cameras, ...(owner?.layoutUnderlay ? [owner.layoutUnderlay] : [])])
        if (typeof link?.path === 'string') paths.add(link.path)
    } catch { sources.push({ path, state: 'unavailable' }) }
  }
  return { workspace: root, contentRoot: resolve(root, 'content'), sources,
    basis: 'Current saved source bytes after this command; not an atomic read receipt, resource inventory or runtime verification. public/content is not selected.' }
}

function locatesContentInputs(args: string[]) {
  return !args.length || ['--current', '--scene-layouts', '--design-layouts', '--review-layouts', '--layout', '--inspect',
    '--layout-draft', '--camera-draft', '--inspect-draft', '--check-drafts', '--scene-point'].includes(args[0] ?? '')
}

export function runGameContentCommand(workspacePath: string, args: string[] = [], confirmed?: LayoutConstraints) {
  const result = runGameContentCommandImpl(workspacePath, args, confirmed)
  if (locatesContentInputs(args))
    return { ...result, inputLocation: contentInputLocation(workspacePath, args, result) }
  return result
}

function runGameContentCommandImpl(workspacePath: string, args: string[] = [], hostConstraints?: LayoutConstraints) {
  if (args.length === 1 && args[0] === '--help') return { ok: true, scope: 'help', help: CONTENT_CHECK_HELP }
  const details = args.at(-1) === '--details'
  const parameters = details ? args.slice(0, -1) : [...args]
  const confirmed: LayoutConstraints = { ...hostConstraints }
  if (['--review-layouts', '--design-layouts'].includes(parameters[0] ?? '')) {
    for (const [flag, key, values] of [
      ['--orientation', 'orientation', ['Landscape', 'Portrait']],
      ['--dimension', 'dimension', ['2D', '3D', 'VR', 'AR']],
    ] as const) {
      const at = parameters.indexOf(flag)
      if (at < 0) continue
      const value = parameters[at + 1]
      if (!value || !(values as readonly string[]).includes(value) || parameters.lastIndexOf(flag) !== at)
        throw new Error(`Invalid ${flag}; expected ${values.join('|')}`)
      if (hostConstraints?.[key] !== undefined && hostConstraints[key] !== value)
        throw new Error(`${flag} differs from the confirmed project target`)
      confirmed[key] = value
      parameters.splice(at, 2)
    }
  }
  const selectedAt=parameters.indexOf('--nodes')
  const selected=selectedAt>=0?parameters.splice(selectedAt).slice(1):[]
  if(selectedAt>=0 && (!['--layout','--layout-draft'].includes(parameters[0]??'') || !selected.length ||
    selected.some(id=>id.startsWith('--')) || new Set(selected).size!==selected.length))
    throw Error('Usage: --layout[--draft] file width height [--game-view ID --camera file] --nodes ID ... [--details]')
  const result=runContentCommand(workspacePath, parameters, confirmed, details)
  if(selectedAt<0)return result
  if(!('nodes' in result) || !Array.isArray(result.nodes))throw Error('--nodes needs resolved UI node geometry')
  const missing=selected.filter(id=>!result.nodes.some((node:any)=>node.id===id))
  if(missing.length)throw Error('Unknown layout nodes: '+missing.join(', ')+'. Available IDs: '+result.nodes.map((node:any)=>node.id).join(', '))
  return {...result,selectedGeometry:result.nodes.filter((node:any)=>selected.includes(node.id)).map((node:any)=>({
    id:node.id,parentId:node.parentId,active:node.active,layout:node.layout,pivot:node.pivot,bounds:node.bounds,corners:node.corners,
  })),geometrySpace:'bounds/corners: host logical pixels; layout.position/size: resolved parent-local allocation'}
}

function runContentCommand(workspacePath: string, args: string[], confirmed?: LayoutConstraints, details = false) {
  if (args[0] === '--review-sources') return reviewSourceSnapshot(workspacePath, args.slice(1), details)
  if (args[0] === '--scene-point') {
    if (args.length !== 5 || !args[2] || !isViewportPair([Number(args[3]), Number(args[4])]))
      throw Error('Usage: --scene-point workspace-relative-scene.json NODE WIDTH HEIGHT; positive viewport dimensions required')
    const doc = parseBeeGameContentDocument(readWorkspaceDraft(workspacePath, args[1]!))
    if (doc.kind !== 'scene-2d') throw Error('--scene-point supports Scene 2D only; other targets need their native geometry')
    const issues = contentDraftStructureIssues(args[1]!, doc)
    if (issues.length) throw Error(issues.join('; '))
    const viewport = { width: Number(args[3]), height: Number(args[4]) }
    const inspection = inspectSceneLayout2d(doc.data, viewport)
    const node = inspection.nodes.find(node => node.id === args[2])
    if (!node?.enabled) throw Error('Scene point target is missing or disabled: ' + args[2])
    const worldPoint = sceneWorldTransforms2d(doc.data.nodes).poses.get(args[2]!)!
    const world = point2d(worldPoint, 0, 0), screen = point2d(inspection.worldToScreen, ...world)
    return { scope: 'scene-source-point', runtimeVerified: false, nodeId: args[2], viewport,
      world: { x: world[0], y: world[1] }, screen: { x: screen[0], y: screen[1] }, cameraView: inspection.view,
      note: 'Exact saved node origin in logical viewport pixels, not a screenshot centroid, DOM/page coordinate or hit-test result. Runtime consumption and gameplay remain unverified.' }
  }
  if (args[0] === '--package-metadata') return currentPackageMetadata(workspacePath, args.slice(1))
  if (args[0] === '--scene-layouts') {
    if (args.length % 2 !== 1) throw Error('Usage: --scene-layouts [WIDTH HEIGHT ...]; omit sizes to use each saved Camera viewport.')
    const viewports: { width: number; height: number }[] = []
    for (let i = 1; i < args.length; i += 2) {
      const size = [Number(args[i]), Number(args[i + 1])]
      if (!isViewportPair(size)) throw Error('Scene viewport width and height must be separate positive numeric arguments')
      if (!viewports.some(view => view.width === size[0] && view.height === size[1]))
        viewports.push({ width: size[0], height: size[1] })
    }
    const root = realpathSync(workspacePath), issues: string[] = []
    const files = collectContentSourceFiles(root, ['content/scenes'], issues)
    if (!files.length) issues.push('No saved Scene JSON found in content/scenes')
    const inspections = [], unverified: string[] = [], ids = new Set<string>()
    const tileSet = createSceneTileSetResolver(root)
    const targets: Array<{ source: string; viewports: { width: number; height: number }[] }> = []
    for (const path of files.sort()) try {
      const doc = parseBeeGameContentDocument(readWorkspaceDraft(root, path))
      if (doc.kind !== 'scene-2d' && doc.kind !== 'scene-3d') throw Error('Expected Scene document')
      const structural = contentDraftStructureIssues(path, doc)
      if (structural.length) { issues.push(...structural); continue }
      if (ids.has(doc.id)) throw Error('Duplicate Scene id ' + doc.id)
      ids.add(doc.id)
      if (doc.kind === 'scene-3d') { unverified.push(path + ': 3D/XR framing requires target-runtime observation; structure checked only.'); continue }
      const authored = viewports.length ? undefined : sceneCameraInput2d(doc.data).input.viewport
      if (!viewports.length && !isViewportPair([authored?.width, authored?.height]))
        throw Error('Selected Camera must declare a positive viewport, or supply explicit Scene viewport sizes.')
      const selectedViewports = viewports.length ? viewports : [{ width: authored!.width, height: authored!.height }]
      targets.push({ source: path, viewports: selectedViewports })
      for (const viewport of selectedViewports) {
        const result = inspectSceneLayout2d(doc.data, viewport, tileSet)
        const required = result.requiredVisibility
        if (!required) unverified.push(path + ': no declared required-visible nodes; optional offscreen geometry is not a failure.')
        if (required?.status === 'failed') issues.push(path + ': ' + viewport.width + 'x' + viewport.height + ' required Scene geometry outside Camera: ' + required.outside.join(', '))
        if (required?.status === 'unverified') unverified.push(path + ': required geometry unavailable: ' + required.unavailable.join(', '))
        inspections.push({ source: path, viewport, ...(details ? result :
          formatGameContentResult({ ...result, scope: 'scene-layout-draft-inspection' })) })
      }
    } catch (error) { issues.push(path + ': ' + (error instanceof Error ? error.message : String(error))) }
    return { scope: 'scene-layout-batch', valid: !issues.length, files, issues, inspections,
      coverage: { viewports, targets, basis: viewports.length ? 'explicit-common-viewports' : 'saved-camera-per-scene', unverified }, runtimeVerified: false,
      note: 'Saved Scene structure and explicit draft viewport geometry only. These sizes are not proof of the eventual UI game-view. Joint Review checks actual UI-linked framing. Rules, traversal and solvability remain unverified.' }
  }
  if (args[0] === '--check-drafts') {
    if (args.length < 2 || args.slice(1).some(path => path.startsWith('--'))) throw new Error('Usage: --check-drafts workspace-relative-file ...')
    const files = [...new Set(args.slice(1))], issues: string[] = []
    for (const path of files) try {
      issues.push(...contentDraftStructureIssues(path, parseBeeGameContentDocument(readWorkspaceDraft(workspacePath, path))))
    } catch (error) { issues.push(path + ': ' + (error instanceof Error ? error.message : String(error))) }
    return { scope: 'draft-structure', valid: !issues.length, runtimeVerified: false, files, issues,
      note: 'Saved structure only. Resource delivery, geometry, prose agreement and gameplay remain unverified.' }
  }
  if (args[0] === '--inspect-draft') {
    if (!args[1] || args[1].startsWith('--')) throw new Error('Usage: --inspect-draft workspace-relative-file [--node id | --pointer /json/pointer] ...')
    return inspectContentDraft(workspacePath, args[1], args.slice(2))
  }
  if (args[0] === '--read-design') {
    if (args.length !== 2) throw Error('Usage: --read-design \'[{"document":"GDD.md","sections":["Exact heading"]}]\'')
    return readDesignSections(workspacePath, JSON.parse(args[1]!))
  }
  if (args[0] === '--format') {
    let format: unknown
    try { format = readWorkspaceDraft(workspacePath, '.beegame/delivery/content-format.json') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      format = sceneUiContentFormat()
    }
    if (!format || typeof format !== 'object' || Array.isArray(format)) throw new Error('Invalid content format')
    // The running parser owns canonical shapes; an older saved reference may
    // retain extra command sections, but cannot advertise an obsolete schema.
    const reference: Record<string,unknown>={...format,...sceneUiContentFormat()}
    if (args.length === 1) return { ok: true, scope: 'content-format-sections', sections: Object.keys(reference) }
    const sections = [...new Set(args.slice(1))]
    for (const section of sections)
      if (!Object.hasOwn(reference, section)) throw new Error(`Unknown content format section: ${section}; example: --format coordinates`)
    const navigation=sections.includes('projectGuide')?projectGuideTemplate(workspacePath):undefined
    if(navigation)reference.projectGuide=navigation.value
    if (sections.length > 1) return { ok: true, scope: 'content-format-selection',
      values: Object.fromEntries(sections.map(section => [section, (reference as Record<string, unknown>)[section]])) }
    return { ok: true, scope: 'content-format-section', section: args[1], value: (reference as Record<string, unknown>)[args[1]!],
      ...(navigation?{issues:navigation.facts.issues,verified:navigation.facts.verified}: {}) }
  }
  if (args[0] === '--design-references') {
    let document: string | undefined
    for (let i = 1; i < args.length; i += 2) {
      if (args[i] === '--document' && document === undefined && args[i + 1]) document = args[i + 1]
      else throw new Error('Usage: --design-references [--document NAME.md]')
    }
    return { scope: 'design-document-references', runtimeVerified: false,
      ...checkDesignDocumentReferences(workspacePath, document) }
  }
  if (args.length === 1 && args[0] === '--review-layouts') return {
    ...checkReviewDesignLayouts(workspacePath, confirmed, true, details), runtimeVerified: false, scope: 'review-layout-geometry',
  }
  if (args[0] === '--design-layouts' && (args.length === 1 || args.length === 2 && args[1] === '--draft')) return {
    scope: 'design-layout-geometry', runtimeVerified: false,
    note: 'Recomputes saved UI inputs at reference, target and transition sizes without prose/index/resources. Does not prove complete screen/state coverage, agreement with prose, visual quality or gameplay.',
    ...checkDesignLayouts(workspacePath, confirmed, args[1] === '--draft', details),
    inputs: { confirmed: confirmed ?? {}, deferTileSets: args[1] === '--draft' },
  }
  if (args[0] === '--layout-draft' || args[0] === '--camera-draft') {
    const viewport = commandViewport(args)
    const connected = args[0] === '--layout-draft' && args.length === 8 &&
      args[4] === '--game-view' && Boolean(args[5]) && args[6] === '--camera' && Boolean(args[7])
    if ((!connected && args.length !== 4) || !args[1])
      throw new Error(`Usage: ${args[0]} workspace-relative-file width height${args[0] === '--layout-draft' ? ' [--game-view node-id --camera workspace-relative-camera-file]' : ''}`)
    const source = readWorkspaceDraft(workspacePath, args[1])
    if (args[0] === '--camera-draft') {
      try {
        let camera = source as SceneCameraInput, cameraNodeId: string | undefined
        if (source && typeof source === 'object' && ('kind' in source || 'schema' in source)) {
          const document = parseBeeGameContentDocument(source)
          if (document.kind !== 'scene-2d') throw new Error('Expected a scene-2d document or standalone Camera input')
          const selected = sceneCameraInput2d(document.data)
          camera = selected.input; cameraNodeId = selected.nodeId
        }
        return { ok: true, scope: 'camera-framing-draft-inspection', runtimeVerified: false, viewport,
          ...(cameraNodeId ? { cameraNodeId } : {}),
          note: 'Camera framing only; does not project objects, verify gameplay occlusion or establish XR comfort.',
          view: resolveSceneCameraView(camera, viewport) }
      } catch (error) {
        throw new Error(`${args[1]}: --camera-draft expects a standalone Camera input or a scene-2d document with an active authored Camera: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const document = parseBeeGameContentDocument(source)
    const issues = contentDraftStructureIssues(args[1], document)
    if (issues.length) return { ok: false, valid: false,
      scope: document.kind === 'scene-2d' ? 'scene-layout-draft-inspection' : 'layout-draft-inspection',
      runtimeVerified: false, issues, viewport }
    if (document.kind === 'scene-2d' && !connected) {
      return { ok: true, scope: 'scene-layout-draft-inspection', runtimeVerified: false, viewport,
        ...inspectSceneLayout2d(document.data, viewport) }
    }
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
  if (args.length === 1 && args[0] === '--current') return validateGameContent(workspacePath)
  if (args.length === 0) return validateGameContent(workspacePath)
  if (args[0] !== '--inspect' ||
      !(args.length === 1 || args.length === 2 ||
        (args.length === 4 && args[2] === '--node' && args[3] && !args[1]?.startsWith('--'))))
    throw new Error('Usage: [workspace] [command]; run the supplied entry with --help for its interface. Unknown command or invalid arguments. Inspection accepts --inspect [content-relative-file [--node id]].')
  return inspectGameContent(workspacePath, args[1], args[3])
}

function writeCliOutput(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text + '\n', error => error ? reject(error) : resolve())
  })
}

export async function runGameContentCli(args = process.argv.slice(2), options: { profile?: 'current'; confirmed?: LayoutConstraints } = {}) {
  args = [...args]
  const workspace = resolve(args[0] && !args[0].startsWith('--') ? args.shift()! : process.cwd())
  try {
    if (options.profile === 'current') {
      if (!args.length) args.push('--current')
      if (args.length === 1 && args[0] === '--help') {
        await writeCliOutput(CURRENT_CONTENT_CHECK_HELP); process.exitCode = 0; return
      }
    }
    const report = args.includes('--report')
    if (report) {
      if (!['--design-layouts', '--review-layouts', '--scene-layouts'].includes(args[0] ?? '') || args.filter(arg => arg === '--report').length !== 1)
        throw new Error('--report is supported once for --design-layouts, --review-layouts or --scene-layouts')
      args.splice(args.indexOf('--report'), 1)
    }
    if (args[0] === '--layout' || args[0] === '--layout-draft' || args[0] === '--design-layouts' || args[0] === '--review-layouts') await initializeUiLayout()
    if (args.at(-1) === '--appendix') {
      await writeCliOutput(generateUiLayoutAppendix(resolve(workspace), args.slice(0, -1)))
      process.exitCode = 0
      return
    }
    const result = runGameContentCommand(resolve(workspace), args, options.confirmed)
    if (report && 'scope' in result && result.scope === 'scene-layout-batch' &&
        'inspections' in result && Array.isArray(result.inspections) &&
        typeof result.valid === 'boolean' && Array.isArray(result.issues)) {
      const path = retainLayoutReport(resolve(workspace), result)
      await writeCliOutput([
        formatLayoutReport({ valid: result.valid, issues: result.issues, diagnostics: [], coverage: result.coverage,
          inputLocation: 'inputLocation' in result ? result.inputLocation : undefined }, path),
        ...result.inspections.map((inspection: any) => 'Scene view: ' + JSON.stringify({
          source: inspection.source, viewport: inspection.viewport, requiredVisibility: inspection.requiredVisibility,
        })),
      ].join('\n'))
      process.exitCode = result.valid ? 0 : 1
      return
    }
    if (report && 'diagnostics' in result && Array.isArray(result.diagnostics) && 'valid' in result && 'issues' in result) {
      const path = retainLayoutReport(resolve(workspace), result)
      await writeCliOutput(formatLayoutReport(result as Parameters<typeof formatLayoutReport>[0], path))
      process.exitCode = result.valid ? 0 : 1
      return
    }
    // Selected contracts are machine-readable source, not display paragraphs.
    // Pretty JSON pushed a normal multi-section selection over native output
    // persistence limits, requiring another model Read (and sometimes probes).
    // Detailed layout output can exceed the OS pipe buffer. Await delivery
    // before the CLI completes; console.log can leave a truncated JSON stream.
    await writeCliOutput('help' in result && typeof result.help === 'string' ? result.help : JSON.stringify(formatGameContentResult(result, args.at(-1) === '--details'), null,
      args[0] === '--format' ? undefined : 2))
    process.exitCode = ('valid' in result ? result.valid : result.ok) ? 0 : 1
  } catch (error) {
    let inputLocation: ReturnType<typeof contentInputLocation> | undefined
    if (locatesContentInputs(args)) {
      try { inputLocation = contentInputLocation(workspace, args, {}) } catch { /* Preserve the original error if even the workspace is unavailable. */ }
    }
    await writeCliOutput(JSON.stringify({ valid: false, issues: [error instanceof Error ? error.message : String(error)], inputLocation }))
    process.exitCode = 1
  }
}

export { runMediaProductionCli } from './media-production'
export { runResourceProductionCli } from './resource-production'

if (import.meta.main) await runGameContentCli()
