import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { inspectUiLayout, isUiControl, type UiLayoutInspectionOptions } from '../../../scene-editor/src/ui-layout-inspection'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import { uiViewportVariants } from '../../../scene-editor/src/ui-responsive'
import type { SceneCameraInput } from '../../../scene-editor/src/scene-camera'
import { inspectSceneLayout2d, sceneCameraInput2d } from '../../../scene-editor/src/scene-layout-inspection'
import { parseBeeGameContentDocument, type BeeGameContentDocument } from './game-content-schema'
import { sceneLayoutDraftIssues } from './game-content-package'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import { readTileSetResource } from './tilemap-contract'

export type UiDocument = Extract<BeeGameContentDocument, { kind: 'ui-screen' | 'ui-hud' | 'ui-flow' }>
export type LayoutDiagnostic = { source?: string; owner?: string; scene?: string; node?: string;
  viewport?: [number, number]; kind: string; message: string; closeWhen?: string;
  geometry?: Record<string, unknown> }
export type LayoutMeasurement = { viewport: [number, number]; variants: ReturnType<typeof uiViewportVariants>;
  nodes: ReturnType<typeof inspectUiLayout> }
await initializeUiLayout()

export const isViewportPair = (size: unknown): size is [number, number] => Array.isArray(size) &&
  size.length === 2 && size.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)

export type LayoutConstraints = { platform?: unknown; inputs?: unknown; orientation?: unknown; dimension?: unknown }

/** Same representative device at design and runtime; not an all-device guarantee. */
export function requiredTouchViewport(constraints?: LayoutConstraints): [number, number] | undefined {
  if (constraints?.platform !== 'Web' || !Array.isArray(constraints.inputs) || !constraints.inputs.includes('Touch')) return
  return constraints.orientation === 'Portrait' ? [390, 844] : [844, 390]
}

/** Linking the Scene preserves camera identity and required geometry in one source. */
export function layoutCameraSource(nodeId: string, source: unknown, workspacePath?: string): NonNullable<UiLayoutInspectionOptions['camera']> {
  if (source && typeof source === 'object' && 'kind' in source) {
    const document = parseBeeGameContentDocument(source)
    if (document.kind !== 'scene-2d') throw new Error('Connected Scene geometry requires a 2D Scene')
    const issues = sceneLayoutDraftIssues('Linked Scene', document)
    if (issues.length) throw new Error(issues.join('\n'))
    const cache = new Map<string, ReturnType<typeof readTileSetResource>>()
    const tileSet = workspacePath ? (id: string, member?: string) => {
      if (!existsSync(resolve(workspacePath, 'assets/asset-manifest.json'))) return undefined
      const manifest = readBeeGameAssetManifestSync(workspacePath)
      if (!manifest.resources.some(resource => resource.id === id && resource.status === 'verified')) return undefined
      const key = JSON.stringify([id, member])
      if (!cache.has(key)) cache.set(key, readTileSetResource(workspacePath, manifest, id, member))
      return cache.get(key)
    } : undefined
    return { nodeId, input: sceneCameraInput2d(document.data).input, scene: document.data, tileSet }
  }
  return { nodeId, input: source as SceneCameraInput }
}

/** Only a link to the existing camera input, never a second table of camera values. */
export function readUiLayoutCamera(workspacePath: string, document: Pick<UiDocument, 'data'>): UiLayoutInspectionOptions {
  const variants = readUiLayoutCameras(workspacePath, document)
  if (variants.length > 1) throw new Error('Multiple layoutCamera Scenes: use --review-layouts to check all, or --game-view ID --camera SCENE_PATH to inspect one.')
  return variants[0]!
}

/** A shared UI can present several authored levels. Check each actual Scene,
 * never duplicate the UI or substitute one representative camera for all. */
