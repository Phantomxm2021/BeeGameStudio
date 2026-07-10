// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { ResourcePackSummary } from '../../services/resourceLibraryApi'
import { EditResourcePackDialog } from './EditResourcePackDialog'

const pack: ResourcePackSummary = {
  id: 'pack-1', name: 'Forest Pack', style: 'Pixel / Fantasy', gameTypes: ['RPG'], dimension: '2D', primaryCategory: '2d-art', categories: [], elementCount: 3,
}

describe('EditResourcePackDialog', () => {
  test('uploads a selected cover before saving Pack metadata', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    const onUploadCover = vi.fn(async () => { calls.push('cover'); return { ...pack, coverPath: 'cover/new.png' } })
    const onSave = vi.fn(async () => { calls.push('metadata'); return { ...pack, name: 'Updated Forest' } })
    render(<EditResourcePackDialog open pack={pack} onClose={vi.fn()} onUploadCover={onUploadCover} onSave={onSave} onDelete={vi.fn()} />)

    const name = screen.getByLabelText('名称')
    await user.clear(name)
    await user.type(name, 'Updated Forest')
    await user.upload(screen.getByLabelText('上传封面'), new File(['cover'], 'new-cover.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '保存 Pack' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated Forest', primaryCategory: '2d-art', dimension: '2D', gameTypes: ['RPG'] })))
    expect(calls).toEqual(['cover', 'metadata'])
  })

  test('requires the exact Pack name before deletion', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(<EditResourcePackDialog open pack={pack} onClose={vi.fn()} onUploadCover={vi.fn()} onSave={vi.fn()} onDelete={onDelete} />)

    expect(screen.getByRole('button', { name: '确认删除 Pack' })).toBeDisabled()
    await user.type(screen.getByLabelText('输入 Pack 名称以确认'), pack.name)
    await user.click(screen.getByRole('button', { name: '确认删除 Pack' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce())
  })

  test('preserves custom style and game-type metadata', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(pack)
    render(<EditResourcePackDialog open pack={pack} onClose={vi.fn()} onUploadCover={vi.fn()} onSave={onSave} onDelete={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('添加自定义风格'), 'Low Poly')
    await user.click(screen.getByRole('button', { name: '添加自定义风格' }))
    await user.type(screen.getByPlaceholderText('添加自定义类型'), 'Survival')
    await user.click(screen.getByRole('button', { name: '添加自定义类型' }))
    await user.click(screen.getByRole('button', { name: '保存 Pack' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ style: 'Pixel / Fantasy / Low Poly', gameTypes: ['RPG', 'Survival'] })))
  })
})
