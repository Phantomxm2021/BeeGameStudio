import { describe, expect, test } from 'bun:test'
import {
  ResourceValidationError,
  validateResourceElement,
  validateResourcePack,
} from '../validation'

const validPack = {
  id: 'pack-1',
  name: 'Example Pack',
  styles: ['Stylized'],
  gameTypes: ['adventure'],
  dimension: '2D' as const,
  primaryCategory: 'ui-kit' as const,
  categories: ['sprites', 'ui'] as const,
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

  test('accepts an empty derived list of contained element categories', () => {
    expect(validateResourcePack({ ...validPack, categories: [] })).toEqual({
      ...validPack,
      categories: [],
    })
  })

  test('rejects a Pack whose contained element categories are not an array', () => {
    expect(() => validateResourcePack({ ...validPack, categories: 'ui' })).toThrow(
      'Pack categories must be an array of supported values',
    )
  })

  test('rejects a Pack with an unsupported contained element category', () => {
    expect(() => validateResourcePack({ ...validPack, categories: ['unknown'] })).toThrow(
      'Pack categories must be an array of supported values',
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

  test('accepts an unclassified element without semantic tags', () => {
    const element = {
      id: 'element-1',
      packId: 'pack-1',
      name: 'Character Idle',
      path: 'characters/idle.png',
      category: 'sprites' as const,
      kind: 'sprite-sheet' as const,
      preview: { kind: 'image' as const, path: 'previews/idle.png' },
      specs: { width: 256, height: 256, frames: 4 },
      dependencies: [],
      status: 'ready' as const,
    }
    expect(validateResourceElement(element)).toEqual(element)
  })

  test('accepts only formal element usage capabilities', () => {
    const element = {
      id: 'element-1', packId: 'pack-1', name: 'Tree', path: 'models/tree.glb',
      category: 'models' as const, kind: 'model', specs: {}, usageTags: ['vegetation', 'environment'] as const, dependencies: [], status: 'ready' as const,
    }
    expect(validateResourceElement(element)).toEqual(element)
    expect(() => validateResourceElement({ ...element, usageTags: ['made-up-purpose'] })).toThrow(
      'Element usageTags must contain supported values',
    )
  })

  test('validates typed asset metadata and semantic relations', () => {
    const element = {
      id: 'run', packId: 'pack-1', name: 'Run', path: 'animations/run.glb',
      category: 'animation' as const, kind: 'animation', assetKind: 'animation-library' as const,
      capabilities: ['contains-animations'] as const,
      contentProfile: { packaging: 'self-contained' as const, components: [{ id: 'clip:0', kind: 'animation-clip' as const, roles: ['locomotion'], specs: { duration: 1.2 } }], inspection: { status: 'complete' as const, source: 'server' as const } },
      relations: [{ kind: 'animation-for' as const, targetElementId: 'hero-rig', role: 'locomotion', required: true }],
      specs: {}, dependencies: [], status: 'ready' as const,
    }
    expect(validateResourceElement(element)).toEqual(element)
    expect(() => validateResourceElement({ ...element, capabilities: ['unknown'] })).toThrow('Element capabilities must contain supported values')
    expect(() => validateResourceElement({ ...element, relations: [{ kind: 'animation-for', targetElementId: '' }] })).toThrow('Element relations must contain supported semantic relations')
  })
})
