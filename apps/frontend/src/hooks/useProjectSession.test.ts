import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../types/message'
import { useProjectSession } from './useProjectSession'

const { chat, project, system, getChatHistory, loadHistory, refreshRuntime } = vi.hoisted(() => {
  const loadHistory = vi.fn<(messages: Message[]) => void>()
  return {
    loadHistory,
    chat: { messages: [] as Message[], isStreaming: false, loadHistory },
    project: { activeProjectId: 'A' as string | null },
    system: { authenticationStatus: 'authenticated' as 'authenticated' | 'anonymous',
      currentUser: { id: 'user-a' } as { id: string } | null, setIsSyncing: vi.fn() },
    getChatHistory: vi.fn<(projectId: string) => Promise<unknown[]>>(),
    refreshRuntime: vi.fn<() => Promise<void>>(),
  }
})

vi.mock('../services/api', () => ({ api: { getChatHistory } }))
vi.mock('../store/chatStore', () => ({ useChatStore: Object.assign(
  (select: (state: typeof chat) => unknown) => select(chat), { getState: () => chat },
) }))
vi.mock('../store/projectStore', () => ({ useProjectStore: { getState: () => project } }))
vi.mock('../store/systemStore', () => ({ useSystemStore: Object.assign(
  (select: (state: typeof system) => unknown) => select(system), { getState: () => system },
) }))

const options = { projectId: 'A', enabled: true, refreshRuntime }
const rawMessage = (id: string) => ({ id, sender: 'beegame', content: id, timestamp: 100 })

beforeEach(() => {
  getChatHistory.mockReset().mockResolvedValue([])
  refreshRuntime.mockReset().mockResolvedValue(undefined)
  chat.messages = []
  chat.isStreaming = false
  chat.loadHistory = loadHistory
  loadHistory.mockReset().mockImplementation(messages => { chat.messages = messages })
  project.activeProjectId = 'A'
  system.authenticationStatus = 'authenticated'
  system.currentUser = { id: 'user-a' }
  system.setIsSyncing.mockClear()
})

