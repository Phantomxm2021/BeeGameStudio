// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { CreateResourcePackDialog } from './CreateResourcePackDialog'

const { showError } = vi.hoisted(() => ({ showError: vi.fn() }))
vi.mock('../../contexts/ToastContext', () => ({ useToastContext: () => ({ showError }) }))

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText('例如：Painterly Forest'), 'Forest')
  await user.click(screen.getByRole('button', { name: '主分类' }))
  await user.click(screen.getByRole('option', { name: 'UI Kit' }))
  await user.click(screen.getByRole('button', { name: '风格' }))
  await user.click(await screen.findByRole('button', { name: 'Pixel' }))
  await user.click(screen.getByRole('button', { name: '适用游戏类型' }))
  await user.click(await screen.findByRole('button', { name: 'RPG' }))
}

describe('CreateResourcePackDialog', () => {
  test('keeps the first page compact with vertically stacked style and game-type fields', () => {
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: '创建 Pack' })
    const metadata = screen.getByTestId('create-pack-metadata')
    expect(dialog).toHaveClass('h-[480px]', 'max-w-[600px]')
    expect(metadata).toContainElement(screen.getByPlaceholderText('例如：Painterly Forest'))
    expect(metadata).toContainElement(screen.getByRole('button', { name: '维度' }))
    expect(metadata).toContainElement(screen.getByRole('button', { name: '主分类' }))
    expect(metadata).toContainElement(screen.getByRole('button', { name: '风格' }))
    expect(metadata).toContainElement(screen.getByRole('button', { name: '适用游戏类型' }))
    expect(screen.queryByText('可多选')).not.toBeInTheDocument()
    expect(screen.queryByText('描述')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续' })).toHaveClass('rounded-full')
  })

  test('requires basic metadata before continuing', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    showError.mockClear()
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={onCreate} />)

    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(showError).toHaveBeenCalledWith('请填写 Pack 名称、风格和适用游戏类型，并选择主分类')
    expect(screen.getByRole('heading', { name: '创建 Pack' })).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('uses separate pages with back navigation and preserves selections', async () => {
    const user = userEvent.setup()
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={vi.fn()} />)
    await fillRequired(user)

    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByRole('heading', { name: '更多信息' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回基本信息' })).toBeInTheDocument()
    expect(screen.getByLabelText('授权证明')).toBeInTheDocument()
    expect(screen.queryByText('兼容目标')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回基本信息' }))
    expect(screen.getByRole('heading', { name: '创建 Pack' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '风格：Pixel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '适用游戏类型：RPG' })).toBeInTheDocument()
  })

  test('creates only from the second page and keeps failure visible through the global toast', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockRejectedValue(new Error('Creation failed'))
    showError.mockClear()
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={onCreate} />)
    await fillRequired(user)

    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(onCreate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '创建 Pack' }))
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Creation failed'))
    expect(screen.getByRole('heading', { name: '更多信息' })).toBeInTheDocument()
  })

  test('submits independently selected styles, game types, category, and tags', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue({ id: 'pack-1' })
    render(<CreateResourcePackDialog open availableTags={['Forest', 'Nature']} onClose={vi.fn()} onCreate={onCreate} />)
    await fillRequired(user)

    await user.click(screen.getByRole('button', { name: '继续' }))
    await user.click(screen.getByRole('button', { name: '标签' }))
    await user.click(await screen.findByRole('button', { name: 'Forest' }))
    await user.click(screen.getByRole('button', { name: 'Nature' }))
    const tagTrigger = screen.getByRole('button', { name: '标签：Forest，Nature' })
    expect(tagTrigger.querySelector('.truncate')).toBeInTheDocument()
    expect(tagTrigger.querySelector('.overflow-hidden')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '创建 Pack' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Forest', primaryCategory: 'ui-kit', categories: [], styles: ['Pixel'], gameTypes: ['RPG'], tags: ['Forest', 'Nature'],
    })))
  })

  test('adds custom style, game type, and tag values without losing earlier choices', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue({ id: 'pack-1' })
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={onCreate} />)
    await fillRequired(user)

    await user.click(screen.getByRole('button', { name: '风格：Pixel' }))
    await user.type(screen.getByPlaceholderText('添加自定义风格'), 'Watercolor{enter}')
    await user.click(screen.getByRole('button', { name: '适用游戏类型：RPG' }))
    await user.type(screen.getByPlaceholderText('添加自定义类型'), 'Rhythm{enter}')
    await user.click(screen.getByRole('button', { name: '继续' }))
    await user.click(screen.getByRole('button', { name: '标签' }))
    await user.type(screen.getByPlaceholderText('添加标签'), 'Forest, Fantasy{enter}')
    await user.click(screen.getByRole('button', { name: '创建 Pack' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      styles: ['Pixel', 'Watercolor'], gameTypes: ['RPG', 'Rhythm'], tags: ['Forest', 'Fantasy'],
    })))
  })
})
