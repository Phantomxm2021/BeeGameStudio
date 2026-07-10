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

  test('uses stable Pack and element ids as a deterministic tie break', () => {
    const result = selectResourceCandidates(
      [{ ...published3dPack, id: 'z-pack' }, { ...published3dPack, id: 'a-pack' }],
      [
        { ...elements[0], id: 'z-model', packId: 'z-pack' },
        { ...elements[0], id: 'b-model', packId: 'a-pack' },
        { ...elements[0], id: 'a-model', packId: 'a-pack' },
      ],
      [{ slotId: 'tree', category: 'models' }],
    )

    expect(result.selections[0]?.packId).toBe('a-pack')
    expect(result.selections[0]?.elementId).toBe('a-model')
  })
})
