import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { inspectUiLayout, isUiControl, type UiLayoutInspectionOptions } from '../../../scene-editor/src/ui-layout-inspection'
import { initializeUiLayout } from '../../../scene-editor/src/ui-container-layout'
import type { SceneCameraInput } from '../../../scene-editor/src/scene-camera'
import { inspectSceneLayout2d, sceneCameraInput2d } from '../../../scene-editor/src/scene-layout-inspection'
import { parseBeeGameContentDocument, type BeeGameContentDocument } from './game-content-schema'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import { readTileSetResource } from './tilemap-contract'

export type UiDocument = Extract<BeeGameContentDocument, { kind: 'ui-screen' | 'ui-hud' | 'ui-flow' }>
await initializeUiLayout()

export const isViewportPair = (size: unknown): size is [number, number] => Array.isArray(size) &&
  size.length === 2 && size.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)

/** Linking the Scene preserves camera identity and required geometry in one source. */
export function layoutCameraSource(nodeId: string, source: unknown, workspacePath?: string): NonNullable<UiLayoutInspectionOptions['camera']> {
  if (source && typeof source === 'object' && 'kind' in source) {
    const document = parseBeeGameContentDocument(source)
    if (document.kind !== 'scene-2d') throw new Error('Connected Scene geometry requires a 2D Scene')
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
  const link = document.data.nodes.find(node => node.id === document.data.rootId)?.data?.layoutCamera
  if (link === undefined) return {}
  if (!link || typeof link !== 'object' || Array.isArray(link)) throw new Error('root.layoutCamera must contain nodeId and path')
  const { nodeId, path } = link as Record<string, unknown>
  if (typeof nodeId !== 'string' || !nodeId || typeof path !== 'string' || !path || isAbsolute(path))
    throw new Error('root.layoutCamera must contain nodeId and a workspace-relative path')
  const workspace = realpathSync(workspacePath)
  const file = realpathSync(resolve(workspace, path))
  const rel = relative(workspace, file)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Layout camera is outside the project workspace')
  return { camera: layoutCameraSource(nodeId, JSON.parse(readFileSync(file, 'utf8')), workspace) }
}

/** Recompute authored targets with the Editor's inspector. No implicit device targets,
 * parallel coordinate implementation, overlap verdict or aesthetic certification. */
export function auditUiInteractiveBounds(document: UiDocument, options: UiLayoutInspectionOptions = {}): string[] {
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
  for (const node of document.data.nodes)
    if (node.data?.layoutOcclusion === 'protected') checked.add(node.id)
  const failures: string[] = []
  for (const [width, height] of unique) {
    try {
      const resolved = inspectUiLayout(document.data.nodes, document.data.rootId, { width, height }, options)
      const game = options.camera && resolved.find(node => node.id === options.camera!.nodeId)
      if (options.camera && !game?.active)
        throw new Error('Connected game-view must exist and be active')
      if (options.camera?.scene && game) {
        const required = inspectSceneLayout2d(options.camera.scene,
          { width: game.layout!.size![0], height: game.layout!.size![1] }, options.camera.tileSet).requiredVisibility
        if (required && required.status !== 'passed') failures.push(`${width}x${height} Scene required visibility ${required.status}: ` +
          (required.status === 'failed' ? required.outside : required.unavailable).join(',') + '.')
      }
      for (const node of resolved) {
        if (node.active && node.occludedBy.length)
          failures.push(`${node.id}: ${width}x${height} protected layout region intersects declared occluders: ${node.occludedBy.join(',')}.`)
        if (!node.active || !checked.has(node.id)) continue
        const prefix = `${node.id}: ${width}x${height}`
        if (node.controlSize?.some(value => value <= 0)) failures.push(`${prefix} has non-positive bounds.`)
        if (node.outsideViewport) failures.push(`${prefix} control or containing panel is outside the viewport.`)
        if (node.layoutOcclusion === 'protected' && node.outsideCameraView)
          failures.push(`${prefix} protected layout region is outside the Camera view.`)
        const parent = byId.get(node.parentId ?? '')
        if (node.outsideContentArea || (node.outsideParent && parent?.layout?.container && !byId.get(node.id)?.layout?.item?.absolute))
          failures.push(`${prefix} exceeds its allocated flow parent or padding.`)
        if (node.belowMinimumControlSize) failures.push(`${prefix} resolved control size [${node.controlSize!.join(',')}] is below root.minimumControlSize.`)
      }
    } catch (error) { failures.push(`${width}x${height}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return failures
}
