import { readFileSync, realpathSync, statSync } from 'node:fs'
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
import { inspectUiLayout, inspectUiLayoutBoundaries, summarizeUiLayoutInspection } from '../../../scene-editor/src/ui-layout-inspection'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import type { UiViewport } from '../../../scene-editor/src/ui-responsive'

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
export function inspectGameContent(workspacePath: string, path?: string, nodeId?: string, viewport?: UiViewport) {
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
    const nodes = inspectUiLayout(document.data.nodes, document.data.rootId, viewport)
    return { ok: true, scope: 'layout-inspection', runtimeVerified: false, viewport,
      note: 'Resolved geometry only; ok means inspection ran, not that the layout passed. Overlap candidates include sibling text/control boxes, exclude backgrounds and parent-child composition, and may be intentional. Boundary checks probe declared variant transitions, not supported-size guarantees. Text metrics, clipping, occlusion and appearance require visual inspection. No files are changed.',
      diagnostics: summarizeUiLayoutInspection(nodes),
      boundaryChecks: inspectUiLayoutBoundaries(document.data.nodes, document.data.rootId, viewport), nodes }
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

export function runGameContentCommand(workspacePath: string, args: string[] = []) {
  if (args[0] === '--layout-draft' || args[0] === '--camera-draft') {
    const connected = args[0] === '--layout-draft' && args.length === 8 &&
      args[4] === '--game-view' && Boolean(args[5]) && args[6] === '--camera' && Boolean(args[7])
    if ((!connected && args.length !== 4) || !args[1])
      throw new Error(`Usage: ${args[0]} workspace-relative-file width height${args[0] === '--layout-draft' ? ' [--game-view node-id --camera workspace-relative-camera-file]' : ''}`)
    const source = readWorkspaceDraft(workspacePath, args[1])
    const viewport = { width: Number(args[2]), height: Number(args[3]) }
    if (args[0] === '--camera-draft') return {
      ok: true, scope: 'camera-framing-draft-inspection', runtimeVerified: false, viewport,
      note: 'Camera framing only; does not project objects, verify gameplay occlusion or establish XR comfort.',
      view: resolveSceneCameraView(source as SceneCameraInput, viewport),
    }
    const document = parseBeeGameContentDocument(source)
    if (document.kind === 'scene-2d' && !connected) return { ok: true, scope: 'scene-layout-draft-inspection', runtimeVerified: false, viewport,
      ...inspectSceneLayout2d(document.data, viewport) }
    if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud') throw new Error('Layout draft requires a UI screen, HUD or 2D scene')
    const nodes = inspectUiLayout(document.data.nodes, document.data.rootId, viewport)
    const game = connected ? nodes.find(node => node.id === args[5]) : undefined
    if (connected && (!game || !game.active)) throw new Error('Game-view node must exist and be active in the resolved UI layout.')
    const gameView = game ? { nodeId: game.id, bounds: game.bounds,
      viewport: { width: game.bounds.right - game.bounds.left, height: game.bounds.bottom - game.bounds.top } } : undefined
    return { ok: true, scope: 'layout-draft-inspection', runtimeVerified: false, viewport,
      note: 'Geometry only; ok means inspection ran, not that the layout passed. No content index, resources or acceptance are required or changed. Overlap candidates include sibling text/control boxes, exclude backgrounds and parent-child composition, and may be intentional. Boundary checks probe declared variant transitions, not supported-size guarantees. Text metrics remain unmeasured without the actual font.',
      diagnostics: summarizeUiLayoutInspection(nodes),
      boundaryChecks: inspectUiLayoutBoundaries(document.data.nodes, document.data.rootId, viewport),
      nodes,
      ...(gameView ? { gameView,
        cameraView: resolveSceneCameraView(readWorkspaceDraft(workspacePath, args[7]) as SceneCameraInput, gameView.viewport) } : {}) }
  }
  if (args[0] === '--layout') {
    if (args.length !== 4 || !args[1]) throw new Error('Usage: --layout content-relative-file width height')
    return inspectGameContent(workspacePath, args[1], undefined, { width: Number(args[2]), height: Number(args[3]) })
  }
  if (args.length === 1 && args[0] === '--authority') {
    const { manifest: _manifest, ...authority } = projectContentAuthority(workspacePath)
    return { ok: true, scope: 'content-authority', ...authority }
  }
  if (args.length === 0) return validateGameContent(workspacePath)
  if (args[0] !== '--inspect' ||
      !(args.length === 1 || args.length === 2 ||
        (args.length === 4 && args[2] === '--node' && args[3] && !args[1]?.startsWith('--'))))
    throw new Error('Usage: [workspace] [--authority | --inspect [content-relative-file [--node id]] | --layout file width height | --layout-draft file width height [--game-view node-id --camera camera-file] | --camera-draft file width height]')
  return inspectGameContent(workspacePath, args[1], args[3])
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    const workspace = args[0] && !args[0].startsWith('--') ? args.shift()! : process.cwd()
    if (args[0] === '--layout' || args[0] === '--layout-draft') await initializeUiLayout()
    const result = runGameContentCommand(resolve(workspace), args)
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = ('valid' in result ? result.valid : result.ok) ? 0 : 1
  } catch (error) {
    console.log(
      JSON.stringify({
        valid: false,
        issues: [error instanceof Error ? error.message : String(error)],
      }),
    )
    process.exitCode = 1
  }
}