export function readUiLayoutCameras(workspacePath: string, document: Pick<UiDocument, 'data'>): (UiLayoutInspectionOptions & { scenePath?: string })[] {
  const link = document.data.nodes.find(node => node.id === document.data.rootId)?.data?.layoutCamera
  if (link === undefined) return [{}]
  const links = Array.isArray(link) ? link : [link]
  if (!links.length) throw new Error('root.layoutCamera must contain at least one Scene link')
  const seen = new Set<string>()
  return links.map(link => {
    if (!link || typeof link !== 'object' || Array.isArray(link)) throw new Error('root.layoutCamera must contain nodeId and path')
    const { nodeId, path } = link as Record<string, unknown>
    if (typeof nodeId !== 'string' || !nodeId || typeof path !== 'string' || !path || isAbsolute(path))
      throw new Error('root.layoutCamera must contain nodeId and a workspace-relative path')
    const workspace = realpathSync(workspacePath)
    const file = realpathSync(resolve(workspace, path))
    const rel = relative(workspace, file)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Layout camera is outside the project workspace')
    if (!document.data.nodes.some(node => node.id === nodeId))
      throw new Error('root.data.layoutCamera.nodeId ' + JSON.stringify(nodeId) +
        ' has no matching nodes[].id in this saved UI. Point it to the actual UI viewport node; the Scene camera ID or a node in another file is not a UI viewport ID.')
    const key = JSON.stringify([nodeId, file])
    if (seen.has(key)) throw new Error('Duplicate layoutCamera Scene link')
    seen.add(key)
    return { camera: layoutCameraSource(nodeId, JSON.parse(readFileSync(file, 'utf8')), workspace), scenePath: path }
  })
}

/** Recompute authored targets with the Editor's inspector. No implicit device targets,
 * parallel coordinate implementation, overlap verdict or aesthetic certification. */
