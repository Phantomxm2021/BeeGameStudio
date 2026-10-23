import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToast } from './useToast';

describe('BeUI toast lifecycle adapter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('deduplicates simultaneous notices and expires each toast once without a second view timer', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showError('same failure');
      result.current.showError('same failure');
      result.current.showSuccess('saved');
    });
    expect(result.current.toasts).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(2);
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.toasts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not restart expiry when a new notice arrives and clears timers on unmount', () => {
    const { result, unmount } = renderHook(() => useToast());
    act(() => result.current.showSuccess('first'));
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.showWarning('second'));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.toasts.map(item => item.message)).toEqual(['second']);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the existing warning, manual dismissal and dismiss-all APIs', () => {
    const { result } = renderHook(() => useToast());
    act(() => { result.current.showWarning('warning'); result.current.showError('error'); });
    expect(result.current.toasts[0].type).toBe('warning');
    act(() => result.current.dismissToast(result.current.toasts[0].id));
    expect(result.current.toasts).toHaveLength(1);
    act(() => result.current.dismissAll());
    expect(result.current.toasts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
