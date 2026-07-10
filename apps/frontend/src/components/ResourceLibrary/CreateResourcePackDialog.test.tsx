// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { CreateResourcePackDialog } from './CreateResourcePackDialog'

describe('CreateResourcePackDialog', () => {
  test('requires Pack metadata before creating', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<CreateResourcePackDialog open onClose={vi.fn()} onCreate={onCreate} />)
    await user.click(screen.getByRole('button', { name: '创建 Pack' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写 Pack 名称、风格和适用游戏类型')
    expect(onCreate).not.toHaveBeenCalled()
  })
})
