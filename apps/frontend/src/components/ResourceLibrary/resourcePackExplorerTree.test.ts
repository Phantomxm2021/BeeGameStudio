import { describe, expect, test } from 'vitest'
import type { ResourceElement, ResourceFolder, ResourcePackSummary } from '../../services/resourceLibraryApi'
import { buildExplorerTree } from './resourcePackExplorerTree'

const pack: ResourcePackSummary = {
  id: 'pack-1',
  name: 'Fantasy Pack',
  style: 'Stylized',
  dimension: '3D',
  primaryCategory: '3d-assets',
  categories: [],
  elementCount: 4,
}

const folders: ResourceFolder[] = [
  { id: 'parent', packId: pack.id, name: 'Parent', path: 'parent' },
  { id: 'nested', packId: pack.id, name: 'Nested', path: 'parent/nested', parentId: 'parent' },
]

const elements: ResourceElement[] = [
  { id: 'parent-file', packId: pack.id, name: 'parent.png', path: 'parent/parent.png', category: 'textures', kind: 'image', specs: {}, dependencies: [], status: 'ready' },
  { id: 'nested-file', packId: pack.id, name: 'nested.png', path: 'parent/nested/nested.png', category: 'textures', kind: 'image', specs: {}, dependencies: [], status: 'ready' },
  { id: 'model-file', packId: pack.id, name: 'knight.glb', path: 'models/knight.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' },
  { id: 'texture-file', packId: pack.id, name: 'diffuse.png', path: 'textures/diffuse.png', category: 'textures', kind: 'image', specs: {}, dependencies: [], status: 'ready' },
]

describe('buildExplorerTree', () => {
  test('preserves the Pack root and places files only under their direct persisted parent folder', () => {
    const tree = buildExplorerTree(pack, folders, elements)
    const parent = tree.children?.find((node) => node.id === 'folder:parent')
    const nested = parent?.children?.find((node) => node.id === 'folder:nested')

    expect(tree).toMatchObject({ id: 'root', kind: 'folder', name: 'Fantasy Pack' })
    expect(parent?.children?.map((node) => node.id)).toEqual(['file:parent-file', 'folder:nested'])
    expect(nested?.children?.map((node) => node.id)).toEqual(['file:nested-file'])
  })

  test('creates deterministic category folders for files outside persisted folders', () => {
    const tree = buildExplorerTree(pack, folders, elements)

    expect(tree.children?.map((node) => node.id)).toEqual([
      'folder:parent',
      'category:models',
      'category:textures',
    ])
    expect(tree.children?.find((node) => node.id === 'category:models')).toMatchObject({
      kind: 'folder',
      name: 'models',
      children: [expect.objectContaining({ id: 'file:model-file' })],
    })
    expect(tree.children?.find((node) => node.id === 'category:textures')).toMatchObject({
      children: [expect.objectContaining({ id: 'file:texture-file' })],
    })
  })

  test('does not attach a descendant to a folder when its direct parent path differs', () => {
    const tree = buildExplorerTree(pack, [folders[0]], [elements[1]])

    expect(tree.children?.find((node) => node.id === 'folder:parent')?.children).toEqual([])
    expect(tree.children?.find((node) => node.id === 'category:textures')?.children).toEqual([
      expect.objectContaining({ id: 'file:nested-file' }),
    ])
  })

  test('deterministically collapses legacy duplicate paths so every direct file remains reachable', () => {
    const duplicateFolders: ResourceFolder[] = [
      { id: 'folder-b', packId: pack.id, name: 'Second', path: 'shared' },
      { id: 'folder-a', packId: pack.id, name: 'First', path: 'shared' },
    ]
    const sharedFile: ResourceElement = { ...elements[0], id: 'shared-file', name: 'file.png', path: 'shared/file.png' }

    const tree = buildExplorerTree(pack, duplicateFolders, [sharedFile])

    expect(tree.children).toEqual([
      expect.objectContaining({
        id: 'folder:folder-a',
        children: [expect.objectContaining({ id: 'file:shared-file' })],
      }),
    ])
  })
})
