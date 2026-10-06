import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DotRenderOptions } from './vendor/dots-lab';

let frames: Map<number, FrameRequestCallback>;
let time: number;
let calls: unknown[][];
let canvas: HTMLCanvasElement;
let parentWidth: number;
beforeEach(() => {
  frames = new Map(); time = 0; calls = []; parentWidth = 112;
  let sequence = 0;
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} closePath() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  canvas = document.createElement('canvas');
  const parent = document.createElement('div'); parent.append(canvas);
  Object.defineProperty(parent, 'clientWidth', { get: () => parentWidth });
  const context = new Proxy({}, { get: (_, name) => (...args: unknown[]) => calls.push([name, ...args]), set: () => true });
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const step = (now: number) => {
  time = now; calls = [];
  const pending = [...frames.values()]; frames.clear();
  pending.forEach(callback => callback(now));
  return JSON.stringify(calls);
};
const options: DotRenderOptions = { token: 'm110122bj08a5a3a', state: 'think', reduced: false, color: '#F5F5F5', ink: '#F5F5F5' };

it('keeps thinking geometry moving, retains its loop across state changes and fits the resized avatar', async () => {
  const { animateDot } = await import('./vendor/dots-lab.js');
  const renderer = animateDot(canvas, options);
  const firstPose = step(400);
  expect(step(1600)).not.toBe(firstPose);
  expect(frames.size).toBe(1);
  renderer.update({ ...options, state: 'listen' });
  expect(frames.size).toBe(1);
  parentWidth = 148;
  step(2500);
  expect(canvas.style.width).toBe('148px');
  renderer.dispose();
  expect(frames.size).toBe(0);
});

it('holds the same pose when reduced motion is requested', async () => {
  const { animateDot } = await import('./vendor/dots-lab.js');
  const renderer = animateDot(canvas, { ...options, reduced: true, state: 'idle' });
  const pose = step(100);
  renderer.look(1, -1);
  renderer.react('input');
  expect(step(2000)).toBe(pose);
  renderer.dispose();
});

it('follows and clamps gaze while idle, while thinking keeps its own choreography', async () => {
  const { animateDot } = await import('./vendor/dots-lab.js');
  const renderPose = (state: DotRenderOptions['state'], gaze?: [number, number]) => {
    time = 0;
    const renderer = animateDot(canvas, { ...options, state });
    if (gaze) renderer.look(...gaze);
    const pose = step(500);
    expect(frames.size).toBe(1);
    renderer.dispose();
    return pose;
  };
  expect(renderPose('idle', [1, -1])).not.toBe(renderPose('idle'));
  expect(renderPose('idle', [9, -9])).toBe(renderPose('idle', [1, -1]));
  expect(renderPose('think', [1, -1])).toBe(renderPose('think'));
});
