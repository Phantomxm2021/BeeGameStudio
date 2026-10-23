/** Camera projection math only. Does not resize world geometry or implement a renderer. */
export type SceneFraming = 'keep-height' | 'keep-width' | 'expand' | 'letterbox'
export type SceneViewportSize = { width: number; height: number }
export type SceneCameraInput = {
  orthographic: boolean
  orthographicSize?: number // half-height in world/editor units, not logical pixels
  fieldOfView?: number // vertical degrees at the reference aspect
  viewport: SceneViewportSize // reference composition, never the fixed host size
  framing?: SceneFraming
  pixelsPerUnit?: number // required when projecting logical-pixel UI in the 2D camera reference plane
}
export const SCENE_FRAMING_OPTIONS: readonly SceneFraming[] = ['keep-height', 'keep-width', 'expand', 'letterbox']
export type CameraPlaneBounds = { left: number; top: number; right: number; bottom: number }

/** Exact aspect limits for fixed XY geometry relative to the camera, in world units.
 * This does not choose a framing policy, resize objects or prove dynamic visibility. */
export function sceneCameraAspectRange(camera: SceneCameraInput, bounds: CameraPlaneBounds) {
  const reference = resolveSceneCameraView(camera, camera.viewport)
  if (reference.projection !== 'orthographic') throw new Error('Static aspect limits require an orthographic Camera')
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) || bounds.right < bounds.left || bounds.bottom < bounds.top)
    throw new Error('Camera-plane bounds must be finite and ordered')
  const x = Math.max(Math.abs(bounds.left), Math.abs(bounds.right))
  const y = Math.max(Math.abs(bounds.top), Math.abs(bounds.bottom))
  const w = reference.halfWidth, h = reference.halfHeight
  let min = 0, max: number | null = null
  if (reference.framing === 'keep-height') {
    if (y > h + 1e-9) return null
    min = x / h
  } else if (reference.framing === 'keep-width') {
    if (x > w + 1e-9) return null
    max = y ? w / y : null
  } else if (reference.framing === 'letterbox') {
    if (x > w + 1e-9 || y > h + 1e-9) return null
  } else {
    // Expand fixes reference width on narrower hosts, and reference height on wider hosts.
    if (x > w + 1e-9 && y > h + 1e-9) return null
    if (x > w + 1e-9) min = x / h
    if (y > h + 1e-9) max = w / y
  }
  return { min, max } // 0 / null denote no lower / upper aspect limit.
}
function positive(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`)
}
export function resolveSceneCameraView(camera: SceneCameraInput, host: SceneViewportSize) {
  positive(host.width, 'Host width'); positive(host.height, 'Host height')
  positive(camera.viewport?.width, 'Camera reference width'); positive(camera.viewport?.height, 'Camera reference height')
  if (typeof camera.orthographic !== 'boolean') throw new Error('Camera orthographic must be boolean')
  const framing = camera.framing ?? 'keep-height'
  if (!SCENE_FRAMING_OPTIONS.includes(framing)) throw new Error(`Unknown camera framing: ${framing}`)
  const referenceAspect = camera.viewport.width / camera.viewport.height
  let aspect = host.width / host.height
  let rect = { x: 0, y: 0, width: host.width, height: host.height }
  if (framing === 'letterbox') {
    const scale = Math.min(host.width / camera.viewport.width, host.height / camera.viewport.height)
    const width = camera.viewport.width * scale, height = camera.viewport.height * scale
    rect = { x: (host.width - width) / 2, y: (host.height - height) / 2, width, height }
    aspect = referenceAspect
  }
  const heightFactor = framing === 'keep-width' ? referenceAspect / aspect
    : framing === 'expand' ? Math.max(1, referenceAspect / aspect) : 1
  if (camera.orthographic) {
    positive(camera.orthographicSize, 'Camera orthographicSize')
    const halfHeight = camera.orthographicSize * heightFactor
    return { projection: 'orthographic' as const, framing, rect, aspect,
      halfHeight, halfWidth: halfHeight * aspect, verticalFieldOfView: undefined }
  }
  positive(camera.fieldOfView, 'Camera fieldOfView')
  if (camera.fieldOfView >= 180) throw new Error('Camera fieldOfView must be less than 180 degrees')
  const verticalFieldOfView = Math.atan(Math.tan(camera.fieldOfView * Math.PI / 360) * heightFactor) * 360 / Math.PI
  return { projection: 'perspective' as const, framing, rect, aspect,
    halfHeight: undefined, halfWidth: undefined, verticalFieldOfView }
}
