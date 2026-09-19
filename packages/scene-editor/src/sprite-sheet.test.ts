import { describe, expect, it } from 'vitest'
import { parseSpriteSheet, spriteSheetSelection } from './sprite-sheet'
import { withAsset } from './inspector'
import type { SpriteRendererComponent, SceneAsset } from './model'
import { canonicalJson } from './persistence'

describe('project sprite sheets', () => {
  it('reads the packed array atlas used by harbor and resolves extensionless frame IDs', () => {
    const table = parseSpriteSheet({ frames: [
      { filename: 'boat_hull_f0.png', frame: { x: 1, y: 1, w: 40, h: 48 }, rotated: false, trimmed: false },
      { filename: 'dock_post_f0.png', frame: { x: 610, y: 64, w: 12, h: 36 }, rotated: false, trimmed: false },
    ] });
    expect(spriteSheetSelection(table, { frame: 'dock_post_f0' }).frame).toEqual({ x: 610, y: 64, width: 12, height: 36 });
    expect(spriteSheetSelection(table, { frame: 'dock_post_f0.png' }).frame?.x).toBe(610);
    expect(() => spriteSheetSelection(table, { frame: 'missing' })).toThrow('no frame');
  });
  it('reads named atlas maps and rejects unsupported rotated entries explicitly', () => {
    expect(parseSpriteSheet({ frames: { 'buoy.png': { frame: { x: 10, y: 20, w: 32, h: 48 } } } })).toEqual({ frames: { buoy: { x: 10, y: 20, width: 32, height: 48 } } });
    expect(() => parseSpriteSheet({ frames: [{ filename: 'bad.png', frame: { x: 0, y: 0, w: 32, h: 48 }, rotated: true }] })).toThrow('rotated/trimmed');
  });

  it('accepts state strips without framesPerFacing and rejects malformed directional metadata', () => {
    expect(parseSpriteSheet({ frameWidth: 44, frameHeight: 44, states: ['normal', 'hover'] })).toBeDefined()
    expect(parseSpriteSheet({ frameWidth: 128, frameHeight: 128, facings: ['down'] })).toBeUndefined()
    expect(parseSpriteSheet({ frameWidth: -1, frameHeight: 44 })).toBeUndefined()
  })
  it('crops the second mailbox state inside its 160px image', () => {
    const selection = spriteSheetSelection({ frameWidth: 80, frameHeight: 96, framesPerFacing: 2, states: ['flag_down', 'flag_up'] }, { frame: 'flag_up' })
    expect(selection).toEqual({ frame: { x: 80, y: 0, width: 80, height: 96 } })
  })
  it('replaces a sprite with the new sheet animation immediately, without stale state', () => {
    const sprite: SpriteRendererComponent = { id: 'sprite', type: 'sprite-renderer', enabled: true, assetId: 'old', properties: { frame: 'old', initialFacing: 'left' },
      material: { mode: 'unlit', color: '#ffffff', metalness: 0, roughness: 1, opacity: 1, alphaMode: 'blend' } }
    const asset: SceneAsset = { id: 'fox:walk', name: 'walk.webp', path: 'walk.webp', mimeType: 'image/webp',
      spriteSheet: { frameWidth: 128, frameHeight: 128, facings: ['down', 'up', 'left', 'right'], framesPerFacing: 4 } }
    const next = withAsset(sprite, asset.id, asset)
    expect(next).toMatchObject({ member: 'walk', animation: { initialFacing: 'down', framesPerFacing: 4 }, frame: { x: 0, width: 128 }, material: { textureRegion: { x: 0, width: 128 } } })
    if (next.type !== 'sprite-renderer') throw new Error('Expected sprite renderer')
    expect(next.properties).not.toHaveProperty('frame')
    expect(next.properties).not.toHaveProperty('initialFacing')
    expect(() => canonicalJson(next)).not.toThrow()
    expect(spriteSheetSelection(asset.spriteSheet, { initialFacing: 'right' }).frame?.x).toBe(1536)
  })
})
