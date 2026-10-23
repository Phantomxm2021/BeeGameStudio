import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSettingsSectionLoad } from './useSettingsSectionLoad';

const options = { isOpen: true, allowed: true, selected: false, userId: 'user-a' };
const pendingLoad = () => new Promise<void>(() => {});

describe('settings section loading lifetime', () => {
  it('loads on first selection and keeps the load current across navigation', () => {
    const load = vi.fn<(isCurrent: () => boolean) => Promise<void>>(pendingLoad);
    const { rerender } = renderHook(props => useSettingsSectionLoad({ ...props, load }), { initialProps: options });
    expect(load).not.toHaveBeenCalled();
    rerender({ ...options, selected: true });
    const isCurrent = load.mock.calls[0][0];
    expect(isCurrent()).toBe(true);
    rerender(options);
    expect(isCurrent()).toBe(true);
    rerender({ ...options, selected: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('invalidates a pending response on close and starts a new load on reopen', () => {
    const load = vi.fn<(isCurrent: () => boolean) => Promise<void>>(pendingLoad);
    const props = { ...options, selected: true };
    const { rerender, unmount } = renderHook(value => useSettingsSectionLoad({ ...value, load }), { initialProps: props });
    const oldResponseIsCurrent = load.mock.calls[0][0];
    rerender({ ...props, isOpen: false });
    expect(oldResponseIsCurrent()).toBe(false);
    rerender(props);
    expect(load).toHaveBeenCalledTimes(2);
    const newResponseIsCurrent = load.mock.calls[1][0];
    expect(oldResponseIsCurrent()).toBe(false);
    expect(newResponseIsCurrent()).toBe(true);
    unmount();
    expect(newResponseIsCurrent()).toBe(false);
  });

  it('invalidates loads on permission or user changes without reusing an old lifetime', () => {
    const load = vi.fn<(isCurrent: () => boolean) => Promise<void>>(pendingLoad);
    const props = { ...options, selected: true };
    const { rerender } = renderHook(value => useSettingsSectionLoad({ ...value, load }), { initialProps: props });
    const first = load.mock.calls[0][0];
    rerender({ ...props, allowed: false });
    expect(first()).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    rerender(props);
    const second = load.mock.calls[1][0];
    rerender({ ...props, userId: 'user-b' });
    expect(second()).toBe(false);
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls[2][0]()).toBe(true);
  });

  it('uses the latest committed loader when selecting an unopened section', () => {
    const oldLoad = vi.fn(pendingLoad);
    const newLoad = vi.fn(pendingLoad);
    const { rerender } = renderHook(props => useSettingsSectionLoad(props), {
      initialProps: { ...options, load: oldLoad },
    });
    rerender({ ...options, load: newLoad });
    rerender({ ...options, selected: true, load: newLoad });
    expect(oldLoad).not.toHaveBeenCalled();
    expect(newLoad).toHaveBeenCalledTimes(1);
  });

  it('invalidates the discarded effect lifetime in StrictMode', () => {
    const load = vi.fn<(isCurrent: () => boolean) => Promise<void>>(pendingLoad);
    renderHook(() => useSettingsSectionLoad({ ...options, selected: true, load }), {
      reactStrictMode: true,
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[0][0]()).toBe(false);
    expect(load.mock.calls[1][0]()).toBe(true);
  });
});
