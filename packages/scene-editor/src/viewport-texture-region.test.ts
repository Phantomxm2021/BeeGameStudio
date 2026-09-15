import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyTextureRegion } from './viewport'

describe('sprite atlas texture regions', () => {
  it('maps a top-left pixel rectangle to Three texture coordinates', () => {
    const texture = new THREE.Texture()
    texture.image = { width: 256, height: 128 } as HTMLImageElement

    expect(applyTextureRegion(texture, { x: 64, y: 32, width: 32, height: 16 })).toBe(true)
    expect(texture.repeat.toArray()).toEqual([0.125, 0.125])
    expect(texture.offset.toArray()).toEqual([0.25, 0.625])
  })

  it('rejects a region outside the decoded image', () => {
    const texture = new THREE.Texture()
    texture.image = { width: 64, height: 64 } as HTMLImageElement

    expect(applyTextureRegion(texture, { x: 48, y: 0, width: 32, height: 32 })).toBe(false)
    expect(texture.repeat.toArray()).toEqual([1, 1])
    expect(texture.offset.toArray()).toEqual([0, 0])
  })
})
