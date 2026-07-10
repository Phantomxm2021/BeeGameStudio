// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { CreateResourcePackDialog } from './CreateResourcePackDialog'

describe('CreateResourcePackDialog', () => {
  test('groups Pack metadata controls together', () => {
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={vi.fn()} />)

    const metadata = screen.getByTestId('create-pack-metadata')
    const nameInput = screen.getByPlaceholderText('例如：Painterly Forest')
    expect(metadata).toHaveClass('sm:grid-cols-2')
    expect(metadata).toContainElement(nameInput)
    expect(metadata).toContainElement(screen.getByLabelText('维度'))
    expect(metadata).toContainElement(screen.getByLabelText('主分类'))
    expect(nameInput.closest('label')).toHaveClass('sm:col-span-2')
  })

  test('uses the shared dialog typography and compact control rhythm', () => {
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '创建 Pack' })).toHaveClass('type-modal-title')
    expect(screen.getByText('先定义风格与使用场景，再添加资源。')).toHaveClass('type-body')
    expect(screen.getByText('资源库')).toHaveClass('type-label')
    expect(screen.getByPlaceholderText('例如：Painterly Forest')).toHaveClass('h-11', 'rounded-xl')
    expect(screen.getByRole('button', { name: '创建 Pack' })).toHaveClass('h-11', 'type-button')
  })

  test('keeps the dialog compact and scrolls only its form content', () => {
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={vi.fn()} />)

    expect(screen.getByTestId('create-pack-dialog')).toHaveClass('max-w-[640px]', 'max-h-[calc(100dvh-48px)]')
    expect(screen.getByTestId('create-pack-content')).toHaveClass('overflow-y-auto')
  })

  test('requires Pack metadata before creating', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={onCreate} />)
    await user.click(screen.getByRole('button', { name: '创建 Pack' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写 Pack 名称、风格和适用游戏类型')
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('reuses project style and genre options with multi-select', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue({ id: 'pack-1' })
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={onCreate} />)
    await user.type(screen.getByPlaceholderText('例如：Painterly Forest'), 'Forest')
    await user.click(screen.getByRole('button', { name: 'Pixel' }))
    await user.click(screen.getByRole('button', { name: 'Fantasy' }))
    await user.click(screen.getByRole('button', { name: 'RPG' }))
    await user.click(screen.getByRole('button', { name: 'Adventure' }))
    // Style and game type selections are independent multi-select controls.
    expect(screen.getByRole('button', { name: 'Pixel' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'RPG' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('submits the selected Pack primary category separately from contained categories', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue({ id: 'pack-1' })
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={onCreate} />)
    await user.type(screen.getByPlaceholderText('例如：Painterly Forest'), 'Interface Kit')
    await user.selectOptions(screen.getByLabelText('主分类'), 'ui-kit')
    await user.click(screen.getByRole('button', { name: 'Pixel' }))
    await user.click(screen.getByRole('button', { name: 'RPG' }))
    await user.click(screen.getByRole('button', { name: '创建 Pack' }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ primaryCategory: 'ui-kit', categories: [] }))
  })
})
