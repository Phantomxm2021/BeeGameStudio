// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ResourceLibraryView } from './ResourceLibraryView'
import { closeResourcePackRoute } from './resourceLibraryRoute'
import { ResourceLibraryApiError, type ResourceElement, type ResourcePackSummary } from '../../services/resourceLibraryApi'

const pack: ResourcePackSummary = { id: 'pack-1', name: 'Example Pack', style: 'Stylized', gameTypes: ['adventure'], dimension: '2D', primaryCategory: 'world-scene', categories: ['models'], version: '1.0.0', status: 'published', elementCount: 1 }
const element: ResourceElement = { id: 'element-1', packId: 'pack-1', name: 'knight.png', path: 'models/knight.png', category: 'models', kind: 'image', specs: {}, dependencies: [], status: 'ready' }
const api = {
  createPack: async () => pack, listPacks: async () => [pack], getPack: async () => pack, listElements: async () => [element], getElement: async () => element,
  listFolders: async () => [], createFolder: async () => ({ id: 'folder-1', packId: pack.id, name: 'Models', path: 'Models' }), updateFolder: async () => ({ id: 'folder-1', packId: pack.id, name: 'Models', path: 'Models' }), deleteFolder: async () => undefined,
  addElement: async () => element, updateElement: async () => element, deleteElement: async () => undefined, getElementResourceUrl: async () => 'https://signed.example/knight.png', getPublishReadiness: async () => ({ canPublish: true, blocking: [], warnings: [] }), publishPack: async () => pack, updatePack: async () => pack, uploadPackCover: async () => pack, deletePack: async () => undefined,
}

describe('ResourceLibraryView workspace', () => {
  afterEach(() => { cleanup(); closeResourcePackRoute() })

  test('mounts the Pack workspace with the explorer and no obsolete recursive rows', async () => {
    const user = userEvent.setup()
    render(<ResourceLibraryView apiClient={api} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    expect(screen.getByRole('tree', { name: 'Pack files' })).toBeInTheDocument()
    expect(screen.getByText('尚未选择文件')).toBeInTheDocument()
    const environment = screen.getByRole('treeitem', { name: '环境与道具' })
    await user.click(environment)
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

  test('separates read-only element information from editable configuration', async () => {
    const user = userEvent.setup()
    render(<ResourceLibraryView apiClient={api} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    await user.click(screen.getByRole('treeitem', { name: '环境与道具' }))
    await user.click(screen.getByRole('treeitem', { name: 'knight.png' }))
    await user.click(await screen.findByRole('button', { name: '显示元素信息' }))
    expect(screen.getByRole('tab', { name: '元素信息' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: '保存配置' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '元素配置' }))
    expect(screen.getByRole('button', { name: '保存配置' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '模型' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '3D 模型' })).toBeInTheDocument()
  })

  test('keeps failed uploads visible and allows retrying the original file', async () => {
    const user = userEvent.setup()
    const uploaded = { ...element, id: 'element-2', name: 'retry.png', path: 'models/retry.png' }
    const addElement = vi.fn()
      .mockRejectedValueOnce(new ResourceLibraryApiError('Unsupported file', 400, 'invalid_file'))
      .mockResolvedValueOnce(uploaded)
    render(<ResourceLibraryView apiClient={{ ...api, addElement }} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    const input = screen.getByLabelText('选择要添加的文件')
    await user.upload(input, new File(['asset'], 'retry.png', { type: 'image/png' }))
    expect(await screen.findByRole('button', { name: '重试失败文件' })).toBeInTheDocument()
    expect(addElement).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '重试失败文件' }))
    await waitFor(() => expect(addElement).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('status', { name: '正在上传资源' })).toHaveTextContent('100%')
  })

  test('shows structured publish blockers and can locate the affected element', async () => {
    const user = userEvent.setup()
    const draftPack = { ...pack, status: 'draft' }
    render(<ResourceLibraryView apiClient={{ ...api, listPacks: async () => [draftPack], getPack: async () => draftPack, getPublishReadiness: async () => ({ canPublish: false, blocking: [{ code: 'dependency_missing', message: 'Element knight.png references a missing dependency', elementId: element.id }], warnings: [] }) }} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    await user.click(screen.getByRole('button', { name: '发布' }))
    const dialog = await screen.findByRole('dialog', { name: '发布检查' })
    expect(within(dialog).getByText('Element knight.png references a missing dependency')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '定位' }))
    expect(await screen.findByRole('button', { name: '显示元素信息' })).toBeInTheDocument()
  })
})
