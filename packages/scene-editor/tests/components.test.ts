import { describe, expect, it } from 'vitest'
import { applyPatch, operations, patchFor } from '../src/commands'
import { withAsset } from '../src/inspector'
import { makeFixture } from '../src/model'
import { canonicalJson } from '../src/persistence'

describe('component operations', () => {
  it('adds, updates and removes components without legacy node fields', () => {
    const document = makeFixture()
    const listener = { id: 'root:audio-listener:0', type: 'audio-listener' as const, enabled: true, properties: {} }
    const added = applyPatch(document, patchFor(document, [operations.component('root', listener, null)], 'Add AudioListener'))
    expect(added.applied).toBe(true)
    expect(added.document.nodes.root.components).toContainEqual(listener)
    const removed = applyPatch(added.document, patchFor(added.document, [{ type: 'scene.removeComponent', nodeId: 'root', componentId: listener.id, expectedComponent: listener }], 'Remove listener'))
    expect(removed.applied).toBe(true)
    expect(removed.document.nodes.root.components).toEqual([])
  })

  it('detaches operations when constructing a patch', () => {
    const document = makeFixture(); const operation = operations.rename('root', 'Renamed')
    const patch = patchFor(document, [operation], 'detached'); (operation as { name: string }).name = 'Changed'
    expect(patch.operations[0]).toMatchObject({ type: 'scene.renameGameObject', name: 'Renamed' })
  })

  it('replaces a sprite without undefined fields or stale frame state', () => {
    const next = withAsset({
      id: 'guard-sprite',
      type: 'sprite-renderer',
      enabled: true,
      assetId: 'RES-OLD:idle',
      member: 'idle',
      frame: { x: 64, y: 0, width: 64, height: 64 },
      animation: { frameWidth: 64, frameHeight: 64, framesPerFacing: 4, facings: ['south'], initialFacing: 'south', loop: true },
      material: { mode: 'unlit', color: '#ffffff', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'opaque', textureAssetId: 'RES-OLD:idle', textureRegion: { x: 64, y: 0, width: 64, height: 64 } },
      properties: { size: { width: 64, height: 64 } },
    }, 'RES-NEW')

    expect(next).toMatchObject({ type: 'sprite-renderer', assetId: 'RES-NEW', material: { textureAssetId: 'RES-NEW' } })
    expect(next).not.toHaveProperty('member')
    expect(next).not.toHaveProperty('frame')
    expect(next).not.toHaveProperty('animation')
    expect(next.material).not.toHaveProperty('textureRegion')
    expect(() => canonicalJson(next)).not.toThrow()
  })
})
