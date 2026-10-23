import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { componentOf, type SceneDocument } from './model'
import { rectTransform } from './rect-transform'
import { resolveSceneCameraView, type SceneFraming, type SceneViewportSize } from './scene-camera'

/** Editor adapter only. Runtime consumers use the independent projection helper or native cameras. */
export function resolveGameCameraPreview(document: SceneDocument, host: SceneViewportSize) {
  const active = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) throw new Error('Camera hierarchy cycle')
    seen.add(id)
    const node = document.nodes[id]
    if (!node) throw new Error(`Unknown camera parent: ${id}`)
    return node.active && (!node.parentId || active(node.parentId, seen))
  }
  const candidates = Object.values(document.nodes).filter(node => componentOf(node, 'camera')?.enabled && active(node.id))
  const node = document.cameraNodeId ? candidates.find(node => node.id === document.cameraNodeId)
    : candidates.length === 1 ? candidates[0] : undefined
  if (!node) throw new Error('Choose one active Camera with cameraNodeId before game-camera preview')
  const component = componentOf(node, 'camera')!
  const reference = component.properties.viewport as SceneViewportSize | undefined
  if (!reference) throw new Error('Game camera preview requires Camera viewport reference dimensions')
  const view = resolveSceneCameraView({ orthographic: component.orthographic, orthographicSize: component.orthographicSize,
    fieldOfView: component.properties.fieldOfView as number | undefined, viewport: reference,
    framing: component.properties.framing as SceneFraming | undefined }, host)
  if (document.dimension === '2d' && view.projection !== 'orthographic') throw new Error('2D game preview requires an orthographic Camera')
  const chain = []
  let current: typeof node | undefined = node
  while (current) { chain.unshift(current); current = current.parentId ? document.nodes[current.parentId] : undefined }
  const matrix = new Matrix4()
  for (const parent of chain) {
    const q = parent.transform.quaternion ? new Quaternion(...parent.transform.quaternion)
      : new Quaternion().setFromEuler(new Euler(...parent.transform.rotation))
    matrix.multiply(new Matrix4().compose(new Vector3(...rectTransform(parent, document.nodes).position), q, new Vector3(...parent.transform.scale)))
  }
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
  matrix.decompose(position, rotation, scale)
  if (Math.abs(scale.x - 1) > 1e-6 || Math.abs(scale.y - 1) > 1e-6 || Math.abs(scale.z - 1) > 1e-6)
    throw new Error('Scaled Camera hierarchy requires target-runtime inspection')
  const axis = new Vector3(0, 0, -1).applyQuaternion(rotation)
  if (document.dimension === '2d' && (Math.abs(axis.x) > 1e-6 || Math.abs(axis.y) > 1e-6 || axis.z > -1 + 1e-6))
    throw new Error('Tilted 2D Camera requires target-runtime inspection')
  const near=component.nearClip ?? .01,far=component.farClip ?? 1000
  if(!Number.isFinite(near)||!Number.isFinite(far)||near<=0||far<=near)throw new Error('Camera clips must satisfy 0 < near < far')
  return { nodeId: node.id, view, position: position.toArray(), quaternion: rotation.toArray(),
    near,far }
}
