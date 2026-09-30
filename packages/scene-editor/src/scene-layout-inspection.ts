import { affine2d, compose2d, point2d, rectLayout, type Affine2D } from './content-coordinates'
import { parseGridData, parseTilemapData, tileRect, validateTilemapGrid, type TileSetData } from './tilemap-data'
import { resolveSceneCameraView, type SceneCameraInput, type SceneViewportSize } from './scene-camera'

type Component = { type: string; assetRef?: string; data?: Record<string, unknown> }
export type SceneSpatialNode = { id: string; parentId?: string; enabled?: boolean;
  transform?: { position?: number[]; rotation?: number[]; scale?: number[] }; components?: Component[] }
export type SceneSpatialData = { nodes: readonly SceneSpatialNode[]; cameraNodeId?: string; settings?: Record<string, unknown> }
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
const pair = (value: unknown, fallback: [number, number]): [number, number] => Array.isArray(value) ? value as [number, number] : fallback

/** Shared parent-local geometry. Sprite pivots belong to geometry, not the hierarchy. */
export function sceneWorldTransforms2d(nodes: readonly SceneSpatialNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('Duplicate scene node IDs')
  const poses = new Map<string, Affine2D>(), rects = new Map<string, ReturnType<typeof rectLayout>>()
  const visiting = new Set<string>()
  const resolve = (node: SceneSpatialNode): Affine2D => {
    const cached = poses.get(node.id); if (cached) return cached
    if (visiting.has(node.id)) throw new Error(`Scene hierarchy cycle: ${node.id}`)
    visiting.add(node.id)
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (node.parentId && !parent) throw new Error(`Unknown scene parent: ${node.parentId}`)
    const parentPose = parent ? resolve(parent) : affine2d(0, 0)
    const rect = node.components?.find(c => c.type === 'rect-transform')?.data
    let offset: [number, number] = [0, 0]
    if (rect) {
      const parentRect = parent && rects.get(parent.id)
      const parentData = parent?.components?.find(c => c.type === 'rect-transform')?.data
      const calculated = rectLayout(parentRect?.size ?? [0, 0], pair(parentData?.pivot, [0, 0]),
        pair(rect.anchorMin, [0, 0]), pair(rect.anchorMax, [1, 1]), pair(rect.pivot, [.5, .5]),
        pair(rect.anchoredPosition, [0, 0]), pair(rect.sizeDelta, [0, 0]))
      rects.set(node.id, calculated); offset = calculated.position
    }
    const p = node.transform?.position ?? [0, 0, 0], r = node.transform?.rotation ?? [0, 0, 0], s = node.transform?.scale ?? [1, 1, 1]
    if (![...p, ...r, ...s, ...offset].every(Number.isFinite)) throw new Error(`Invalid scene transform: ${node.id}`)
    if (r[0] || r[1]) throw new Error(`2D inspection cannot project a tilted XY plane: ${node.id}`)
    const pose = compose2d(parentPose, affine2d(p[0] + offset[0], p[1] + offset[1], r[2] ?? 0, s[0], s[1]))
    poses.set(node.id, pose); visiting.delete(node.id); return pose
  }
  for (const node of nodes) resolve(node)
  return { poses, rects }
}

