import { render, screen } from '@testing-library/react'
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
})
