import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDailyBackground, useDailyBackground } from './useDailyBackground';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 2, 12));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('chooses among all three presets, keeps the choice all day and changes it tomorrow', () => {
  const random = vi.spyOn(Math, 'random');
  for (const [index, name] of ['Sea glass', 'Dusk', 'Sand'].entries()) {
    localStorage.clear();
    random.mockReturnValue((index + .5) / 3);
    expect(getDailyBackground().name).toBe(name);
  }
  const first = getDailyBackground();
  random.mockClear();
  expect(getDailyBackground(new Date(2026, 9, 2, 23))).toBe(first);
  expect(random).not.toHaveBeenCalled();
  expect(getDailyBackground(new Date(2026, 9, 3)).name).not.toBe(first.name);
});

it('updates at local midnight and when a suspended tab resumes, and clears its timer', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
  const { result, unmount } = renderHook(useDailyBackground);
  const first = result.current;
  act(() => vi.advanceTimersByTime(1100));
  expect(result.current.name).not.toBe(first.name);
  expect(JSON.parse(localStorage.getItem('bgs-daily-background')!).day).toBe('2027-1-1');
  vi.setSystemTime(new Date(2027, 0, 4, 12));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(JSON.parse(localStorage.getItem('bgs-daily-background')!).day).toBe('2027-1-4');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('replaces an invalid saved palette and stays stable when storage is unavailable', () => {
  localStorage.setItem('bgs-daily-background', JSON.stringify({ day: '2026-10-2', palette: 'custom' }));
  expect(['Sea glass', 'Dusk', 'Sand']).toContain(getDailyBackground().name);
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(getDailyBackground(new Date(2026, 9, 2, 1))).toBe(getDailyBackground(new Date(2026, 9, 2, 23)));
});
