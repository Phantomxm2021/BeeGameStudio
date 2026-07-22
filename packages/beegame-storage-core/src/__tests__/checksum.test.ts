import { describe, expect, test } from 'bun:test'
import { sha256Hex } from '../checksum'

describe('storage checksums', () => {
  test('creates a stable full-object SHA-256 digest', () => {
    expect(sha256Hex(new TextEncoder().encode('BeeGame'))).toBe(
      '1266d1920f564157a9259a84b194e66fbc283f5f7d24108d08a2d3086737b0d1',
    )
  })
})
