// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ResourceLibraryView } from './ResourceLibraryView'
import { closeResourcePackRoute } from './resourceLibraryRoute'
import type { ResourceElement, ResourcePackSummary } from '../../services/resourceLibraryApi'

const pack: ResourcePackSummary = { id: 'pack-1', name: 'Example Pack', style: 'Stylized', gameTypes: ['adventure'], dimension: '2D', primaryCategory: 'world-scene', categories: ['models'], version: '1.0.0', status: 'published', elementCount: 1 }
const element: ResourceElement = { id: 'element-1', packId: 'pack-1', name: 'knight.png', path: 'models/knight.png', category: 'models', kind: 'image', specs: {}, dependencies: [], status: 'ready' }
const api = {
  createPack: async () => pack, listPacks: async () => [pack], getPack: async () => pack, listElements: async () => [element], getElement: async () => element,
  listFolders: async () => [], createFolder: async () => ({ id: 'folder-1', packId: pack.id, name: 'Models', path: 'Models' }), updateFolder: async () => ({ id: 'folder-1', packId: pack.id, name: 'Models', path: 'Models' }), deleteFolder: async () => undefined,
  addElement: async () => element, updateElement: async () => element, deleteElement: async () => undefined, getElementResourceUrl: async () => 'https://signed.example/knight.png', publishPack: async () => pack, updatePack: async () => pack, uploadPackCover: async () => pack, deletePack: async () => undefined, importPack: async () => pack,
}

describe('ResourceLibraryView workspace', () => {
  afterEach(() => { cleanup(); closeResourcePackRoute() })

  test('mounts the Pack workspace with the explorer and no obsolete recursive rows', async () => {
    const user = userEvent.setup()
    render(<ResourceLibraryView apiClient={api} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    expect(screen.getByRole('tree', { name: 'Pack files' })).toBeInTheDocument()
    expect(screen.getByText('尚未选择文件')).toBeInTheDocument()
    const models = screen.getByRole('treeitem', { name: '模型' })
    await user.click(models)
    await user.click(screen.getByRole('treeitem', { name: 'knight.png' }))
    expect(await screen.findByRole('button', { name: '显示元素信息' })).toBeInTheDocument()
  })

  test('uses a separate typed confirmation dialog for destructive Pack deletion', async () => {
    const user = userEvent.setup()
    const deletePack = vi.fn(async () => undefined)
    render(<ResourceLibraryView apiClient={{ ...api, deletePack }} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    await user.click(screen.getByRole('button', { name: '删除 Pack' }))
    const dialog = screen.getByRole('dialog', { name: '删除 Pack' })
    expect(within(dialog).getByRole('button', { name: '删除 Pack' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText('输入 Pack 名称以确认'), pack.name)
    await user.click(within(dialog).getByRole('button', { name: '删除 Pack' }))
    await waitFor(() => expect(deletePack).toHaveBeenCalledWith(pack.id))
    expect(screen.queryByRole('button', { name: '返回资源包' })).not.toBeInTheDocument()
  })
})
