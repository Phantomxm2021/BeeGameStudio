// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ReactElement } from 'react'
import { buildSafePublishFix, ResourceLibraryView } from './ResourceLibraryView'
import { closeResourcePackRoute } from './resourceLibraryRoute'
import { ResourceLibraryApiError, type ResourceElement, type ResourcePackSummary } from '../../services/resourceLibraryApi'
import { ToastProvider } from '../../contexts/ToastContext'

const pack: ResourcePackSummary = { id: 'pack-1', name: 'Example Pack', style: 'Stylized', gameTypes: ['adventure'], dimension: '2D', primaryCategory: 'world-scene', categories: ['models'], version: '1.0.0', status: 'published', elementCount: 1 }
const element: ResourceElement = { id: 'element-1', packId: 'pack-1', name: 'knight.png', path: 'models/knight.png', category: 'models', kind: 'image', specs: {}, dependencies: [], status: 'ready' }
const api = {
  createPack: async () => pack, listPacks: async () => [pack], getPack: async () => pack, listElements: async () => [element], getElement: async () => element,
  listFolders: async () => [], createFolder: async () => ({ id: 'folder-1', packId: pack.id, name: 'Models', path: 'Models' }), updateFolder: async () => ({ id: 'folder-1', packId: pack.id, name: 'Models', path: 'Models' }), deleteFolder: async () => undefined,
  addElement: async () => element, updateElement: async () => element, deleteElement: async () => undefined, getElementResourceUrl: async () => 'https://signed.example/knight.png', getPublishReadiness: async () => ({ canPublish: true, blocking: [], warnings: [] }), publishPack: async () => pack, updatePack: async () => pack, uploadPackCover: async () => pack, deletePack: async () => undefined,
  startProcessingJob: async () => ({ id: 'job-1', packId: pack.id, kind: 'inspect-elements' as const, status: 'completed' as const, totalItems: 0, completedItems: 0, failedItems: 0, createdAt: '', updatedAt: '' }), getLatestProcessingJob: async () => undefined, getProcessingJob: async () => ({ id: 'job-1', packId: pack.id, kind: 'inspect-elements' as const, status: 'completed' as const, totalItems: 0, completedItems: 0, failedItems: 0, createdAt: '', updatedAt: '' }), retryProcessingJob: async () => ({ id: 'job-1', packId: pack.id, kind: 'inspect-elements' as const, status: 'completed' as const, totalItems: 0, completedItems: 0, failedItems: 0, createdAt: '', updatedAt: '' }), cancelProcessingJob: async () => ({ id: 'job-1', packId: pack.id, kind: 'inspect-elements' as const, status: 'cancelled' as const, totalItems: 0, completedItems: 0, failedItems: 0, createdAt: '', updatedAt: '' }),
}

function renderResourceLibrary(view: ReactElement) {
  return render(<ToastProvider>{view}</ToastProvider>)
}

