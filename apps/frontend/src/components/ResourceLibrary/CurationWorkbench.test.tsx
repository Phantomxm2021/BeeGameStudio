// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import React from 'react'
import { CurationWorkbench, type ResourceCurationApi } from './CurationWorkbench'
import type { ResourceCurationQueue } from '../../services/resourceLibraryApi'

const queue: ResourceCurationQueue = {
  items: [
    {
      id: 'element-a', packId: 'pack-1', name: 'Element A', path: 'models/a.glb', category: 'models', kind: 'model',
      specs: {}, dependencies: [], status: 'ready',
      semanticSuggestion: {
        usageTags: ['building'], styles: [], relations: [], evidence: [{ source: 'content_profile', reference: 'test', observation: 'confirmed folder policy' }], confidence: 'high', generatedAt: '2026-01-01T00:00:00.000Z', generatorRevision: 'test',
      },
    },
    {
      id: 'element-b', packId: 'pack-1', name: 'Element B', path: 'models/b.glb', category: 'models', kind: 'model',
      specs: {}, dependencies: [], status: 'ready',
      semanticSuggestion: {
        usageTags: ['environment'], styles: [], relations: [], evidence: [{ source: 'content_profile', reference: 'test', observation: 'confirmed environment policy' }], confidence: 'high', generatedAt: '2026-01-01T00:00:00.000Z', generatorRevision: 'test',
      },
    },
  ],
  counts: { pendingSuggestions: 2, missingSemanticTags: 2, technicalIssues: 0, dependencyIssues: 0 },
  usageTagOptions: ['building', 'environment'],
}

function apiWithPendingSuggestion(): ResourceCurationApi {
  return {
    getCurationQueue: vi.fn(async () => queue),
    confirmCuration: vi.fn(async () => ({ updatedElementIds: ['element-a', 'element-b'], counts: { ...queue.counts, pendingSuggestions: 0 } })),
    rejectCuration: vi.fn(async () => ({ updatedElementIds: ['element-a', 'element-b'], counts: { ...queue.counts, pendingSuggestions: 0 } })),
  }
}

