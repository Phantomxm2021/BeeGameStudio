import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProjectEventPolling } from './useProjectEventPolling';

const { pollMessages, streamMessages } = vi.hoisted(() => ({
  pollMessages: vi.fn(),
  streamMessages: vi.fn(),
}));

vi.mock('../services/apiClient', () => ({
  isAuthenticationServiceUnavailable: (error: { status?: number; code?: string }) =>
    error?.status === 503 && error?.code === 'authentication_unavailable',
}));

vi.mock('../services/beeGameAdapter', () => ({
  beeGameAdapter: { pollMessages, streamMessages },
}));

describe('useProjectEventPolling project event polling', () => {
  beforeEach(() => {
    pollMessages.mockReset();
    streamMessages.mockReset();
    pollMessages.mockResolvedValue({ lastEventId: 0, messages: [] });
    streamMessages.mockRejectedValue(Object.assign(new Error('SSE unsupported'), { status: 404 }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('does not replay from zero while initial history is still establishing its cursor', async () => {
    const { rerender } = renderHook(({ enabled }) => useProjectEventPolling({
      projectId: 'history-first', enabled, onMessage: vi.fn(),
    }), { initialProps: { enabled: false } });
    await act(async () => {});
    expect(streamMessages).not.toHaveBeenCalled();
    expect(pollMessages).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(streamMessages).toHaveBeenCalledTimes(1));
  });

  it('delivers persisted project events without opening a browser WebSocket', async () => {
    const NativeWebSocket = globalThis.WebSocket;
    const webSocketConstructor = vi.fn();
    vi.stubGlobal('WebSocket', webSocketConstructor);
    pollMessages.mockResolvedValueOnce({
      lastEventId: 7,
      messages: [{ type: 'token', task_id: 'task-1', sender: 'agent', content: 'progress' }],
    });
    const onMessage = vi.fn();
    const onOpen = vi.fn();

    const { result } = renderHook(() => useProjectEventPolling({
      projectId: 'project-1',
      onMessage,
      onOpen,
    }));

    await waitFor(() => expect(result.current.state).toBe('connected'));
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'progress' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(webSocketConstructor).not.toHaveBeenCalled();
    vi.stubGlobal('WebSocket', NativeWebSocket);
  });

  it('uses the SSE stream and advances its event cursor', async () => {
    streamMessages.mockImplementationOnce(async (
      _projectId: string,
      _afterEventId: number,
      callbacks: { onOpen?: () => void; onMessage: (message: unknown) => void; onCursor?: (id: number) => void },
      signal: AbortSignal,
    ) => {
      callbacks.onOpen?.();
      callbacks.onCursor?.(7);
      callbacks.onMessage({ type: 'token', task_id: 'task-1', sender: 'agent', content: 'streamed' });
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      return 7;
    });
    const onMessage = vi.fn();
    const { result, unmount } = renderHook(() => useProjectEventPolling({
      projectId: 'project-sse',
      onMessage,
    }));

    await waitFor(() => expect(result.current.state).toBe('connected'));
    expect(streamMessages).toHaveBeenCalledWith(
      'project-sse',
      0,
      expect.objectContaining({ onOpen: expect.any(Function), onCursor: expect.any(Function) }),
      expect.any(AbortSignal),
    );
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'streamed' }));
    unmount();
  });

  it('recovers polling without closing the active chat transport', async () => {
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    pollMessages
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ lastEventId: 0, messages: [] });
    const onClose = vi.fn();
    const onOpen = vi.fn();

    const { result } = renderHook(() => useProjectEventPolling({
      projectId: 'project-1',
      onMessage: vi.fn(),
      onClose,
      onOpen,
    }));

    await waitFor(() => expect(result.current.state).toBe('reconnecting'));
    await waitFor(() => expect(result.current.state).toBe('connected'), { timeout: 2_000 });
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(warningLog).toHaveBeenCalledWith('[ProjectEvents] Poll failed:', expect.any(TypeError));
    warningLog.mockRestore();
  });

  it('waits through an auth outage and resumes SSE from the delivered cursor without closing the task', async () => {
    vi.useFakeTimers();
    const outage = Object.assign(new Error('Auth unavailable'), {
      status: 503, code: 'authentication_unavailable', recoverable: true, retryAfterMs: 2000,
    });
    streamMessages.mockImplementationOnce(async (_project, _cursor, callbacks) => {
      callbacks.onOpen();
      callbacks.onMessage({ type: 'token', content: 'before outage' });
      callbacks.onCursor(42);
      throw outage;
    }).mockRejectedValueOnce(outage).mockRejectedValueOnce(outage)
      .mockImplementationOnce(async (_project, _cursor, callbacks, signal: AbortSignal) => {
        callbacks.onOpen();
        callbacks.onMessage({ type: 'token', content: 'after outage' });
        callbacks.onCursor(43);
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      });
    const onClose = vi.fn(), onMessage = vi.fn(), showToastError = vi.fn();
    const { result, unmount } = renderHook(() => useProjectEventPolling({
      projectId: 'recover-auth', onClose, onMessage, showToastError,
    }));
    await act(async () => {});
    expect(result.current.state).toBe('reconnecting');
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(streamMessages).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4001); });
    expect(result.current.state).toBe('connected');
    expect(streamMessages.mock.calls.map(call => call[1])).toEqual([0, 42, 42, 42]);
    expect(onMessage.mock.calls.map(([message]) => message.content)).toEqual(['before outage', 'after outage']);
    expect(showToastError).toHaveBeenCalledWith('登录验证服务暂时不可用，正在自动恢复连接');
    expect(onClose).not.toHaveBeenCalled();
    expect(pollMessages).not.toHaveBeenCalled();
    unmount();
  });

  it('stops polling when disconnected and can reconnect explicitly', async () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useProjectEventPolling({
      projectId: 'project-1',
      onMessage: vi.fn(),
      onClose,
    }));

    await waitFor(() => expect(result.current.state).toBe('connected'));
    act(() => result.current.disconnect());
    expect(result.current.state).toBe('disconnected');
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => result.current.reconnect());
    await waitFor(() => expect(result.current.state).toBe('connected'));
  });

  it('ignores a poll result that resolves after switching projects', async () => {
    let resolveFirstPoll: (value: { lastEventId: number; messages: unknown[] }) => void = () => undefined;
    const oldProjectCallback = vi.fn();
    const newProjectCallback = vi.fn();
    pollMessages.mockImplementation((projectId: string) => {
      if (projectId === 'project-1') {
        return new Promise((resolve) => { resolveFirstPoll = resolve; });
      }
      return Promise.resolve({
        lastEventId: 2,
        messages: [{ type: 'token', task_id: 'task-2', sender: 'agent', content: 'new-project' }],
      });
    });

    const { result, rerender } = renderHook(
      ({ projectId, onMessage }: { projectId: string; onMessage: ReturnType<typeof vi.fn> }) => useProjectEventPolling({ projectId, onMessage }),
      { initialProps: { projectId: 'project-1', onMessage: oldProjectCallback } },
    );
    await waitFor(() => expect(pollMessages).toHaveBeenCalledWith('project-1', 0));

    rerender({ projectId: 'project-2', onMessage: newProjectCallback });
    await waitFor(() => expect(result.current.state).toBe('connected'));
    expect(newProjectCallback).toHaveBeenCalledWith(expect.objectContaining({ content: 'new-project' }));

    await act(async () => {
      resolveFirstPoll({
        lastEventId: 1,
        messages: [{ type: 'token', task_id: 'task-1', sender: 'agent', content: 'old-project' }],
      });
      await Promise.resolve();
    });

    expect(oldProjectCallback).not.toHaveBeenCalled();
    expect(newProjectCallback).not.toHaveBeenCalledWith(expect.objectContaining({ content: 'old-project' }));
  });
});
