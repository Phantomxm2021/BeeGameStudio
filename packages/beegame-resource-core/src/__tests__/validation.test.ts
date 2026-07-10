import { describe, expect, test } from 'bun:test'
import {
  ResourceValidationError,
  validateResourceElement,
  validateResourcePack,
} from '../validation'

const validPack = {
  id: 'pack-1',
  name: 'Example Pack',
  style: 'Stylized',
  gameTypes: ['adventure'],
  dimension: '2D' as const,
  primaryCategory: 'ui-kit' as const,
  categories: ['characters', 'ui'] as const,
  license: 'internal',
  version: '1.0.0',
  status: 'published' as const,
}

describe('resource pack validation', () => {
  test('accepts a complete Pack contract', () => {
    expect(validateResourcePack(validPack)).toEqual(validPack)
  })

  test('rejects an unsupported dimension', () => {
    expect(() => validateResourcePack({ ...validPack, dimension: 'flat' })).toThrow(
      ResourceValidationError,
    )
  })

  test('rejects a Pack without an explicit category', () => {
    expect(() => validateResourcePack({ ...validPack, categories: [] })).toThrow(
      ResourceValidationError,
    )
  })

  test('rejects an unsupported Pack primary category', () => {
    expect(() => validateResourcePack({ ...validPack, primaryCategory: 'characters' })).toThrow(
      'Pack primary category is unsupported',
    )
  })

  test('rejects a Pack without a primary category', () => {
    const { primaryCategory, ...packWithoutPrimaryCategory } = validPack
    expect(() => validateResourcePack(packWithoutPrimaryCategory)).toThrow(
      'Pack primary category is unsupported',
    )
  })

  test('accepts an element with inherited Pack metadata', () => {
    const element = {
      id: 'element-1',
      packId: 'pack-1',
      name: 'Character Idle',
      path: 'characters/idle.png',
      category: 'characters' as const,
      kind: 'sprite-sheet' as const,
      preview: { kind: 'image' as const, path: 'previews/idle.png' },
      specs: { width: 256, height: 256, frames: 4 },
      dependencies: [],
      status: 'ready' as const,
    }
    expect(validateResourceElement(element)).toEqual(element)
  })
})
