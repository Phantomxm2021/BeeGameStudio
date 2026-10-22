import { describe, expect, test } from 'bun:test'
import {
  assertSafeObjectKey,
  buildResourcePackObjectKey,
} from '../routing'

describe('object key safety', () => {
  test('normalizes separators and preserves opaque relative keys', () => {
    expect(assertSafeObjectKey('objects\\01\\payload.glb')).toBe(
      'objects/01/payload.glb',
    )
  })

  test('rejects absolute and traversing keys', () => {
    expect(() => assertSafeObjectKey('/objects/file')).toThrow()
    expect(() => assertSafeObjectKey('objects/../file')).toThrow()
  })

  test('groups immutable Resource Library objects under their Pack', () => {
    expect(buildResourcePackObjectKey('pack-1', 'object-1')).toBe(
      'packs/pack-1/objects/object-1/payload',
    )
    expect(() => buildResourcePackObjectKey('../pack', 'object-1')).toThrow()
    expect(() => buildResourcePackObjectKey('pack-1', 'nested/object')).toThrow()
  })
})
