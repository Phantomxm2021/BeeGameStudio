import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDailyAvatar, useDailyAvatar } from './useDailyAvatar';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 2, 12));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the same appearance all day and changes silhouette the next local day', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const first = getDailyAvatar(new Date(2026, 9, 2, 0, 1));
  expect(getDailyAvatar(new Date(2026, 9, 2, 23, 59))).toBe(first);
  expect(random).toHaveBeenCalledTimes(1);
  const next = getDailyAvatar(new Date(2026, 9, 3, 0, 1));
  expect(next[2]).not.toBe(first[2]);
  expect(JSON.parse(localStorage.getItem('bgs-daily-avatar')!)).toEqual({ day: '2026-10-3', token: next });
});

it('stores only appearances that the actual Dots Lab renderer can decode', async () => {
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} closePath() {} });
  const { readDotToken } = await import('./vendor/dots-lab.js');
  const random = vi.spyOn(Math, 'random');
  for (let index = 0; index < 60; index++) {
    localStorage.clear();
    random.mockReturnValue((index + .5) / 60);
    const parsed = readDotToken(getDailyAvatar());
    expect(parsed).not.toBeNull();
    expect(parsed?.o.ink).toBe('auto');
    expect(parsed?.o.brows).toBe('none');
    expect(parsed?.o.size).toBe(100);
  }
});

it('replaces an invalid saved appearance instead of sending it to the renderer', () => {
  localStorage.setItem('bgs-daily-avatar', JSON.stringify({ day: '2026-10-2', token: 'invalid' }));
  expect(getDailyAvatar()).toMatch(/^m1[0-9ab][0-4]0089f0f5f5f5$/);
});

it('keeps a date-based fallback stable when browser storage is unavailable', () => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('Unavailable', 'SecurityError'); });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(getDailyAvatar(new Date(2026, 9, 2, 1))).toBe(getDailyAvatar(new Date(2026, 9, 2, 23)));
  expect(warning).toHaveBeenCalled();
});

it('changes at midnight across the year boundary and clears its timer on unmount', () => {
  vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const { result, unmount } = renderHook(useDailyAvatar);
  const first = result.current;
  act(() => vi.advanceTimersByTime(1100));
  expect(result.current[2]).not.toBe(first[2]);
  expect(JSON.parse(localStorage.getItem('bgs-daily-avatar')!).day).toBe('2027-1-1');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('refreshes after returning to a tab suspended for several days', () => {
  const { result } = renderHook(useDailyAvatar);
  const first = result.current;
  vi.setSystemTime(new Date(2026, 9, 5, 12));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(result.current[2]).not.toBe(first[2]);
  expect(JSON.parse(localStorage.getItem('bgs-daily-avatar')!).day).toBe('2026-10-5');
});
