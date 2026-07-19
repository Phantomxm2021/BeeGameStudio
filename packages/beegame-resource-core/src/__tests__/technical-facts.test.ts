import { describe, expect, test } from 'bun:test'
import { normalizeResourceTechnicalFacts } from '../technical-facts'

describe('resource technical fact compatibility', () => {
  test('maps legacy bounds and derives neutral assembly offsets without guessing scale', () => {
    expect(normalizeResourceTechnicalFacts({
      boundsWidth: 4,
      boundsHeight: 8,
      boundsDepth: 2,
      boundsMinX: -1,
      boundsMaxX: 3,
      boundsMinY: 2,
      boundsMaxY: 10,
      boundsMinZ: -4,
      boundsMaxZ: -2,
    })).toEqual(expect.objectContaining({
      boundsSizeX: 4,
      boundsSizeY: 8,
      boundsSizeZ: 2,
      boundsCenterX: 1,
      boundsCenterY: 6,
      boundsCenterZ: -3,
      groundOffsetY: -2,
      centeringOffsetX: -1,
      centeringOffsetZ: 3,
    }))
  })

  test('preserves current facts and never invents a unit scale', () => {
    const facts = normalizeResourceTechnicalFacts({ boundsSizeX: 7, boundsWidth: 4 })
    expect(facts.boundsSizeX).toBe(7)
    expect(facts).not.toHaveProperty('unitScale')
  })
})
