import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyTextureRegion, rendererSize, rendererOffset, rendererOrder, textRasterMetrics } from './viewport'
import { identityTransform, type SceneNode } from './model'

describe('sprite atlas texture regions', () => {
  it('respects explicit 2D renderer order including zero and negative layers', () => {
    const node: SceneNode = { id: 'sprite', name: 'Sprite', parentId: null, children: [], active: true, locked: false,
      transform: identityTransform(), tags: [], order: 12, components: [] }
    expect(rendererOrder(node)).toBe(12)
    node.components.push({ id: 'renderer', type: 'sprite-renderer', enabled: true, assetId: 'texture',
      material: { mode: 'unlit', color: '#ffffff', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'blend' },
      properties: { sortingOrder: 0 } })
    expect(rendererOrder(node)).toBe(0)
    if (node.components[0].type === 'sprite-renderer') node.components[0].properties.sortingOrder = -5
    expect(rendererOrder(node)).toBe(-5)
  })
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

  it('keeps renderer geometry size separate from child-inherited Transform scale', () => {
    const node: SceneNode = { id: 'child', name: 'Child', parentId: 'parent', children: [], active: true, locked: false, transform: identityTransform(), tags: [], components: [{ id: 'sprite', type: 'sprite-renderer', enabled: true, assetId: 'sprite', material: { mode: 'unlit', color: '#ffffff', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'opaque' }, properties: { size: { width: 64, height: 32 } } }] }
    expect(rendererSize(node)).toEqual([.64, .32])
    expect(node.transform.scale).toEqual([1, 1, 1])
    if (node.components[0].type === 'sprite-renderer') node.components[0].properties.size = [32, 48]
    expect(rendererSize(node, 32)).toEqual([1, 1.5])
    if (node.components[0].type === 'sprite-renderer') node.components[0].properties.anchor = [.5, 1]
    expect(rendererOffset(node, rendererSize(node,32))).toEqual([0,.75,0])
    expect(node.transform).toEqual(identityTransform())
    if (node.components[0].type === 'sprite-renderer') node.components[0].properties.size = [.2, .1]
    expect(rendererSize(node, 1)).toEqual([.2, .1])
  })

  it('uses a UI RectTransform size when an Image has no texture dimensions', () => {
    const node: SceneNode = {
      id: 'panel', name: 'Panel', parentId: null, children: [], active: true, locked: false,
      transform: identityTransform(), tags: [],
      components: [
        { id: 'rect', type: 'rect-transform', enabled: true, anchorMin: [0, 0], anchorMax: [1, 1], pivot: [.5, .5], anchoredPosition: [0, 0], sizeDelta: [4.8, 2.4], properties: {} },
        { id: 'image', type: 'image', enabled: true, material: { mode: 'unlit', color: '#ffffff', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'opaque' }, properties: {} },
      ],
    }
    expect(rendererSize(node)).toEqual([4.8, 2.4])
  })

  it('keeps authored 2D font size in logical pixels while rasterizing the rect', () => {
    expect(textRasterMetrics(28, [2, .6], 100, true)).toEqual({ density: 100, fontSize: 28, width: 200, height: 60 })
  })
})
