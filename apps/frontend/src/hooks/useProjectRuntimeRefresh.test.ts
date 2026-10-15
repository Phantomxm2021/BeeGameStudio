import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectRuntimeRefresh } from './useProjectRuntimeRefresh';

const loadRuntime = vi.fn<(projectId: string) => Promise<void>>();
const showWarning = vi.fn();
const options = {
  projectId: 'A', enabled: true, userId: 'user-a', isBusy: false,
  loadRuntime, showWarning, timeoutMessage: 'timeout', failureMessage: 'failed',
};
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const flush = async () => { await act(async () => {}); };
const authError = { status: 503, code: 'authentication_unavailable', retryAfterMs: 5000 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  loadRuntime.mockReset().mockResolvedValue(undefined);
  showWarning.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('automatic project runtime refresh', () => {
  it('initially reads even when idle or hidden, but does not poll while idle', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    renderHook(() => useProjectRuntimeRefresh(options));
    expect(loadRuntime).toHaveBeenCalledExactlyOnceWith('A');
    await advance(12_000);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('throttles usage at 2.5 seconds without delaying the first pending refresh', async () => {
    const { result } = renderHook(() => useProjectRuntimeRefresh(options));
    await flush();
    act(() => result.current('usage'));
    await advance(2000);
    act(() => result.current('usage'));
    await advance(499);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    act(() => result.current('usage'));
    await advance(2500);
    expect(loadRuntime).toHaveBeenCalledTimes(3);
  });

  it.each(['status_finished', 'status_failed', 'tool_start', 'tool_end', 'human_gate', 'error', 'permission_resolved'])(
    'debounces %s for 2 seconds after the last significant event', async type => {
      const { result } = renderHook(() => useProjectRuntimeRefresh(options));
      act(() => result.current(type));
      await advance(1500);
      act(() => result.current(type));
      await advance(1999);
      expect(loadRuntime).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(loadRuntime).toHaveBeenCalledTimes(2);
    },
  );

  it('leaves billing and unrelated events to their existing owners', async () => {
    const { result } = renderHook(() => useProjectRuntimeRefresh(options));
    act(() => { result.current('billing_update'); result.current('status_running'); result.current('unknown'); });
    await advance(3000);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
  });

  it('does not strand usage refresh after A → B → A with pending timers', async () => {
    const { result, rerender } = renderHook(props => useProjectRuntimeRefresh(props), { initialProps: options });
    act(() => result.current('usage'));
    rerender({ ...options, projectId: 'B' });
    act(() => result.current('usage'));
    rerender(options);
    act(() => result.current('usage'));
    await advance(2500);
    expect(loadRuntime.mock.calls.map(([id]) => id)).toEqual(['A', 'B', 'A', 'A']);
  });

  it.each(['logout', 'account', 'unmount'] as const)('cancels queued event reads at the %s boundary', async boundary => {
    const { result, rerender, unmount } = renderHook(props => useProjectRuntimeRefresh(props), { initialProps: options });
    act(() => { result.current('usage'); result.current('tool_end'); });
    if (boundary === 'logout') rerender({ ...options, enabled: false });
    else if (boundary === 'account') rerender({ ...options, userId: 'user-b' });
    else unmount();
    const calls = loadRuntime.mock.calls.length;
    await advance(12_000);
    expect(loadRuntime).toHaveBeenCalledTimes(calls);
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('polls every second only while busy and visible, and immediately on becoming visible', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const { rerender } = renderHook(props => useProjectRuntimeRefresh(props), { initialProps: options });
    await flush();
    rerender({ ...options, isBusy: true });
    const calls = loadRuntime.mock.calls.length;
    await advance(3000);
    expect(loadRuntime).toHaveBeenCalledTimes(calls);
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await flush();
    expect(loadRuntime).toHaveBeenCalledTimes(calls + 1);
    await advance(1000);
    expect(loadRuntime).toHaveBeenCalledTimes(calls + 2);
  });

  it('does not overlap periodic polls while an earlier poll is pending', async () => {
    let finish!: () => void;
    loadRuntime.mockImplementationOnce(async () => {}).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderHook(() => useProjectRuntimeRefresh({ ...options, isBusy: true }));
    await advance(5000);
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); });
    await advance(1000);
    expect(loadRuntime).toHaveBeenCalledTimes(3);
  });

  it('does not repeat initial sync or reset authentication backoff on busy/language/callback changes', async () => {
    const busyOptions = { ...options, isBusy: true };
    const { rerender } = renderHook(props => useProjectRuntimeRefresh(props), { initialProps: busyOptions });
    await flush();
    loadRuntime.mockRejectedValueOnce(authError);
    await advance(1000); // retry deadline = 6000
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    rerender({ ...busyOptions, isBusy: false, timeoutMessage: '超时', failureMessage: '失败', showWarning: vi.fn() });
    rerender({ ...busyOptions, timeoutMessage: '超时', failureMessage: '失败', showWarning: vi.fn() });
    await advance(4999);
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(loadRuntime).toHaveBeenCalledTimes(3);
  });

  it('uses the latest localized warning without restarting a pending initial read, and warns only once', async () => {
    let reject!: (error: Error) => void;
    loadRuntime.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const { rerender } = renderHook(props => useProjectRuntimeRefresh(props), { initialProps: options });
    const nextWarning = vi.fn();
    await advance(5000);
    rerender({ ...options, timeoutMessage: '超时', showWarning: nextWarning });
    await advance(5000);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(nextWarning).toHaveBeenCalledExactlyOnceWith('超时');
    expect(showWarning).not.toHaveBeenCalled();
    await act(async () => { reject(new Error('late failure')); });
    expect(nextWarning).toHaveBeenCalledTimes(1);
  });

  it('reports initial failure with its message or localized fallback', async () => {
    loadRuntime.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(null);
    const { rerender } = renderHook(props => useProjectRuntimeRefresh(props), { initialProps: options });
    await flush();
    expect(showWarning).toHaveBeenLastCalledWith('network');
    rerender({ ...options, projectId: 'B', failureMessage: '失败' });
    await flush();
    expect(showWarning).toHaveBeenLastCalledWith('失败');
  });

  it('ignores late errors from the obsolete project and removes all timers/listeners on unmount', async () => {
    let reject!: (error: Error) => void;
    loadRuntime.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const { result, rerender, unmount } = renderHook(props => useProjectRuntimeRefresh(props), { initialProps: options });
    act(() => { result.current('usage'); result.current('tool_end'); });
    rerender({ ...options, projectId: 'B' });
    await act(async () => { reject(new Error('obsolete')); });
    expect(showWarning).not.toHaveBeenCalled();
    unmount();
    const calls = loadRuntime.mock.calls.length;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await advance(30_000);
    expect(loadRuntime).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});
