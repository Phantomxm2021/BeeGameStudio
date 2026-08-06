import { describe, expect, test } from 'bun:test'
import {
  createInMemoryResourceRepository,
  type ResourceElement,
  type ResourcePack,
} from '../repository'

const pack: ResourcePack = {
  id: 'pack-1',
  name: 'Example Pack',
  styles: ['Stylized'],
  gameTypes: ['adventure'],
  dimension: '2D',
  primaryCategory: 'ui-kit',
  categories: ['sprites', 'ui'],
  license: 'internal',
  version: '1.0.0',
  status: 'published',
}

const element: ResourceElement = {
  id: 'element-1',
  packId: 'pack-1',
  name: 'Character Idle',
  path: 'characters/idle.png',
  category: 'sprites',
  kind: 'sprite-sheet',
  preview: { kind: 'image', path: 'previews/idle.png' },
  specs: { width: 256, height: 256, frames: 4, contentHash: 'a'.repeat(64) },
  assetKind: 'sprite-sheet',
  usageTags: ['character'],
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
    await expect(repository.listElements('pack-1', 'sprites')).resolves.toEqual([
      { ...element, usageTagsMode: 'override', usageTagsSource: 'element' },
    ])
    await expect(repository.listElements('pack-1', 'ui')).resolves.toEqual([])
  })

  test('resolves Pack and closest-folder usage defaults without changing technical metadata', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [{ ...pack, elementDefaults: { usageTags: ['prop'] } }],
      elements: [{ ...element, usageTags: undefined, usageTagsMode: 'inherit', path: 'characters/heroes/idle.png' }],
    })
    await repository.createFolder('pack-1', { id: 'characters', name: 'characters', elementDefaults: { usageTags: ['npc'] } })
    await repository.createFolder('pack-1', { id: 'heroes', name: 'heroes', parentId: 'characters', elementDefaults: { usageTags: ['character'] } })

    await expect(repository.getElement('pack-1', 'element-1')).resolves.toEqual(expect.objectContaining({
      usageTags: ['character'], usageTagsMode: 'inherit', usageTagsSource: 'folder', kind: 'sprite-sheet',
    }))
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

  test('reactivates an archived Pack by publishing it and clears its archive marker', async () => {
    const archivedAt = '2026-07-12T00:00:00.000Z'
    const repository = createInMemoryResourceRepository({
      packs: [{ ...pack, status: 'archived', deprecatedAt: archivedAt }],
      elements: [element],
    })

    const published = await repository.publishPack(pack.id)

    expect(published).toEqual({ ...pack, status: 'published' })
    const stored = await repository.getPack(pack.id)
    expect(stored).toEqual(expect.objectContaining({ ...pack, status: 'published' }))
    expect(stored).not.toHaveProperty('deprecatedAt')
  })

  test('recursively deletes a folder with nested folders and elements', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [pack],
      elements: [
        element,
        { ...element, id: 'element-2', name: 'Tree', path: 'characters/forest/tree.png' },
        { ...element, id: 'element-3', name: 'UI', path: 'ui/button.png', category: 'ui' },
      ],
    })
    await repository.createFolder('pack-1', { id: 'characters', name: 'characters' })
    await repository.createFolder('pack-1', { id: 'forest', name: 'forest', parentId: 'characters' })
    await repository.createFolder('pack-1', { id: 'ui', name: 'ui' })

    await expect(repository.deleteFolder('pack-1', 'characters')).resolves.toBe(true)
    await expect(repository.listElements('pack-1')).resolves.toEqual([expect.objectContaining({ id: 'element-3' })])
    await expect(repository.listFolders('pack-1')).resolves.toEqual([expect.objectContaining({ id: 'ui' })])
  })
})
