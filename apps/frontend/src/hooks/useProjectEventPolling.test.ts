import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProjectEventPolling } from './useProjectEventPolling';

const { pollMessages } = vi.hoisted(() => ({
  pollMessages: vi.fn(),
}));

vi.mock('../services/apiClient', () => ({
  isAuthenticationServiceUnavailable: () => false,
}));

vi.mock('../services/beeGameAdapter', () => ({
  beeGameAdapter: { pollMessages },
}));

describe('useProjectEventPolling project event polling', () => {
  beforeEach(() => {
    pollMessages.mockResolvedValue({ lastEventId: 0, messages: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
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