describe('project session history and reconnect lifecycle', () => {
  it('loads initial history once, refreshes runtime on first connect, and reloads history on reconnect', async () => {
    const { result } = renderHook(() => useProjectSession(options))
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    expect(getChatHistory).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.onTransportOpen() })
    expect(refreshRuntime).toHaveBeenCalledTimes(1)
    expect(getChatHistory).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.onTransportOpen() })
    expect(refreshRuntime).toHaveBeenCalledTimes(2)
    expect(getChatHistory).toHaveBeenCalledTimes(2)
  })

  it.each(['project', 'account', 'unmount'] as const)('does not commit initial history after a %s boundary', async boundary => {
    let finish!: (history: unknown[]) => void
    getChatHistory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { result, rerender, unmount } = renderHook(props => useProjectSession(props), { initialProps: options })
    expect(result.current.historyReady).toBe(false)
    if (boundary === 'project') {
      project.activeProjectId = 'B'
      rerender({ ...options, projectId: 'B' })
    } else if (boundary === 'account') {
      system.currentUser = { id: 'user-b' }
      rerender(options)
    } else unmount()
    await act(async () => { finish([rawMessage('obsolete-initial')]) })
    expect(loadHistory).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'obsolete-initial' }),
    ]))
    if (boundary !== 'unmount') await waitFor(() => expect(result.current.historyReady).toBe(true))
  })

  it('reloads history when hot reload replaces the chat-store action', async () => {
    const { result, rerender } = renderHook(() => useProjectSession(options))
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    const replacement = vi.fn()
    chat.loadHistory = replacement
    rerender()
    await waitFor(() => expect(replacement).toHaveBeenCalledWith([]))
    expect(getChatHistory).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent synchronization requests for the same lifetime', async () => {
    const { result } = renderHook(() => useProjectSession(options))
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    let finish!: () => void
    refreshRuntime.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let first!: Promise<void>, second!: Promise<void>
    act(() => { first = result.current.synchronize(); second = result.current.synchronize() })
    expect(first).toBe(second)
    expect(refreshRuntime).toHaveBeenCalledTimes(1)
    expect(getChatHistory).toHaveBeenCalledTimes(1)
    await act(async () => { finish(); await first })
    expect(getChatHistory).toHaveBeenCalledTimes(2)
    expect(system.setIsSyncing).toHaveBeenLastCalledWith(false)
  })

  it('does not start old history reads or clear the new project sync indicator after switching projects', async () => {
    const { result, rerender } = renderHook(props => useProjectSession(props), { initialProps: options })
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    let finishA!: () => void, finishB!: () => void
    refreshRuntime.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve }))
    refreshRuntime.mockImplementationOnce(() => new Promise(resolve => { finishB = resolve }))
    let requestA!: Promise<void>, requestB!: Promise<void>
    act(() => { requestA = result.current.synchronize() })
    project.activeProjectId = 'B'
    rerender({ ...options, projectId: 'B' })
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    act(() => { requestB = result.current.synchronize() })
    system.setIsSyncing.mockClear()
    getChatHistory.mockClear()
    await act(async () => { finishA(); await requestA })
    expect(getChatHistory).not.toHaveBeenCalled()
    expect(system.setIsSyncing).not.toHaveBeenCalledWith(false)
    await act(async () => { finishB(); await requestB })
    expect(getChatHistory).toHaveBeenCalledWith('B')
    expect(system.setIsSyncing).toHaveBeenLastCalledWith(false)
  })

  it('does not overwrite streaming content that arrives during a history read', async () => {
    const { result } = renderHook(() => useProjectSession(options))
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    let finish!: (history: unknown[]) => void
    getChatHistory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    loadHistory.mockClear()
    let request!: Promise<void>
    act(() => { request = result.current.synchronize() })
    await waitFor(() => expect(finish).toBeDefined())
    chat.isStreaming = true
    chat.messages = [{ id: 'streaming-live', sender: 'beegame', content: 'Live output', timestamp: 100 }]
    await act(async () => { finish([rawMessage('stale-snapshot')]); await request })
    expect(loadHistory).not.toHaveBeenCalled()
    expect(chat.messages[0].content).toBe('Live output')
  })

  it('releases the sync indicator when the project closes before the view unmounts', async () => {
    const { result, unmount } = renderHook(() => useProjectSession(options))
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    let finish!: () => void
    refreshRuntime.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    let request!: Promise<void>
    act(() => { request = result.current.synchronize() })
    expect(system.setIsSyncing).toHaveBeenLastCalledWith(true)
    project.activeProjectId = null
    await act(async () => { finish(); await request })
    unmount()
    expect(system.setIsSyncing).toHaveBeenLastCalledWith(false)
  })

  it('keeps optimistic bootstrap hints when the server history is empty', async () => {
    chat.messages = [{ id: 'bootstrap', sender: 'system', content: 'Starting', timestamp: 100 }]
    const { result } = renderHook(() => useProjectSession(options))
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    expect(getChatHistory).toHaveBeenCalledWith('A')
    expect(loadHistory).not.toHaveBeenCalled()
    expect(chat.messages[0].id).toBe('bootstrap')
  })

  it('keeps transport gated after a failed initial read and allows an explicit synchronization to recover', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    getChatHistory.mockRejectedValueOnce(new Error('history unavailable'))
    try {
      const { result } = renderHook(() => useProjectSession(options))
      await waitFor(() => expect(error).toHaveBeenCalled())
      expect(result.current.historyReady).toBe(false)
      await act(async () => { await result.current.synchronize() })
      expect(result.current.historyReady).toBe(true)
      expect(getChatHistory).toHaveBeenCalledTimes(2)
    } finally { error.mockRestore() }
  })

  it('does not load history while disabled or signed out', async () => {
    const { result, rerender } = renderHook(props => useProjectSession(props), {
      initialProps: { ...options, enabled: false },
    })
    expect(getChatHistory).not.toHaveBeenCalled()
    expect(result.current.historyReady).toBe(false)
    system.authenticationStatus = 'anonymous'
    rerender(options)
    expect(getChatHistory).not.toHaveBeenCalled()
    system.authenticationStatus = 'authenticated'
    rerender(options)
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    expect(getChatHistory).toHaveBeenCalledTimes(1)
  })
})
