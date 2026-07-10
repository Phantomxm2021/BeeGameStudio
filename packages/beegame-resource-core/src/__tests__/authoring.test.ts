import { describe, expect, test } from 'bun:test'
import { createInMemoryResourceRepository } from '../repository'

describe('resource pack authoring domain', () => {
  test('creates and lists folders in tree order', async () => {
    const repository = createInMemoryResourceRepository({ packs: [], elements: [] })
    const pack = await repository.createPack({
      id: 'pack-1', name: 'Forest', style: 'Painterly', gameTypes: ['adventure'],
      dimension: 'agnostic', primaryCategory: 'world-scene', categories: ['environment'], license: 'internal', version: '0.1.0', status: 'draft',
    })
    const root = await repository.createFolder(pack.id, { id: 'folder-root', name: 'Environment' })
    await repository.createFolder(pack.id, { id: 'folder-child', name: 'Trees', parentId: root.id })

    expect(await repository.listFolders(pack.id)).toEqual([
      expect.objectContaining({ id: 'folder-root', path: 'Environment' }),
      expect.objectContaining({ id: 'folder-child', path: 'Environment/Trees', parentId: root.id }),
    ])
  })

  test('blocks publishing while uploads are incomplete', async () => {
    const repository = createInMemoryResourceRepository({ packs: [], elements: [{
      id: 'element-1', packId: 'pack-2', name: 'Panel', path: 'UI/panel.png', category: 'ui', kind: 'image',
      specs: {}, dependencies: [], status: 'failed',
    }] })
    await repository.createPack({
      id: 'pack-2', name: 'UI', style: 'Clean', gameTypes: ['puzzle'],
      dimension: '2D', primaryCategory: 'ui-kit', categories: ['ui'], license: 'internal', version: '0.1.0', status: 'draft',
    })
    await expect(repository.publishPack('pack-2')).rejects.toThrow('incomplete uploads')
  })
})