describe('Resource Library curation workbench', () => {
  test('starts one durable AI semantic job and shows its progress', async () => {
    const user = userEvent.setup()
    const api = apiWithPendingSuggestion() as ResourceCurationApi & { startSemanticCuration: ReturnType<typeof vi.fn>; getSemanticCurationJob: ReturnType<typeof vi.fn> }
    api.startSemanticCuration = vi.fn(async () => ({ id: 'job-1', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'running' as const, totalItems: 2, completedItems: 1, failedItems: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }))
    api.getSemanticCurationJob = vi.fn(async () => ({ id: 'job-1', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'completed' as const, totalItems: 2, completedItems: 2, failedItems: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }))
    render(<CurationWorkbench packId="pack-1" api={api} />)

    await user.click(await screen.findByRole('tab', { name: 'AI 处理' }))
    await user.click(await screen.findByRole('button', { name: 'AI 整理用途' }))

    await waitFor(() => expect(api.startSemanticCuration).toHaveBeenCalledWith('pack-1', undefined))
    expect(screen.getByRole('tab', { name: 'AI 处理' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('status')).toHaveTextContent(/处理中|已完成/)
  })

  test('keeps AI processing inside the resource curation dialog and shows durable usage and failed rows', async () => {
    const user = userEvent.setup()
    const api = apiWithPendingSuggestion() as ResourceCurationApi & { startSemanticCuration: ReturnType<typeof vi.fn> }
    api.startSemanticCuration = vi.fn(async () => ({
      id: 'job-1', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'failed' as const,
      totalItems: 3, completedItems: 1, failedItems: 1,
      failures: [{ elementId: 'element-b', error: '资源证据不可用' }],
      usage: { inputTokens: 100, cacheReadTokens: 20, cacheCreationTokens: 5, outputTokens: 30, totalTokens: 155, creditsMicro: 700 },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:02:41.000Z',
    }))
    render(<CurationWorkbench packId="pack-1" api={api} />)

    expect(screen.getByRole('tab', { name: '资源整理' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI 处理' })).toBeInTheDocument()
    await user.click(await screen.findByRole('tab', { name: 'AI 处理' }))
    await user.click(await screen.findByRole('button', { name: 'AI 整理用途' }))

    expect(await screen.findByText('阶段：处理失败')).toBeInTheDocument()
    expect(screen.getByText('运行时长：00:02:41')).toBeInTheDocument()
    expect(screen.getByText('输入')).toBeInTheDocument()
    expect(screen.queryByText('12,345')).not.toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('155')).toBeInTheDocument()
    expect(screen.getByText('0.0007')).toBeInTheDocument()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '处理失败' })).toHaveTextContent('×')
    expect(screen.getByText('资源证据不可用')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /查看失败项/ })).not.toBeInTheDocument()
    expect(screen.queryByText('资源语义整理')).not.toBeInTheDocument()
  })

  test('switches between resource selection and AI processing without creating another queue', async () => {
    const user = userEvent.setup()
    render(<CurationWorkbench packId="pack-1" api={apiWithPendingSuggestion()} />)

    await user.click(await screen.findByRole('tab', { name: 'AI 处理' }))
    expect(screen.getByRole('tab', { name: 'AI 处理' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('尚未开始 AI 整理')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '资源整理' }))
    expect(screen.getByText('系统建议')).toBeInTheDocument()
  })

  test('starts full semantic reanalysis from the AI tab without creating another client-side queue', async () => {
    const user = userEvent.setup()
    const api = apiWithPendingSuggestion() as ResourceCurationApi & { startSemanticCuration: ReturnType<typeof vi.fn> }
    api.startSemanticCuration = vi.fn(async (_packId: string, options?: { mode?: 'missing' | 'all' }) => ({
      id: 'job-all', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'queued' as const,
      totalItems: 2, completedItems: 0, failedItems: 0, analysisMode: options?.mode ?? 'missing', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }))
    render(<CurationWorkbench packId="pack-1" api={api} />)

    await user.click(await screen.findByRole('tab', { name: 'AI 处理' }))
    await user.click(screen.getByRole('button', { name: '重新全部分析' }))

    await waitFor(() => expect(api.startSemanticCuration).toHaveBeenCalledWith('pack-1', { mode: 'all' }))
    expect(await screen.findByText('阶段：准备处理')).toBeInTheDocument()
  })

  test('restores the latest durable job when the dialog is reopened', async () => {
    const api = apiWithPendingSuggestion() as ResourceCurationApi & { getLatestSemanticCurationJob: ReturnType<typeof vi.fn> }
    api.getLatestSemanticCurationJob = vi.fn(async () => ({
      id: 'job-1', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'completed' as const,
      totalItems: 2, completedItems: 2, failedItems: 0,
      usage: { inputTokens: 10, cacheReadTokens: 2, cacheCreationTokens: 0, outputTokens: 3, totalTokens: 15, creditsMicro: 4 },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:10.000Z',
    }))
    render(<CurationWorkbench packId="pack-1" api={api} />)

    await userEvent.setup().click(await screen.findByRole('tab', { name: 'AI 处理' }))
    expect(await screen.findByText('阶段：已完成')).toBeInTheDocument()
    expect(api.getLatestSemanticCurationJob).toHaveBeenCalledWith('pack-1')
  })

  test('shows pending suggestions for manual review', async () => {
    render(<CurationWorkbench packId="pack-1" api={apiWithPendingSuggestion()} />)
    expect(await screen.findByText('系统建议')).toBeInTheDocument()
    expect(screen.getByText(/已选\s*0\s*\/\s*2/)).toBeInTheDocument()
  })

  test('keeps the resource tab focused on manual review actions', async () => {
    const api = apiWithPendingSuggestion() as ResourceCurationApi & { startSemanticCuration: ReturnType<typeof vi.fn> }
    api.startSemanticCuration = vi.fn()
    render(<CurationWorkbench packId="pack-1" api={api} />)

    expect(await screen.findByText('系统建议')).toBeInTheDocument()
    expect(screen.getByText(/已选\s*0\s*\/\s*2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒绝建议' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量确认各自建议' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 整理用途' })).not.toBeInTheDocument()
    expect(screen.queryByText('待整理')).not.toBeInTheDocument()
    expect(screen.queryByText('缺少用途标签')).not.toBeInTheDocument()
    expect(screen.queryByText('技术问题')).not.toBeInTheDocument()
    expect(screen.queryByText('依赖问题')).not.toBeInTheDocument()
    expect(screen.queryByText('确认后建议会被清除，标签成为唯一可检索事实。')).not.toBeInTheDocument()
  })

  test('confirms one batch with each element decision and never shares tags across rows', async () => {
    const user = userEvent.setup()
    const api = apiWithPendingSuggestion()
    render(<CurationWorkbench packId="pack-1" api={api} />)
    expect(await screen.findByText(/已选\s*0\s*\/\s*2/)).toBeInTheDocument()
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0]!)
    await user.click(checkboxes[1]!)
    await user.click(await screen.findByRole('button', { name: '批量确认各自建议' }))
    await waitFor(() => expect(api.confirmCuration).toHaveBeenCalledWith('pack-1', expect.objectContaining({ decisions: [
      expect.objectContaining({ elementId: 'element-a', usageTags: ['building'] }),
      expect.objectContaining({ elementId: 'element-b', usageTags: ['environment'] }),
    ] })))
    expect(api.confirmCuration).toHaveBeenCalledTimes(1)
  })
})