describe('ResourceLibraryView workspace', () => {
  afterEach(() => { cleanup(); closeResourcePackRoute() })

  test('mounts the Pack workspace with the explorer and no obsolete recursive rows', async () => {
    const user = userEvent.setup()
    renderResourceLibrary(<ResourceLibraryView apiClient={api} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    expect(screen.getByRole('tree', { name: 'Pack files' })).toBeInTheDocument()
    expect(screen.getByText('尚未选择文件')).toBeInTheDocument()
    const environment = screen.getByRole('treeitem', { name: '环境与道具' })
    await user.click(environment)
    await user.click(screen.getByRole('treeitem', { name: 'knight.png' }))
    expect(await screen.findByRole('button', { name: '显示元素信息' })).toBeInTheDocument()
  })

  test('does not expose a destructive Pack deletion action', async () => {
    const user = userEvent.setup()
    renderResourceLibrary(<ResourceLibraryView apiClient={api} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    expect(screen.queryByRole('button', { name: '删除 Pack' })).not.toBeInTheDocument()
  })

  test('does not reopen a Pack from a stale route prop after an explicit Back', async () => {
    const user = userEvent.setup()
    const rendered = renderResourceLibrary(<ResourceLibraryView apiClient={api} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    expect(screen.getByRole('tree', { name: 'Pack files' })).toBeInTheDocument()

    // A parent render while the detail route is open used to capture this id
    // as a fresh restoration request even though it belongs to the same view.
    rendered.rerender(<ToastProvider><ResourceLibraryView apiClient={api} initialPackId={pack.id} /></ToastProvider>)
    await user.click(screen.getByRole('button', { name: '返回资源包' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Example Pack' })).toBeInTheDocument())
    await new Promise(resolve => window.setTimeout(resolve, 20))
    expect(screen.queryByRole('tree', { name: 'Pack files' })).not.toBeInTheDocument()
    expect(new URL(window.location.href).searchParams.get('resourcePack')).toBeNull()
  })

  test('closes a completed analysis cover and shows a completion toast', async () => {
    const user = userEvent.setup()
    const runningJob = { id: 'job-running', packId: pack.id, kind: 'inspect-elements' as const, status: 'running' as const, totalItems: 1, completedItems: 0, failedItems: 0, createdAt: '', updatedAt: '' }
    const completedJob = { ...runningJob, status: 'completed' as const, completedItems: 1 }
    let completeJob!: () => void
    const terminalJob = new Promise<typeof completedJob>(resolve => { completeJob = () => resolve(completedJob) })
    renderResourceLibrary(<ResourceLibraryView apiClient={{
      ...api,
      getLatestProcessingJob: async () => runningJob,
      getProcessingJob: async () => terminalJob,
    }} />)

    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    completeJob()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), { timeout: 2_000 })
    expect(screen.getByRole('alert')).toHaveTextContent(/(资源分析完成，共处理 1 个元素|Resource analysis complete\. 1 elements processed)/)
  })

  test('offers re-publishing for archived Packs', async () => {
    const user = userEvent.setup()
    const archivedPack = { ...pack, status: 'archived' as const, deprecatedAt: '2026-07-12T00:00:00.000Z' }
    const publishPack = vi.fn(async () => ({ ...pack, status: 'published' as const }))
    renderResourceLibrary(<ResourceLibraryView apiClient={{ ...api, listPacks: async () => [archivedPack], getPack: async () => archivedPack, publishPack }} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    const rePublish = screen.getByRole('button', { name: '重新发布' })
    expect(rePublish).toBeEnabled()
    await user.click(rePublish)
    await waitFor(() => expect(publishPack).toHaveBeenCalledWith(pack.id))
  })

  test('separates read-only element information from editable configuration', async () => {
    const user = userEvent.setup()
    renderResourceLibrary(<ResourceLibraryView apiClient={api} />)
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

  test('edits typed asset capabilities and semantic relations without filename inference', async () => {
    const user = userEvent.setup()
    const inspectedElement = { ...element, contentProfile: { packaging: 'self-contained' as const, components: [{ id: 'clip:0', kind: 'animation-clip', name: 'Take 001' }], inspection: { status: 'complete' as const, source: 'server' as const } } }
    const rig = { ...element, id: 'rig-1', name: 'hero-rig.glb', path: 'models/hero-rig.glb', assetKind: 'rig' }
    const updateElement = vi.fn(async (_packId: string, _elementId: string, body: Partial<ResourceElement>) => ({ ...element, ...body }))
    renderResourceLibrary(<ResourceLibraryView apiClient={{ ...api, listElements: async () => [inspectedElement, rig], updateElement }} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    await user.click(screen.getByRole('treeitem', { name: '环境与道具' }))
    await user.click(screen.getByRole('treeitem', { name: 'knight.png' }))
    await user.click(await screen.findByRole('button', { name: '显示元素信息' }))
    await user.click(screen.getByRole('tab', { name: '元素配置' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '资产类型' }), 'animation-library')
    await user.click(screen.getByRole('button', { name: '包含动画' }))
    await user.type(screen.getByPlaceholderText('例如 locomotion, combat'), 'locomotion')
    await user.click(screen.getByText('外部资产关系'))
    await user.click(screen.getByRole('button', { name: '添加关系' }))
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(updateElement).toHaveBeenCalledWith(pack.id, element.id, expect.objectContaining({
      assetKind: 'animation-library',
      capabilities: ['contains-animations'],
      contentProfile: expect.objectContaining({ components: [expect.objectContaining({ id: 'clip:0', roles: ['locomotion'] })] }),
      relations: [expect.objectContaining({ kind: 'uses-texture', targetElementId: rig.id, required: true })],
    })))
  })

  test('keeps failed uploads visible and allows retrying the original file', async () => {
    const user = userEvent.setup()
    const uploaded = { ...element, id: 'element-2', name: 'retry.png', path: 'models/retry.png' }
    const addElement = vi.fn()
      .mockRejectedValueOnce(new ResourceLibraryApiError('Unsupported file', 400, 'invalid_file'))
      .mockResolvedValueOnce(uploaded)
    renderResourceLibrary(<ResourceLibraryView apiClient={{ ...api, addElement }} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    const input = screen.getByLabelText('选择要添加的文件')
    await user.upload(input, new File(['asset'], 'retry.png', { type: 'image/png' }))
    expect(await screen.findByRole('button', { name: '重试失败文件' })).toBeInTheDocument()
    expect(addElement).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '重试失败文件' }))
    await waitFor(() => expect(addElement).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('status', { name: '正在上传资源' })).toHaveTextContent('100%')
  })

  test('dismisses the upload overlay after a failed upload', async () => {
    const user = userEvent.setup()
    const addElement = vi.fn().mockRejectedValue(new ResourceLibraryApiError('Unsupported file', 400, 'invalid_file'))
    renderResourceLibrary(<ResourceLibraryView apiClient={{ ...api, addElement }} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))

    await user.upload(
      screen.getByLabelText('选择要添加的文件'),
      new File(['asset'], 'broken.png', { type: 'image/png' }),
    )

    expect(await screen.findByRole('button', { name: '关闭' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭' }))

    await waitFor(() => expect(screen.queryByRole('status', { name: '正在上传资源' })).not.toBeInTheDocument())
  })

  test('never leaks the internal root node id into an uploaded file path', async () => {
    const user = userEvent.setup()
    const uploaded = { ...element, id: 'element-root-upload', name: 'crate.png', path: 'models/crate.png' }
    const addElement = vi.fn(async () => uploaded)
    renderResourceLibrary(<ResourceLibraryView apiClient={{ ...api, addElement }} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))

    fireEvent.contextMenu(screen.getByRole('tree', { name: 'Pack files' }))
    await user.click(screen.getByText(/^(上传文件|Upload files)$/))
    const file = new File(['asset'], 'crate.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择要添加的文件'), file)

    await waitFor(() => expect(addElement).toHaveBeenCalledWith(pack.id, file, 'models', 'models', expect.any(Object)))
  })

  test('shows structured publish blockers and can locate the affected element', async () => {
    const user = userEvent.setup()
    const draftPack = { ...pack, status: 'draft' }
    renderResourceLibrary(<ResourceLibraryView apiClient={{ ...api, listPacks: async () => [draftPack], getPack: async () => draftPack, getPublishReadiness: async () => ({ canPublish: false, blocking: [{ code: 'dependency_missing', message: 'Element knight.png references a missing dependency', elementId: element.id }], warnings: [] }) }} />)
    await user.click(await screen.findByRole('button', { name: 'Example Pack' }))
    await user.click(screen.getByRole('button', { name: '发布' }))
    const dialog = await screen.findByRole('dialog', { name: '发布检查' })
    expect(within(dialog).getByText('Element knight.png references a missing dependency')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '定位' }))
    expect(await screen.findByRole('button', { name: '显示元素信息' })).toBeInTheDocument()
  })

  test('only applies publish fixes that are structurally unambiguous', () => {
    const model = {
      ...element,
      id: 'model-1',
      name: 'world.fbx',
      category: 'environment',
      kind: 'model',
      usageTags: [],
      specs: { externalReferences: JSON.stringify(['Textures/stone.png']) },
      dependencies: [],
      dependencyBindings: [],
    }
    const texture = { ...element, id: 'texture-1', name: 'stone.png', path: 'models/Textures/stone.png', category: 'textures', kind: 'image' }

    expect(buildSafePublishFix(model, [model, texture])).toEqual({
      dependencyBindings: [{ referencePath: 'Textures/stone.png', dependencyElementId: 'texture-1' }],
      dependencies: ['texture-1'],
    })
    expect(buildSafePublishFix(model, [model, { ...texture, path: 'unrelated/stone.png' }])).toBeUndefined()
  })
})
