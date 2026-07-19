import { describe, expect, test } from 'vitest'
import { decodeMaterialTextureBindings, encodeMaterialTextureBindings } from './materialTextureBindings'

describe('material texture bindings', () => {
  test('persists a binding by stable element ID rather than the original texture path', () => {
    const encoded = encodeMaterialTextureBindings({ Body: { baseColor: 'texture-42' } })
    expect(decodeMaterialTextureBindings(encoded)).toEqual({ Body: { baseColor: 'texture-42' } })
  })
})
