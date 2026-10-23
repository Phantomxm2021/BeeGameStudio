import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCredits as useDashboardCredits } from './useCredits';
import { getCreditBalance, getCreditSummary } from '../services/creditsApi';

vi.mock('../services/creditsApi', () => ({ getCreditBalance: vi.fn(), getCreditSummary: vi.fn() }));

describe('dashboard credits refresh', () => {
  it('home only queries the wallet and shares the same backoff and logout gate', async () => {
    vi.mocked(getCreditBalance).mockRejectedValue(Object.assign(new Error('temporary'), { status: 503, code: 'authentication_unavailable' }));
    const view = renderHook(({ enabled }) => useDashboardCredits(undefined, enabled, 'user'), { initialProps: { enabled: true } });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); window.dispatchEvent(new Event('focus')); });
    expect(getCreditBalance).toHaveBeenCalledTimes(1);
    expect(getCreditSummary).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getCreditBalance).toHaveBeenCalledTimes(2);
    view.rerender({ enabled: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(getCreditBalance).toHaveBeenCalledTimes(2);
    view.unmount();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getCreditBalance).mockReset().mockResolvedValue({ balanceCredits: 42 } as never);
    vi.mocked(getCreditSummary).mockReset().mockResolvedValue({ totalTokens: 10 } as never);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('does not query until authenticated and stops after logout', async () => {
    const view = renderHook(({ enabled }) => useDashboardCredits('project', enabled, 'user'), { initialProps: { enabled: false } });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getCreditBalance).not.toHaveBeenCalled();
    view.rerender({ enabled: true });
    await act(async () => {});
    expect(getCreditBalance).toHaveBeenCalledTimes(1);
    expect(getCreditBalance).toHaveBeenCalledWith(true);
    expect(getCreditSummary).toHaveBeenCalledWith('project', true);
    view.rerender({ enabled: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getCreditBalance).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('all triggers respect backoff, and success restores ordinary polling', async () => {
    vi.mocked(getCreditBalance).mockRejectedValue(Object.assign(new Error('temporary'), { status: 503, code: 'authentication_unavailable' }));
    const view = renderHook(() => useDashboardCredits('project', true, 'user'));
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('beegame:credits-updated'));
      await view.result.current.refreshCredits();
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getCreditBalance).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getCreditBalance).toHaveBeenCalledTimes(2);
    vi.mocked(getCreditBalance).mockResolvedValue({ balanceCredits: 45 } as never);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(getCreditBalance).toHaveBeenCalledTimes(3);
    expect(view.result.current.creditBalance?.balanceCredits).toBe(45);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getCreditBalance).toHaveBeenCalledTimes(4);
    view.unmount();
  });

  it('a definitive 401 blocks further credit requests until a new login', async () => {
    vi.mocked(getCreditBalance).mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    const view = renderHook(({ enabled }) => useDashboardCredits('project', enabled, 'user'), { initialProps: { enabled: true } });
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); await view.result.current.refreshCredits(); });
    expect(getCreditBalance).toHaveBeenCalledTimes(1);
    view.rerender({ enabled: false });
    vi.mocked(getCreditBalance).mockResolvedValue({ balanceCredits: 45 } as never);
    view.rerender({ enabled: true });
    await act(async () => {});
    expect(getCreditBalance).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('coalesces concurrent triggers and discards an old project response', async () => {
    let resolveBalance!: (value: never) => void;
    vi.mocked(getCreditBalance).mockImplementationOnce(() => new Promise(resolve => { resolveBalance = resolve; }));
    const view = renderHook(({ project }) => useDashboardCredits(project, true, 'user'), { initialProps: { project: 'old' } });
    act(() => { void view.result.current.refreshCredits(); window.dispatchEvent(new Event('focus')); });
    expect(getCreditBalance).toHaveBeenCalledTimes(1);
    view.rerender({ project: 'new' });
    await act(async () => {});
    expect(getCreditBalance).toHaveBeenCalledTimes(2);
    await act(async () => { resolveBalance({ balanceCredits: 999 } as never); });
    expect(view.result.current.creditBalance?.balanceCredits).toBe(42);
    view.unmount();
  });
});
