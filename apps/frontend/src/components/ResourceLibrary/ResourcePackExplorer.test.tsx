import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { ExplorerNode } from './resourcePackExplorerTree'
import { ResourcePackExplorer } from './ResourcePackExplorer'

const knight = {
  id: 'element-knight',
  packId: 'pack-1',
  name: 'knight.glb',
  path: 'models/knight.glb',
  category: 'models',
  kind: 'model',
  specs: {},
  dependencies: [],
  status: 'ready' as const,
}

const tree: ExplorerNode = {
  id: 'root',
  kind: 'folder',
  name: 'Stylized Fantasy Worlds',
  children: [
    {
      id: 'folder:models',
      kind: 'folder',
      name: 'Models',
      children: [{ id: 'file:knight', kind: 'file', name: 'knight.glb', element: knight }],
    },
    { id: 'folder:empty', kind: 'folder', name: 'Materials', children: [] },
  ],
}

describe('ResourcePackExplorer', () => {
  test('toggles folders without selecting an element', async () => {
    const user = userEvent.setup()
    const onElement = vi.fn()
    render(<ResourcePackExplorer tree={tree} onElement={onElement} />)

    await user.click(screen.getByRole('treeitem', { name: 'Models' }))

    expect(onElement).not.toHaveBeenCalled()
    expect(screen.getByRole('treeitem', { name: 'knight.glb' })).toBeInTheDocument()
  })

  test('selects files and exposes a standard accessible tree', async () => {
    const user = userEvent.setup()
    const onElement = vi.fn()
    render(<ResourcePackExplorer tree={tree} onElement={onElement} />)

    expect(screen.getByRole('tree', { name: 'Pack files' })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: 'Materials' })).toBeInTheDocument()
    await user.click(screen.getByRole('treeitem', { name: 'Models' }))
    await user.click(screen.getByRole('treeitem', { name: 'knight.glb' }))

    expect(onElement).toHaveBeenCalledWith(knight)
  })

  test('moves focus through the tree and activates only files with Enter', async () => {
    const user = userEvent.setup()
    const onElement = vi.fn()
    render(<ResourcePackExplorer tree={tree} onElement={onElement} />)

    const models = screen.getByRole('treeitem', { name: 'Models' })
    await user.click(models)
    expect(models).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    const file = screen.getByRole('treeitem', { name: 'knight.glb' })
    expect(file).toHaveFocus()
    expect(file).not.toHaveAttribute('aria-expanded')

    await user.keyboard('{Enter}')
    expect(onElement).toHaveBeenCalledWith(knight)
  })

  test('offers capability-based context actions for empty space and persisted folders', () => {
    const onCreateFolder = vi.fn()
    const onUpload = vi.fn()
    const onRenameFolder = vi.fn()
    const onDeleteFolder = vi.fn()
    const persistedTree: ExplorerNode = { ...tree, children: [{ ...tree.children![0], folder: { id: 'models', packId: 'pack-1', name: 'Models', path: 'Models' } }] }
    render(<ResourcePackExplorer tree={persistedTree} onElement={vi.fn()} onCreateFolder={onCreateFolder} onUploadToFolder={onUpload} onRenameFolder={onRenameFolder} onDeleteFolder={onDeleteFolder} labels={{ newFolder: 'New folder', upload: 'Upload files', rename: 'Rename', delete: 'Delete' }} />)
    fireEvent.contextMenu(screen.getByRole('tree'))
    expect(screen.getByText('New folder')).toBeInTheDocument()
    expect(screen.getByText('Upload files')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'Models' }))
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})
