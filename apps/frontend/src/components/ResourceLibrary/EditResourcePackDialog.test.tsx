// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { ResourcePackSummary } from '../../services/resourceLibraryApi'
import { EditResourcePackDialog } from './EditResourcePackDialog'

const pack: ResourcePackSummary = {
  id: 'pack-1', name: 'Forest Pack',
  styles: ['Pixel', 'Fantasy'],
  gameTypes: ['RPG'], dimension: '2D', primaryCategory: '2d-art', categories: [], elementCount: 3,
}

describe('EditResourcePackDialog', () => {
  test('reuses the create dialog layout and typography', () => {
    render(<EditResourcePackDialog open pack={pack} onClose={vi.fn()} onUploadCover={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getByTestId('edit-pack-dialog')).toHaveClass('max-w-[640px]', 'max-h-[calc(100dvh-48px)]')
    expect(screen.getByTestId('resource-pack-content')).toHaveClass('overflow-y-auto')
    expect(screen.getByRole('heading', { name: '编辑 Pack' })).toHaveClass('type-modal-title')
    expect(screen.getByLabelText('名称')).toHaveClass('h-11', 'rounded-xl')
    expect(screen.getByRole('button', { name: '保存 Pack' })).toHaveClass('h-11', 'type-button')
  })

  test('uploads a selected cover before saving Pack metadata', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    const onUploadCover = vi.fn(async () => { calls.push('cover'); return { ...pack, coverPath: 'cover/new.png' } })
    const onSave = vi.fn(async () => { calls.push('metadata'); return { ...pack, name: 'Updated Forest' } })
    render(<EditResourcePackDialog open pack={pack} onClose={vi.fn()} onUploadCover={onUploadCover} onSave={onSave} />)

    const name = screen.getByLabelText('名称')
    await user.clear(name)
    await user.type(name, 'Updated Forest')
    await user.upload(screen.getByLabelText('上传封面'), new File(['cover'], 'new-cover.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '保存 Pack' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated Forest', primaryCategory: '2d-art', dimension: '2D', gameTypes: ['RPG'] })))
    expect(calls).toEqual(['cover', 'metadata'])
  })

  test('keeps deletion outside the metadata editor', () => {
    render(<EditResourcePackDialog open pack={pack} onClose={vi.fn()} onUploadCover={vi.fn()} onSave={vi.fn()} />)
    expect(screen.queryByText('危险区域')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('输入 Pack 名称以确认')).not.toBeInTheDocument()
  })

  test('preserves custom style and game-type metadata', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(pack)
    render(<EditResourcePackDialog open pack={pack} onClose={vi.fn()} onUploadCover={vi.fn()} onSave={onSave} />)

    await user.type(screen.getByPlaceholderText('添加自定义风格'), 'Low Poly')
    await user.click(screen.getAllByRole('button', { name: '添加' })[0])
    await user.type(screen.getByPlaceholderText('添加自定义类型'), 'Survival')
    await user.click(screen.getAllByRole('button', { name: '添加' })[1])
    await user.click(screen.getByRole('button', { name: '保存 Pack' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ styles: ['Pixel', 'Fantasy', 'Low Poly'], gameTypes: ['RPG', 'Survival'] })))
  })
})
