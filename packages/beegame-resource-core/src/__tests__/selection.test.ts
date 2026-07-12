import { describe, expect, test } from 'bun:test'
import type { ResourceElement, ResourcePack } from '../types'
import { selectResourceCandidates } from '../selection'

const published3dPack: ResourcePack = {
  id: 'fantasy-pack', name: 'Fantasy Environment', style: 'Fantasy / Stylized', gameTypes: ['RPG'],
  dimension: '3D', primaryCategory: '3d-assets', categories: ['models', 'textures'],
  license: 'internal', version: '1.2.0', status: 'published',
}

const elements: ResourceElement[] = [
  { id: 'oak-glb', packId: 'fantasy-pack', name: 'Oak', path: 'models/oak.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' },
  { id: 'draft-oak', packId: 'draft-pack', name: 'Draft oak', path: 'models/oak.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' },
  { id: 'broken-oak', packId: 'fantasy-pack', name: 'Broken oak', path: 'models/broken.glb', category: 'models', kind: 'model', specs: {}, dependencies: ['missing-texture'], status: 'ready' },
]

describe('resource selection', () => {
  test('selects only published ready elements compatible with a 3D environment slot', () => {
    const result = selectResourceCandidates(
      [published3dPack, { ...published3dPack, id: 'draft-pack', status: 'draft' }],
      elements,
      [{ slotId: 'environment.tree', category: 'models', dimension: '3D', acceptedFormats: ['glb'], styles: ['Fantasy'], gameTypes: ['RPG'] }],
    )

    expect(result.selections).toEqual([expect.objectContaining({ slotId: 'environment.tree', packId: 'fantasy-pack', elementId: 'oak-glb' })])
    expect(result.selections[0]?.reasons).toEqual(expect.arrayContaining(['category:models', 'format:glb', 'dimension:3D', 'style:Fantasy', 'game-type:RPG']))
  })

  test('uses element capabilities, not broad Pack tags, as a structured compatibility constraint', () => {
    const result = selectResourceCandidates(
      [{ ...published3dPack, tags: ['foliage', 'outdoor'] }],
      [{ id: 'oak', packId: published3dPack.id, name: 'Oak', path: 'models/oak.glb', category: 'models', kind: 'model', specs: {}, usageTags: ['vegetation'], dependencies: [], status: 'ready' }],
      [{ slotId: 'tree', category: 'models', tags: ['vegetation'], acceptedFormats: ['glb'] }],
    )
    expect(result.selections[0]).toEqual(expect.objectContaining({ elementId: 'oak', reasons: expect.arrayContaining(['tag:vegetation']) }))
    expect(selectResourceCandidates([{ ...published3dPack, tags: ['foliage'] }], [{ id: 'oak', packId: published3dPack.id, name: 'Oak', path: 'models/oak.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' }], [{ slotId: 'tree', tags: ['foliage'], acceptedFormats: ['glb'] }]).unmatchedSlotIds).toEqual(['tree'])
  })

  test('does not let a broad Pack tag make an unrelated element eligible', () => {
    const result = selectResourceCandidates(
      [{ ...published3dPack, tags: ['character'] }],
      [{ id: 'oak', packId: published3dPack.id, name: 'Oak', path: 'models/oak.glb', category: 'models', kind: 'model', specs: {}, usageTags: ['vegetation'], dependencies: [], status: 'ready' }],
      [{ slotId: 'tree', category: 'models', tags: ['character'], acceptedFormats: ['glb'] }],
    )
    expect(result.unmatchedSlotIds).toEqual(['tree'])
  })

  test('does not silently substitute a Pack with incompatible style, game type, or capability tag', () => {
    const result = selectResourceCandidates(
      [{ ...published3dPack, tags: ['environment'] }],
      [{ ...elements[0], path: 'models/oak.glb' }],
      [{ slotId: 'character', category: 'models', dimension: '3D', acceptedFormats: ['glb'], styles: ['Realistic'], gameTypes: ['Shooter'], tags: ['character'] }],
    )

    expect(result.selections).toEqual([])
    expect(result.unmatchedSlotIds).toEqual(['character'])
  })

  test('accepts an element capability tag even when the Pack has only broad tags', () => {
    const result = selectResourceCandidates(
      [{ ...published3dPack, tags: ['combat'], style: 'Stylized', gameTypes: ['Shooter'] }],
      [{ ...elements[0], usageTags: ['character'] }],
      [{ slotId: 'hero', category: 'models', tags: ['character'], acceptedFormats: ['glb'], styles: ['Stylized'], gameTypes: ['Shooter'] }],
    )

    expect(result.selections[0]).toEqual(expect.objectContaining({ elementId: 'oak-glb', reasons: expect.arrayContaining(['tag:character']) }))
  })

  test('treats style and game type as explainable fit preferences, not exclusions', () => {
    const result = selectResourceCandidates(
      [{ ...published3dPack, style: 'Minimal', gameTypes: ['Puzzle'] }],
      [{ ...elements[0], usageTags: ['ui'], path: 'ui/hud.ttf', category: 'fonts', kind: 'font' }],
      [{ slotId: 'hud-font', category: 'fonts', acceptedFormats: ['ttf'], tags: ['ui'], styles: ['Tactical'], gameTypes: ['FPS'] }],
    )

    expect(result.selections[0]).toEqual(expect.objectContaining({
      elementId: 'oak-glb',
      reasons: expect.arrayContaining(['style:unmatched', 'game-type:unmatched', 'tag:ui']),
    }))
  })

  test('retains legacy serialized usage tags only for existing elements during migration', () => {
    const result = selectResourceCandidates(
      [published3dPack],
      [{ ...elements[0], specs: { usageTags: JSON.stringify(['vegetation']) } }],
      [{ slotId: 'tree', category: 'models', tags: ['vegetation'], acceptedFormats: ['glb'] }],
    )

    expect(result.selections[0]).toEqual(expect.objectContaining({ elementId: 'oak-glb' }))
  })

  test('uses stable Pack and element ids as a deterministic tie break', () => {
    const result = selectResourceCandidates(
      [{ ...published3dPack, id: 'z-pack' }, { ...published3dPack, id: 'a-pack' }],
      [
        { ...elements[0], id: 'z-model', packId: 'z-pack' },
        { ...elements[0], id: 'b-model', packId: 'a-pack' },
        { ...elements[0], id: 'a-model', packId: 'a-pack' },
      ],
      [{ slotId: 'tree', category: 'models', acceptedFormats: ['glb'] }],
    )

    expect(result.selections[0]?.packId).toBe('a-pack')
    expect(result.selections[0]?.elementId).toBe('a-model')
  })

  test('does not select a technically unbounded candidate', () => {
    const result = selectResourceCandidates(
      [published3dPack],
      [{ ...elements[0], usageTags: ['environment'] }],
      [{ slotId: 'scene', category: 'models', tags: ['environment'] }],
    )

    expect(result).toEqual({ selections: [], unmatchedSlotIds: ['scene'] })
  })

  test('returns an explicit recursive dependency closure with original relative references', () => {
    const result = selectResourceCandidates(
      [published3dPack],
      [
        { id: 'scene', packId: published3dPack.id, name: 'Scene', path: 'models/scene.glb', category: 'models', kind: 'model', specs: {}, dependencies: ['surface'], dependencyBindings: [{ referencePath: 'materials/surface.gltf', dependencyElementId: 'surface' }], status: 'ready' },
        { id: 'surface', packId: published3dPack.id, name: 'Surface', path: 'materials/surface.gltf', category: 'materials', kind: 'material', specs: {}, dependencies: ['image'], dependencyBindings: [{ referencePath: '../images/base.png', dependencyElementId: 'image' }], status: 'ready' },
        { id: 'image', packId: published3dPack.id, name: 'Image', path: 'images/base.png', category: 'textures', kind: 'image', specs: {}, dependencies: [], status: 'ready' },
      ],
      [{ slotId: 'scene', category: 'models', acceptedFormats: ['glb'] }],
    )

    expect(result.selections[0]?.dependencies).toEqual([
      expect.objectContaining({ key: 'root.0', parentKey: 'root', elementId: 'surface', referencePath: 'materials/surface.gltf' }),
      expect.objectContaining({ key: 'root.0.0', parentKey: 'root.0', elementId: 'image', referencePath: '../images/base.png' }),
    ])
  })
})
