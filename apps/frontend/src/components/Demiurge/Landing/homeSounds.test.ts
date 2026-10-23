import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let created: number;
let oscillators: ReturnType<typeof node>[];
let gains: ReturnType<typeof node>[];
let now: number;
const node = () => {
  const result = {
    frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: undefined as (() => void) | undefined,
  };
  result.connect.mockImplementation(() => result);
  return result;
};
beforeEach(() => {
  vi.resetModules(); localStorage.clear(); created = 0; oscillators = []; gains = []; now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 10; destination = {};
    constructor() { created++; }
    createGain() { const value = node(); gains.push(value); return value; }
    createOscillator() { const value = node(); oscillators.push(value); return value; }
    createBiquadFilter() { return node(); }
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not autoplay and reuses one audio context after the first gesture', async () => {
  const { playHomeSound } = await import('./homeSounds');
  playHomeSound('expand');
  expect(created).toBe(0);
  playHomeSound('perk', true);
  expect(created).toBe(1);
  expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(330, 10);
  now += 200;
  playHomeSound('knock', true);
  expect(created).toBe(1);
  expect(oscillators).toHaveLength(2);
  oscillators[0].onended?.();
  expect(oscillators[0].disconnect).toHaveBeenCalledOnce();
});

it('limits typing cues and makes mute immediate and persistent', async () => {
  const { playHomeSound, setHomeSoundEnabled } = await import('./homeSounds');
  playHomeSound('pat', true, 900);
  now += 100; playHomeSound('pat', false, 900);
  expect(oscillators).toHaveLength(1);
  now += 900; playHomeSound('pat', false, 900);
  expect(oscillators).toHaveLength(2);
  setHomeSoundEnabled(false);
  expect(gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
  expect(localStorage.getItem('bgs-home-sound')).toBe('off');
  now += 1000; playHomeSound('perk', true);
  expect(oscillators).toHaveLength(2);
});

it('respects a saved mute preference on a fresh page', async () => {
  localStorage.setItem('bgs-home-sound', 'off');
  const { playHomeSound, isHomeSoundEnabled } = await import('./homeSounds');
  expect(isHomeSoundEnabled()).toBe(false);
  playHomeSound('perk', true);
  expect(created).toBe(0);
});
