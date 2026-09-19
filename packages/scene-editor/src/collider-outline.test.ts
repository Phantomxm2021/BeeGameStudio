import { describe, expect, it } from 'vitest'
import { colliderOutline } from './collider-outline'

describe('2D collider boundaries', () => {
  it('draws a horizontal capsule to its exact dimensions and offset, without triangulation edges', () => {
    const points = colliderOutline({ id: 'bush', enabled: true, type: 'capsule-collider-2d', size: [1.4, .8], offset: [.2, -.1], direction: 'horizontal', isTrigger: true })
    expect(Math.max(...points.map(p => p[0]))).toBeCloseTo(.9)
    expect(Math.min(...points.map(p => p[0]))).toBeCloseTo(-.5)
    expect(Math.max(...points.map(p => p[1]))).toBeCloseTo(.3)
    expect(Math.min(...points.map(p => p[1]))).toBeCloseTo(-.5)
    expect(points[0]).toEqual(points.at(-1))
  })
  it('keeps circle points on its radius, not through its center', () => {
    const points = colliderOutline({ id: 'rock', enabled: true, type: 'circle-collider-2d', radius: .26, offset: [0, 0], isTrigger: false })
    for (const [x, y] of points) expect(Math.hypot(x, y)).toBeCloseTo(.26)
  })
})
