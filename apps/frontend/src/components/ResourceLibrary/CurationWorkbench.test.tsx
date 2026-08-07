// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import React from 'react'
import { CurationWorkbench, type ResourceCurationApi } from './CurationWorkbench'
import type { ResourceCurationQueue } from '../../services/resourceLibraryApi'

const queue: ResourceCurationQueue = {
  items: [
    { id: 'element-a', packId: 'pack-1', name: 'Element A', path: 'models/a.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' },
    { id: 'element-b', packId: 'pack-1', name: 'Element B', path: 'models/b.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' },
  ],
  counts: { pendingItems: 2, missingSemanticTags: 2, technicalIssues: 0, dependencyIssues: 0 },
  usageTagOptions: ['building', 'environment'],
}

function apiWithQueue(): ResourceCurationApi {
  return { getCurationQueue: vi.fn(async () => queue) }
}

describe('Resource Library curation workbench', () => {
  test('shows resource processing as a durable AI tab', async () => {
    const user = userEvent.setup()
    const api = apiWithQueue() as ResourceCurationApi & { startSemanticCuration: ReturnType<typeof vi.fn>; getSemanticCurationJob: ReturnType<typeof vi.fn> }
    api.startSemanticCuration = vi.fn(async () => ({ id: 'job-1', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'running' as const, totalItems: 2, completedItems: 1, failedItems: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }))
    api.getSemanticCurationJob = vi.fn(async () => ({ id: 'job-1', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'completed' as const, totalItems: 2, completedItems: 2, failedItems: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }))
    render(<CurationWorkbench packId="pack-1" api={api} />)

    await user.click(await screen.findByRole('tab', { name: 'AI 处理' }))
    await user.click(await screen.findByRole('button', { name: 'AI 整理用途' }))

    await waitFor(() => expect(api.startSemanticCuration).toHaveBeenCalledWith('pack-1', undefined))
    expect(await screen.findByRole('status')).toHaveTextContent(/处理中|已完成/)
  })

  test('does not render a manual suggestion confirmation path', async () => {
    render(<CurationWorkbench packId="pack-1" api={apiWithQueue()} />)

    expect(await screen.findByText('待分析资源')).toBeInTheDocument()
    expect(screen.queryByText('系统建议')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拒绝建议' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '批量确认各自建议' })).not.toBeInTheDocument()
  })

  test('shows automatic tag application after a completed job', async () => {
    const api = apiWithQueue() as ResourceCurationApi & { getLatestSemanticCurationJob: ReturnType<typeof vi.fn> }
    api.getLatestSemanticCurationJob = vi.fn(async () => ({ id: 'job-1', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'completed' as const, totalItems: 2, completedItems: 2, failedItems: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:10.000Z' }))
    render(<CurationWorkbench packId="pack-1" api={api} />)

    await userEvent.setup().click(await screen.findByRole('tab', { name: 'AI 处理' }))
    expect(await screen.findByText('没有失败项，标签已自动写入。')).toBeInTheDocument()
  })

  test('shows failed rows directly in the processing list', async () => {
    const api = apiWithQueue() as ResourceCurationApi & { startSemanticCuration: ReturnType<typeof vi.fn> }
    api.startSemanticCuration = vi.fn(async () => ({
      id: 'job-1', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'failed' as const,
      totalItems: 2, completedItems: 1, failedItems: 1, failures: [{ elementId: 'element-b', error: '资源证据不可用' }],
      usage: { inputTokens: 100, cacheReadTokens: 20, cacheCreationTokens: 5, outputTokens: 30, totalTokens: 155, creditsMicro: 700 },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:02:41.000Z',
    }))
    render(<CurationWorkbench packId="pack-1" api={api} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: 'AI 处理' }))
    await user.click(await screen.findByRole('button', { name: 'AI 整理用途' }))

    expect(await screen.findByText('资源证据不可用')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '处理失败' })).toHaveTextContent('×')
  })
})
