import { describe, expect, it } from 'vitest'
import { Box3, BufferGeometry, Float32BufferAttribute } from 'three'
import { lightGizmoSegments } from '../src/light-gizmo'

const bounds = (points: number[]) => {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3))
  geometry.computeBoundingBox()
  const result = geometry.boundingBox!.clone()
  geometry.dispose()
  return result
}
const light = { color: '#ffffff', intensity: 1 }

describe('light gizmo dimensions', () => {
  it('shows the point light range in every axis and updates when the range changes', () => {
    for (const distance of [2, 7]) {
      const box = bounds(lightGizmoSegments({ ...light, kind: 'point', distance }))
      expect(box.min.toArray()).toEqual([-distance, -distance, -distance])
      expect(box.max.toArray()).toEqual([distance, distance, distance])
    }
  })
  it('draws a spotlight cone along -Z with the given outer angle and penumbra', () => {
    const base = { ...light, kind: 'spot' as const, distance: 4, angle: Math.PI / 4, penumbra: 0 }
    const points = lightGizmoSegments(base)
    const box: Box3 = bounds(points)
    expect(box.min.x).toBeCloseTo(-Math.sqrt(8))
    expect(box.max.y).toBeCloseTo(Math.sqrt(8))
    expect(box.min.z).toBe(-4)
    expect(box.max.z).toBe(0)
    expect(lightGizmoSegments({ ...base, penumbra: .5 }).length).toBeGreaterThan(points.length)
    expect(bounds(lightGizmoSegments({ ...base, penumbra: .5 }))).toEqual(box)
    const wide = lightGizmoSegments({ ...base, angle: Math.PI / 2 })
    for (let i = 0; i < wide.length; i += 3) expect(Math.hypot(wide[i], wide[i + 1], wide[i + 2])).toBeLessThanOrEqual(4.00001)
  })
  it('keeps direction and ambient symbols finite without inventing a light range', () => {
    for (const kind of ['directional', 'ambient', 'point', 'spot'] as const) {
      const points = lightGizmoSegments({ ...light, kind, distance: 0, angle: Math.PI / 6 })
      expect(points.length).toBeGreaterThan(0)
      expect(points.every(Number.isFinite)).toBe(true)
    }
    expect(bounds(lightGizmoSegments({ ...light, kind: 'directional' })).min.z).toBe(-2)
  })
})
