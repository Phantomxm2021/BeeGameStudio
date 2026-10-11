// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { CreateResourcePackDialog } from './CreateResourcePackDialog'
import i18n from '../../i18n'

const resourceText = (key: string) => i18n.t(`resourceLibrary:${key}`)

describe('CreateResourcePackDialog', () => {
  test('groups Pack metadata controls together', () => {
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={vi.fn()} />)

    const metadata = screen.getByTestId('create-pack-metadata')
    const nameInput = screen.getByPlaceholderText(resourceText('form.namePlaceholder'))
    expect(metadata).toHaveClass('sm:grid-cols-2')
    expect(metadata).toContainElement(nameInput)
    expect(metadata).toContainElement(screen.getByLabelText(resourceText('dimension')))
    expect(metadata).toContainElement(screen.getByLabelText(resourceText('category')))
    expect(nameInput.closest('label')).toHaveClass('sm:col-span-2')
  })

  test('uses the shared dialog typography and compact control rhythm', () => {
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={vi.fn()} />)

    expect(screen.getByRole('heading', { name: resourceText('create') })).toHaveClass('type-modal-title')
    expect(screen.queryByText('先定义风格与使用场景，再添加资源。')).not.toBeInTheDocument()
    expect(screen.queryByText('资源库')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(resourceText('form.namePlaceholder'))).toHaveClass('h-11', 'rounded-xl')
    expect(screen.getByRole('button', { name: resourceText('create') })).toHaveClass('h-11', 'type-button')
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
    await user.click(screen.getByRole('button', { name: resourceText('create') }))
    expect(screen.getByRole('alert')).toHaveTextContent(resourceText('createRequired'))
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('reuses project style and genre options with multi-select', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue({ id: 'pack-1' })
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={onCreate} />)
    await user.type(screen.getByPlaceholderText(resourceText('form.namePlaceholder')), 'Forest')
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
    await user.type(screen.getByPlaceholderText(resourceText('form.namePlaceholder')), 'Interface Kit')
    await user.selectOptions(screen.getByLabelText(resourceText('category')), 'ui-kit')
    await user.click(screen.getByRole('button', { name: 'Pixel' }))
    await user.click(screen.getByRole('button', { name: 'RPG' }))
    await user.click(screen.getByRole('button', { name: resourceText('create') }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ primaryCategory: 'ui-kit', categories: [] }))
  })

  test('renders newly added custom styles and game types as selected chips', async () => {
    const user = userEvent.setup()
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(resourceText('customStyle')), 'Watercolor')
    await user.click(screen.getAllByRole('button', { name: resourceText('add') })[0])
    await user.type(screen.getByPlaceholderText(resourceText('customGameType')), 'Rhythm')
    await user.click(screen.getAllByRole('button', { name: resourceText('add') })[1])

    expect(screen.getByRole('button', { name: 'Watercolor' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Rhythm' })).toHaveAttribute('aria-pressed', 'true')
  })
})
