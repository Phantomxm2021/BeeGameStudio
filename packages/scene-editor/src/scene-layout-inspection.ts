import { affine2d, canvasReferenceSize, compose2d, point2d, rectLayout, type Affine2D } from './content-coordinates'
import { parseGridData, parseTilemapData, tileRect, validateTilemapGrid, type TileSetData } from './tilemap-data'
import { resolveSceneCameraView, sceneCameraAspectRange, type SceneCameraInput, type SceneViewportSize } from './scene-camera'

type Component = { type: string; assetRef?: string; data?: Record<string, unknown> }
export type SceneSpatialNode = { id: string; parentId?: string; enabled?: boolean;
  transform?: { position?: number[]; rotation?: number[]; scale?: number[] }; components?: Component[] }
export type SceneSpatialData = { nodes: readonly SceneSpatialNode[]; cameraNodeId?: string; settings?: Record<string, unknown> }
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
const pair = (value: unknown, fallback: [number, number]): [number, number] => Array.isArray(value) ? value as [number, number] : fallback

/** The same authored camera selection is used by inspection and linked UI checks. */
export function sceneCameraInput2d(data: SceneSpatialData) {
  const byId = new Map(data.nodes.map(node => [node.id, node]))
  if (byId.size !== data.nodes.length) throw new Error('Duplicate scene node IDs')
  const active = new Map<string, boolean>(), visiting = new Set<string>()
  const enabled = (node: SceneSpatialNode): boolean => {
    if (active.has(node.id)) return active.get(node.id)!
    if (visiting.has(node.id)) throw new Error(`Scene hierarchy cycle: ${node.id}`)
    visiting.add(node.id)
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (node.parentId && !parent) throw new Error(`Unknown scene parent: ${node.parentId}`)
    const result = node.enabled !== false && (!parent || enabled(parent))
    active.set(node.id, result); visiting.delete(node.id); return result
  }
  const cameras = data.nodes.filter(node => enabled(node) && node.components?.some(c => c.type === 'camera' && c.data?.enabled !== false))
  const node = data.cameraNodeId ? cameras.find(node => node.id === data.cameraNodeId) : cameras.length === 1 ? cameras[0] : undefined
  const component = node?.components?.find(c => c.type === 'camera' && c.data?.enabled !== false)
  if (!node || !component?.data) throw new Error('Choose one active authored Camera with cameraNodeId for scene inspection')
  return { nodeId: node.id, input: { ...component.data, pixelsPerUnit: data.settings?.coordinateSystem &&
    record(data.settings.coordinateSystem).pixelsPerUnit } as unknown as SceneCameraInput, active }
}

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
      const canvas = node.components?.find(c => c.type === 'canvas' && c.data?.enabled !== false)?.data
      const reference = !parentRect && (canvas?.renderMode === 'screen-space-overlay' || canvas?.renderMode === 'screen-space-camera')
        ? canvasReferenceSize(canvas.referenceResolution) : undefined
      const calculated = rectLayout(parentRect?.size ?? reference ?? [0, 0], pair(parentData?.pivot, [0, 0]),
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
  const required = data.settings?.requiredVisibleNodeIds
  if (required !== undefined && (!Array.isArray(required) || !required.length || required.some(id => typeof id !== 'string' || !id) ||
      new Set(required).size !== required.length)) throw new Error('settings.requiredVisibleNodeIds must be a nonempty unique list of node IDs')
  const { poses, rects } = sceneWorldTransforms2d(data.nodes)
  const byId = new Map(data.nodes.map(node => [node.id, node]))
  const selected = sceneCameraInput2d(data), cameraNode = byId.get(selected.nodeId)!
  const camera = selected.input
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
    let geometryUnavailable: string | undefined
    const visuals = node.components?.filter(c => ['sprite-renderer', 'image', 'text'].includes(c.type) && c.data?.enabled !== false) ?? []
    for (const visual of visuals) {
      const v = record(visual.data), size = rects.get(node.id)?.size ?? (Array.isArray(v.size) ? v.size : [record(v.size).width ?? v.width, record(v.size).height ?? v.height])
      if (size.length === 2 && size.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
        const rect = node.components?.find(c => c.type === 'rect-transform')?.data
        const anchor = pair(rect?.pivot ?? v.anchor, [record(v.anchor).x ?? .5, record(v.anchor).y ?? .5])
        if (anchor.length !== 2 || !anchor.every(Number.isFinite)) throw new Error(`Invalid scene visual anchor: ${node.id}`)
        bounds.push({ x: -anchor[0] * size[0], y: -anchor[1] * size[1], width: size[0], height: size[1] })
      } else geometryUnavailable = 'Explicit visual size or RectTransform required'
    }
    const mapComponent = node.components?.find(c => c.type === 'tilemap' && c.data?.enabled !== false)
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
    const corners = bounds.flatMap(b => [[b.x,b.y], [b.x+b.width,b.y], [b.x,b.y+b.height], [b.x+b.width,b.y+b.height]]
      .map(([x,y]) => point2d(poses.get(node.id)!, x, y)))
    const projected = corners.map(([x,y]) => point2d(projection, x, y))
    const boundsOf = (points: number[][]) => points.length ? points.reduce((b, [x,y]) => ({ left: Math.min(b.left,x), top: Math.min(b.top,y),
      right: Math.max(b.right,x), bottom: Math.max(b.bottom,y) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }) : undefined
    const screenBounds = boundsOf(projected), worldBounds = boundsOf(corners)
    const knownInside = projected.length ? projected.every(([x,y]) => x >= view.rect.x - 1e-6 && y >= view.rect.y - 1e-6 &&
      x <= view.rect.x + view.rect.width + 1e-6 && y <= view.rect.y + view.rect.height + 1e-6) : undefined
    const fullyInside = geometryUnavailable && knownInside !== false ? undefined : knownInside
    const cameraPoints = required === undefined ? [] : corners.map(([x,y]) => point2d(inverse, x, y).map(value => value / unit))
    return { id: node.id, parentId: node.parentId, enabled: selected.active.get(node.id) === true,
      localTransform: node.transform, rectTransform: node.components?.find(c => c.type === 'rect-transform')?.data,
      worldOrigin: point2d(poses.get(node.id)!, 0, 0), worldBounds, screenBounds, fullyInside,
      ...(cameraPoints.length ? { cameraBounds: boundsOf(cameraPoints) } : {}),
      ...(geometryUnavailable ? { geometryUnavailable } : {}) }
  })
  let requiredVisibility
  if (Array.isArray(required)) {
    for (const id of required) if (!byId.has(id)) throw new Error(`Unknown required-visible scene node: ${id}`)
    // A selected group includes enabled descendants, not just its own optional visual.
    const members = new Map<string, typeof nodes>(required.map(id => [id, []]))
    for (const node of nodes) {
      if (!node.enabled || (!node.cameraBounds && !node.geometryUnavailable)) continue
      let ancestor: string | undefined = node.id
      while (ancestor) { members.get(ancestor)?.push(node); ancestor = byId.get(ancestor)?.parentId }
    }
    const checked = [...new Map([...members.values()].flat().map(node => [node.id, node])).values()]
    const unavailable = checked.filter(node => node.geometryUnavailable || !node.cameraBounds).map(node => node.id)
    const empty = required.filter(id => !members.get(id)!.length)
    const outside = checked.filter(node => node.fullyInside === false).map(node => node.id)
    const known = checked.flatMap(node => node.cameraBounds ? [node.cameraBounds] : [])
    const bounds = known.length ? { left: Math.min(...known.map(b => b.left)), top: Math.min(...known.map(b => b.top)),
      right: Math.max(...known.map(b => b.right)), bottom: Math.max(...known.map(b => b.bottom)) } : undefined
    requiredVisibility = { status: outside.length ? 'failed' : unavailable.length || empty.length ? 'unverified' : 'passed',
      requiredNodeIds: required, checkedNodeIds: checked.map(node => node.id), outside, unavailable: [...unavailable, ...empty],
      ...(bounds && !unavailable.length && !empty.length ? { cameraBounds: bounds, supportedAspect: sceneCameraAspectRange(camera, bounds) } : {}) }
  }
  return { cameraNodeId: cameraNode.id, coordinateSystem: coordinates,
    camera: { input: camera, localTransform: cameraNode.transform, worldOrigin: point2d(pose, 0, 0) },
    view, worldToScreen: projection, nodes,
    ...(requiredVisibility ? { requiredVisibility } : {}),
    note: 'Static XY geometry only; offscreen objects can be intentional. Unknown bounds, depth/near-far clipping, occlusion, dynamic camera behavior and gameplay need runtime checks.' }
}