export function auditUiInteractiveBounds(document: UiDocument, options: UiLayoutInspectionOptions = {},
  design?: { deferTileSets: boolean; deferred: string[]; diagnostics?: LayoutDiagnostic[]; measurements?: LayoutMeasurement[] }): string[] {
  if (document.kind === 'ui-flow') return []
  const root = document.data.nodes.find(node => node.id === document.data.rootId)
  if (!root) return ['root: UI root is missing.']
  if (root.data?.space === 'world') return []
  const compactMaxWidth = root.data?.compactMaxWidth
  if (compactMaxWidth !== undefined && (typeof compactMaxWidth !== 'number' || !Number.isFinite(compactMaxWidth) || compactMaxWidth <= 0))
    return ['root: compactMaxWidth must be a positive number.']
  const reference = root.data?.referenceResolution ?? root.layout?.size
  const targets = root.data?.targetViewports
  if (targets !== undefined && (!Array.isArray(targets) || !targets.length || !targets.every(isViewportPair)))
    return ['root: targetViewports must contain positive [width, height] pairs.']
  if (reference !== undefined && !isViewportPair(reference)) return ['root: referenceResolution or layout.size must be a positive [width, height] pair.']
  // Legacy content without authored inspection sizes has no implicit device scope.
  // The Content handoff separately requires explicit reference and target sizes.
  const sizes = [...(isViewportPair(reference) ? [reference] : []), ...((targets ?? []) as [number, number][])]
  const unique = [...new Map(sizes.map(size => [size.join('x'), size])).values()]
  const byId = new Map(document.data.nodes.map(node => [node.id, node]))
  const checked = new Set<string>()
  if (options.camera?.scene) checked.add(options.camera.nodeId)
  for (const node of document.data.nodes.filter(isUiControl)) {
    checked.add(node.id)
    let parent = byId.get(node.parentId ?? '')
    const seen = new Set<string>()
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id)
      if (parent.role === 'container') checked.add(parent.id)
      parent = byId.get(parent.parentId ?? '')
    }
  }
  for (const node of document.data.nodes) {
    const parent = byId.get(node.parentId ?? '')
    // Flow containment applies to labels/images as well as controls. Otherwise
    // a non-interactive panel can pass Review with already overflowing children.
    if (node.data?.layoutOcclusion === 'protected' ||
        parent?.layout?.container && !node.layout?.item?.absolute) checked.add(node.id)
  }
  const failures: string[] = []
  for (const [width, height] of unique) {
    let resolved: ReturnType<typeof inspectUiLayout> = []
    const fail = (kind: string, message: string, node?: string, extraGeometry?: Record<string, unknown>) => {
      failures.push(message)
      const actual = resolved.find(item => item.id === node)
      design?.diagnostics?.push({ kind, message, ...(node ? { node } : {}), viewport: [width, height],
        closeWhen: kind === 'flow-overflow' ? 'Keep required content and fit the child inside its allocated parent content bounds.'
          : kind === 'minimum-control-size' ? 'Meet the declared minimum on both transformed control edges without lowering the requirement.'
          : kind === 'occlusion' ? 'Remove the intersection with the declared protected region, preserving the intended composition.'
          : kind === 'scene-visibility' ? 'Fit the required Scene geometry in the actual game-view; unavailable bounds remain unverified.'
          : kind === 'inspection-failed' ? 'Correct the reported input and rerun this same batch.'
          : 'Correct the reported constraint at this viewport and recheck the batch without removing required content.',
        ...(actual ? { geometry: { space: 'host logical pixels', bounds: actual.bounds, corners: actual.corners,
          viewportBounds: { left: 0, top: 0, right: width, bottom: height },
          controlSize: actual.controlSize, minimumControlSize: root.data?.minimumControlSize,
          parent: actual.parentGeometry,
          ...extraGeometry,
          occluders: actual.occludedBy.map(id => { const other = resolved.find(item => item.id === id)!; return { id, corners: other.corners, bounds: other.bounds } }),
        } } : {}),
      })
    }
    try {
      resolved = inspectUiLayout(document.data.nodes, document.data.rootId, { width, height }, options)
      design?.measurements?.push({ viewport: [width, height], variants: uiViewportVariants(root, { width, height }), nodes: resolved })
      const game = options.camera && resolved.find(node => node.id === options.camera!.nodeId)
      if (options.camera && !game?.active)
        throw new Error('Connected game-view ' + JSON.stringify(options.camera.nodeId) +
          ' must exist and be active. Check layoutCamera.nodeId/--game-view against this UI nodes[].id and its parent/responsive visibility.')
      if (options.camera?.scene && game) {
        const inspection = inspectSceneLayout2d(options.camera.scene,
          { width: game.layout!.size![0], height: game.layout!.size![1] }, options.camera.tileSet)
        const required = inspection.requiredVisibility
        if (required && required.status !== 'passed') {
          const message = `${width}x${height} Scene required visibility ${required.status}: ` +
            (required.status === 'failed' ? required.outside : required.unavailable).join(',') + '.'
          const resourceOnly = required.status === 'unverified' && required.unavailable.length > 0 &&
            required.unavailable.every(id => inspection.nodes.find(n => n.id === id)?.geometryUnavailable ===
              'TileSet required; cell size is not the visual tile size')
          if (design?.deferTileSets && resourceOnly) design.deferred.push(message + ' Required after resource binding, before Content release; not a visibility PASS.')
          else fail('scene-visibility', message, game.id, { scene: {
            view: inspection.view, requiredVisibility: required,
            nodes: inspection.nodes.filter(node => [...required.outside, ...required.unavailable].includes(node.id)),
          } })
        }
      }
      for (const node of resolved) {
        if (node.active && node.occludedBy.length)
          fail('occlusion', `${node.id}: ${width}x${height} protected layout region intersects declared occluders: ${node.occludedBy.join(',')}.`, node.id)
        if (!node.active || !checked.has(node.id)) continue
        const prefix = `${node.id}: ${width}x${height}`
        if (node.controlSize?.some(value => value <= 0)) fail('non-positive-bounds', `${prefix} has non-positive bounds.`, node.id)
        if (node.outsideViewport) fail('outside-viewport', `${prefix} control or containing panel is outside the viewport.`, node.id)
        if (node.layoutOcclusion === 'protected' && node.outsideCameraView)
          fail('outside-camera', `${prefix} protected layout region is outside the Camera view.`, node.id)
        const parent = byId.get(node.parentId ?? '')
        if (node.outsideContentArea || (node.outsideParent && parent?.layout?.container && !byId.get(node.id)?.layout?.item?.absolute))
          fail('flow-overflow', `${prefix} exceeds its allocated flow parent or padding.`, node.id)
        if (node.belowMinimumControlSize) fail('minimum-control-size', `${prefix} resolved control size [${node.controlSize!.join(',')}] is below root.minimumControlSize.`, node.id)
      }
    } catch (error) { fail('inspection-failed', `${width}x${height}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return failures
}
