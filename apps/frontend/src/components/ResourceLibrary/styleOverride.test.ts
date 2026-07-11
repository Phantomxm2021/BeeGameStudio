import { describe, expect, test } from 'vitest'
import { decodeStyleOverride, encodeStyleOverride, packStyleOptions } from './styleOverride'

describe('style override persistence', () => {
  test('reads legacy Pack-style strings and persists a stable selection array', () => {
    expect(decodeStyleOverride('Pixel / Fantasy')).toEqual(['Pixel', 'Fantasy'])
    expect(encodeStyleOverride(['Fantasy', 'Pixel', 'Fantasy'])).toBe('["Fantasy","Pixel"]')
  })

  test('uses the Pack configured styles as available options', () => {
    expect(packStyleOptions('Pixel / Fantasy', ['Custom'])).toEqual(['Pixel', 'Fantasy', 'Custom'])
  })
})
