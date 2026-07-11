import { describe, expect, test } from 'vitest'
import { automaticallyBindBaseColorTextures, decodeMaterialTextureBindings, encodeMaterialTextureBindings, suggestMaterialTextureCandidates } from './materialTextureBindings'

describe('material texture bindings', () => {
  test('persists a binding by stable element ID rather than the original texture path', () => {
    const encoded = encodeMaterialTextureBindings({ Body: { baseColor: 'texture-42' } })
    expect(decodeMaterialTextureBindings(encoded)).toEqual({ Body: { baseColor: 'texture-42' } })
  })

  test('automatically binds the top compatible Pack texture without replacing an explicit binding', () => {
    const candidates = [{ id: 'albedo', name: 'Knight-Body_Albedo.webp', kind: 'image', category: 'textures' }]
    expect(automaticallyBindBaseColorTextures('Knight.fbx', ['Body'], candidates)).toEqual({ Body: { baseColor: 'albedo' } })
    expect(automaticallyBindBaseColorTextures('Knight.fbx', ['Body'], candidates, { Body: { baseColor: 'manual' } })).toEqual({ Body: { baseColor: 'manual' } })
  })

  test('suggests Pack textures from normalized asset metadata and color semantics', () => {
    const suggestions = suggestMaterialTextureCandidates('Knight.fbx', ['Body'], [
      { id: 'normal', name: 'knight_body_normal.png', kind: 'image', category: 'textures' },
      { id: 'albedo', name: 'Knight-Body_Albedo.webp', kind: 'image', category: 'textures' },
      { id: 'other', name: 'forest_albedo.png', kind: 'image', category: 'textures' },
    ])
    expect(suggestions.Body[0]).toBe('albedo')
  })
})