/** Geometric visibility, not gameplay, occlusion or aesthetics. No guessed image/TileSet sizes. */
export function inspectSceneLayout2d(data: SceneSpatialData, host: SceneViewportSize,
  tileSet?: (assetRef: string, member?: string) => TileSetData | undefined) {
  const coordinates = record(data.settings?.coordinateSystem)
  const unit = coordinates.pixelsPerUnit
  if (typeof unit !== 'number' || !Number.isFinite(unit) || unit <= 0) throw new Error('2D inspection requires positive pixelsPerUnit')
  const { poses, rects } = sceneWorldTransforms2d(data.nodes)
  const byId = new Map(data.nodes.map(node => [node.id, node]))
  const active = (node: SceneSpatialNode): boolean => node.enabled !== false && (!node.parentId || active(byId.get(node.parentId)!))
  const cameras = data.nodes.filter(node => active(node) && node.components?.some(c => c.type === 'camera' && c.data?.enabled !== false))
  const cameraNode = data.cameraNodeId ? data.nodes.find(node => node.id === data.cameraNodeId)
    : cameras.length === 1 ? cameras[0] : undefined
  const component = cameraNode?.components?.find(c => c.type === 'camera' && c.data?.enabled !== false)
  if (!cameraNode || !active(cameraNode) || !component?.data) throw new Error('Choose one active authored Camera with cameraNodeId for scene inspection')
  const camera = component.data as unknown as SceneCameraInput
  const view = resolveSceneCameraView(camera, host)
  if (view.projection !== 'orthographic') throw new Error('2D scene inspection requires an orthographic Camera')
  const pose = poses.get(cameraNode.id)!
  // A Camera is a rigid frame, not a scalable world object. Diagnose instead of silently inventing a view.
  if (Math.abs(Math.hypot(pose[0], pose[1]) - 1) > 1e-6 || Math.abs(Math.hypot(pose[2], pose[3]) - 1) > 1e-6 ||
      Math.abs(pose[0] * pose[3] - pose[1] * pose[2] - 1) > 1e-6)
    throw new Error('2D Camera inspection requires a rigid XY camera transform; scaled/sheared cameras need target-runtime inspection')
  const scale = view.rect.height / (view.halfHeight * 2 * unit)
  const inverse: Affine2D = [pose[0], pose[2], pose[1], pose[3],
    -pose[0] * pose[4] - pose[1] * pose[5], -pose[2] * pose[4] - pose[3] * pose[5]]
  const projection = compose2d(affine2d(view.rect.x + view.rect.width / 2, view.rect.y + view.rect.height / 2, 0, scale, scale), inverse)
  const nodes = data.nodes.map(node => {
    const bounds: { x: number; y: number; width: number; height: number }[] = []
    const visual = node.components?.find(c => ['sprite-renderer', 'image', 'text'].includes(c.type) && c.data?.enabled !== false)
    if (visual) {
      const v = record(visual.data), size = rects.get(node.id)?.size ?? (Array.isArray(v.size) ? v.size : [record(v.size).width ?? v.width, record(v.size).height ?? v.height])
      if (size.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
        const rect = node.components?.find(c => c.type === 'rect-transform')?.data
        const anchor = pair(rect?.pivot ?? v.anchor, [record(v.anchor).x ?? .5, record(v.anchor).y ?? .5])
        bounds.push({ x: -anchor[0] * size[0], y: -anchor[1] * size[1], width: size[0], height: size[1] })
      }
    }
    const mapComponent = node.components?.find(c => c.type === 'tilemap' && c.data?.enabled !== false)
    let geometryUnavailable: string | undefined
    if (mapComponent) {
      const map = parseTilemapData(mapComponent.data)
      validateTilemapGrid(data.nodes, node, map)
      const grid = parseGridData(byId.get(map.gridNodeId)!.components!.find(c => c.type === 'grid')!.data)
      const tiles = mapComponent.assetRef && tileSet?.(mapComponent.assetRef, map.member)
      if (!tiles) geometryUnavailable = 'TileSet required; cell size is not the visual tile size'
      else for (const cell of map.cells) {
        const tile = tiles.tiles[cell.tileId]
        if (!tile) throw new Error(`Unknown TileSet tile: ${cell.tileId}`)
        bounds.push(tileRect(grid, map, cell, tile))
      }
    }
    if (visual && !bounds.length) geometryUnavailable = 'Explicit visual size or RectTransform required'
    const corners = bounds.flatMap(b => [[b.x,b.y], [b.x+b.width,b.y], [b.x,b.y+b.height], [b.x+b.width,b.y+b.height]]
      .map(([x,y]) => point2d(poses.get(node.id)!, x, y)))
    const projected = corners.map(([x,y]) => point2d(projection, x, y))
    const boundsOf = (points: number[][]) => points.length ? points.reduce((b, [x,y]) => ({ left: Math.min(b.left,x), top: Math.min(b.top,y),
      right: Math.max(b.right,x), bottom: Math.max(b.bottom,y) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }) : undefined
    const screenBounds = boundsOf(projected), worldBounds = boundsOf(corners)
    const fullyInside = projected.length ? projected.every(([x,y]) => x >= view.rect.x - 1e-6 && y >= view.rect.y - 1e-6 &&
      x <= view.rect.x + view.rect.width + 1e-6 && y <= view.rect.y + view.rect.height + 1e-6) : undefined
    return { id: node.id, enabled: active(node), worldBounds, screenBounds, fullyInside,
      ...(geometryUnavailable ? { geometryUnavailable } : {}) }
  })
  return { cameraNodeId: cameraNode.id, view, worldToScreen: projection, nodes,
    note: 'Static XY geometry only; offscreen objects can be intentional. Unknown bounds, depth/near-far clipping, occlusion, dynamic camera behavior and gameplay need runtime checks.' }
}
