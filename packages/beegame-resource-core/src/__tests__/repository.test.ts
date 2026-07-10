import { describe, expect, test } from 'bun:test'
import {
  createInMemoryResourceRepository,
  type ResourceElement,
  type ResourcePack,
} from '../repository'

const pack: ResourcePack = {
  id: 'pack-1',
  name: 'Example Pack',
  style: 'Stylized',
  gameTypes: ['adventure'],
  dimension: '2D',
  primaryCategory: 'ui-kit',
  categories: ['characters', 'ui'],
  license: 'internal',
  version: '1.0.0',
  status: 'published',
}

const element: ResourceElement = {
  id: 'element-1',
  packId: 'pack-1',
  name: 'Character Idle',
  path: 'characters/idle.png',
  category: 'characters',
  kind: 'sprite-sheet',
  preview: { kind: 'image', path: 'previews/idle.png' },
  specs: { width: 256, height: 256, frames: 4 },
  dependencies: [],
  status: 'ready',
}

describe('in-memory resource repository', () => {
  test('lists Pack summaries with element counts', async () => {
    const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
    await expect(repository.listPacks()).resolves.toEqual([
      { ...pack, elementCount: 1 },
    ])
  })

  test('lists elements by Pack and category', async () => {
    const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
    await expect(repository.listElements('pack-1', 'characters')).resolves.toEqual([element])
    await expect(repository.listElements('pack-1', 'ui')).resolves.toEqual([])
  })

  test('returns undefined for an unknown Pack', async () => {
    const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
    await expect(repository.getPack('missing')).resolves.toBeUndefined()
  })

  test('deletes a Pack with its elements and folders', async () => {
    const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
    await repository.createFolder('pack-1', { id: 'folder-1', name: 'models' })

    await expect(repository.deletePack('pack-1')).resolves.toBe(true)
    await expect(repository.getPack('pack-1')).resolves.toBeUndefined()
    await expect(repository.listElements('pack-1')).resolves.toEqual([])
    await expect(repository.listFolders('pack-1')).resolves.toEqual([])
  })

  test('treats an already deleted Pack as absent', async () => {
    const repository = createInMemoryResourceRepository({ packs: [], elements: [] })

    await expect(repository.deletePack('missing')).resolves.toBe(false)
  })
})
