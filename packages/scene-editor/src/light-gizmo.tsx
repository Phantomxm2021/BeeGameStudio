import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Group, Matrix4, Quaternion, Vector3 } from 'three'
import type { LightData } from './model'

type Light = LightData
type Point = [number, number, number]

/** A filled 2D spot face in the editor's centered, y-up coordinate system. */
export function lightConePoints(light: Light, segments = 32): Array<[number, number]> {
  const length = Math.max(0, light.distance ?? 0)
  const angle = Math.max(0, Math.min(Math.PI / 2, light.angle ?? Math.PI / 3))
  const points: Array<[number, number]> = [[0, 0]]
  for (let index = 0; index <= segments; index += 1) {
    const theta = -angle + (2 * angle * index) / segments
    points.push([Math.sin(theta) * length, Math.cos(theta) * length])
  }
  return points
}

/** Local-space guides: light direction is -Z, just like the actual light target. */
export function lightGizmoSegments(light: Light): number[] {
  const points: number[] = []
  const line = (a: Point, b: Point) => points.push(...a, ...b)
  const curve = (at: (angle: number) => Point, end = Math.PI * 2) => {
    for (let i = 0; i < 64; i++) line(at(i / 64 * end), at((i + 1) / 64 * end))
  }
  const arrow = (x: number, y: number, length: number) => {
    line([x, y, 0], [x, y, -length])
    line([x - .15, y, -length + .25], [x, y, -length])
    line([x + .15, y, -length + .25], [x, y, -length])
  }
  if (light.kind === 'point') {
    const radius = light.distance ?? 0
    if (radius > 0) {
      curve(a => [Math.cos(a) * radius, Math.sin(a) * radius, 0])
      curve(a => [Math.cos(a) * radius, 0, Math.sin(a) * radius])
      curve(a => [0, Math.cos(a) * radius, Math.sin(a) * radius])
    } else {
      // An unbounded point light has no finite range sphere.
      line([-1, 0, 0], [1, 0, 0]); line([0, -1, 0], [0, 1, 0]); line([0, 0, -1], [0, 0, 1])
    }
  } else if (light.kind === 'spot') {
    const length = light.distance || 5
    const angle = light.angle ?? Math.PI / 3
    const cone = (angle: number) => {
      // Range is distance from the source: clip the cone to that sphere.
      // This also keeps a valid 90-degree light bounded rather than using tan(90°).
      const radius = length * Math.sin(angle), z = -length * Math.cos(angle)
      curve(a => [Math.cos(a) * radius, Math.sin(a) * radius, z])
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        line([0, 0, 0], [Math.cos(a) * radius, Math.sin(a) * radius, z])
        curve(t => [Math.cos(a) * length * Math.sin(t), Math.sin(a) * length * Math.sin(t), -length * Math.cos(t)], angle)
      }
    }
    cone(angle)
    if (light.penumbra) cone(angle * (1 - light.penumbra))
    arrow(0, 0, length)
  } else if (light.kind === 'directional') {
    curve(a => [Math.cos(a) * .55, Math.sin(a) * .55, 0])
    for (const x of [-.45, 0, .45]) arrow(x, 0, 2)
  } else {
    // Ambient light is global; the hemisphere is a symbol, not an influence boundary.
    curve(a => [Math.cos(a), 0, Math.sin(a)])
    curve(a => [Math.cos(a), Math.sin(a), 0], Math.PI)
    curve(a => [0, Math.sin(a), Math.cos(a)], Math.PI)
  }
  return points
}

export function LightGizmo({ light, color }: { light: Light; color: string }) {
  const guide = useRef<Group>(null)
  const pose = useMemo(() => ({ position: new Vector3(), direction: new Vector3(), rotation: new Quaternion(), matrix: new Matrix4(), unit: new Vector3(1, 1, 1), axis: new Vector3(0, 0, -1) }), [])
  useFrame(() => {
    const object = guide.current, parent = object?.parent
    if (!object || !parent) return
    parent.updateWorldMatrix(true, false)
    pose.position.setFromMatrixPosition(parent.matrixWorld)
    pose.direction.set(0, 0, -1).transformDirection(parent.matrixWorld)
    pose.rotation.setFromUnitVectors(pose.axis, pose.direction)
    // Three light ranges use world units, even when their parent is scaled.
    pose.matrix.compose(pose.position, pose.rotation, pose.unit)
    object.matrix.copy(parent.matrixWorld).invert().multiply(pose.matrix)
    object.matrixWorldNeedsUpdate = true
  })
  const points = useMemo(() => {
    const values = lightGizmoSegments(light)
    return Array.from({ length: values.length / 3 }, (_, i) => values.slice(i * 3, i * 3 + 3) as Point)
  }, [light.kind, light.distance, light.angle, light.penumbra])
  return <group ref={guide} matrixAutoUpdate={false} userData={{ editorHelper: true }}><Line points={points} segments lineWidth={1.25} color={color} userData={{ editorHelper: true }} raycast={() => {}} renderOrder={999} depthTest={false} depthWrite={false} toneMapped={false} /></group>
}
