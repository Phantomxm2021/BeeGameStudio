import type { Collider2DComponent } from './model'

/** Boundary only: triangulation edges are not part of the collider gizmo. */
export function colliderOutline(volume: Collider2DComponent): [number, number, number][] {
  let points: [number, number][] = []
  if (volume.type === 'circle-collider-2d') {
    points = Array.from({ length: 48 }, (_, i) => [Math.cos(i * Math.PI / 24) * volume.radius, Math.sin(i * Math.PI / 24) * volume.radius])
  } else if (volume.type === 'polygon-collider-2d') {
    points = volume.points
  } else if (volume.type === 'capsule-collider-2d') {
    const horizontal = volume.direction === 'horizontal'
    const [width, height] = volume.size
    const radius = Math.min(width, height) / 2
    const length = Math.max(0, (horizontal ? width : height) / 2 - radius)
    for (const side of [1, -1]) for (let i = 0; i <= 24; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 24 + (side === -1 ? Math.PI : 0)
      const x = side * length + Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      points.push(horizontal ? [x, y] : [-y, x])
    }
  } else {
    const [w, h] = volume.size.map(value => value / 2)
    points = [[-w, -h], [w, -h], [w, h], [-w, h]]
  }
  if (!points.length) return []
  return [...points, points[0]].map(([x, y]) => [x + volume.offset[0], y + volume.offset[1], .002])
}
