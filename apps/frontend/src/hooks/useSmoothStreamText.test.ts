import { act, renderHook } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSmoothStreamText } from './useSmoothStreamText';

let now = 0;
let nextFrame = 1;
let frames = new Map<number, FrameRequestCallback>();

function advanceFrame() {
  now += 34;
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach(callback => callback(now)));
}

beforeEach(() => {
  now = 0;
  nextFrame = 1;
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => vi.unstubAllGlobals());

it('renders restored complete messages without replaying them', () => {
  const { result } = renderHook(() => useSmoothStreamText('Already complete', false));
  expect(result.current).toBe('Already complete');
  expect(frames.size).toBe(0);
});

it('reveals current snapshots smoothly, then catches up to the final text', () => {
  const { result, rerender } = renderHook(({ text, streaming }) => useSmoothStreamText(text, streaming), {
    initialProps: { text: 'Hello', streaming: true },
  });
  expect(result.current).toBe('');
  advanceFrame();
  expect('Hello'.startsWith(result.current)).toBe(true);

  rerender({ text: 'Hello world', streaming: true });
  const beforeFinal = result.current.length;
  advanceFrame();
  expect(result.current.length).toBeGreaterThanOrEqual(beforeFinal);
  rerender({ text: 'Hello world!', streaming: false });
  for (let index = 0; index < 30 && frames.size; index += 1) advanceFrame();
  expect(result.current).toBe('Hello world!');
  expect(frames.size).toBe(0);
});

it('shows the full snapshot immediately when reduced motion is requested', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const { result } = renderHook(() => useSmoothStreamText('No animation', true));
  expect(result.current).toBe('No animation');
  expect(frames.size).toBe(0);
});

it('keeps revealing text after Strict Mode replays effects', () => {
  const { result } = renderHook(() => useSmoothStreamText('Visible response', true), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
  });
  expect(frames.size).toBe(1);
  for (let index = 0; index < 30 && frames.size; index += 1) advanceFrame();
  expect(result.current).toBe('Visible response');
});
