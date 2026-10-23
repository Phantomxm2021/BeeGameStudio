import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DotRenderOptions } from './vendor/dots-lab';

let frames: Map<number, FrameRequestCallback>;
let time: number;
let calls: unknown[][];
let canvas: HTMLCanvasElement;
let parentWidth: number;
let paints: { method: string; color: string }[];
beforeEach(() => {
  frames = new Map(); time = 0; calls = []; paints = []; parentWidth = 112;
  let sequence = 0;
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} closePath() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  canvas = document.createElement('canvas');
  const parent = document.createElement('div'); parent.append(canvas);
  Object.defineProperty(parent, 'clientWidth', { get: () => parentWidth });
  const styles: Record<string, unknown> = {};
  const context = new Proxy(styles, {
    get: (_, name: string) => name in styles ? styles[name] : (...args: unknown[]) => {
      calls.push([name, ...args]);
      if (name === 'fill' || name === 'stroke') paints.push({ method: name, color: String(styles[`${name}Style`]) });
    },
    set: (_, name: string, value) => { styles[name] = value; return true; }
  });
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const step = (now: number) => {
  time = now; calls = []; paints = [];
  const pending = [...frames.values()]; frames.clear();
  pending.forEach(callback => callback(now));
  return JSON.stringify(calls);
};
const options: DotRenderOptions = { token: 'm110122bj08a5a3a', state: 'think', reduced: false, color: '#F5F5F5', ink: '#F5F5F5' };

function contrast(first: string, second: string) {
  const luminance = (color: string) => {
    const channels = color.startsWith('#')
      ? (color.length === 4 ? color.slice(1).split('').map(c => c + c) : color.slice(1).match(/../g)!).map(c => parseInt(c, 16))
      : color.match(/\d+/g)!.map(Number);
    const linear = channels.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

it.each([false, true])('keeps writing badge dots legible across theme changes (reduced motion: %s)', async reduced => {
  const { animateDot } = await import('./vendor/dots-lab.js');
  const renderer = animateDot(canvas, { ...options, state: 'write', reduced });
  try {
    for (const color of ['#F5F5F5', '#181818', '#F5F5F5']) {
      renderer.update({ ...options, state: 'write', reduced, color, ink: color });
      step(600);
      const [background, ...dots] = paints.slice(-4);
      expect(dots).toHaveLength(3);
      for (const dot of dots) expect(contrast(background.color, dot.color)).toBeGreaterThanOrEqual(4.5);
    }
  } finally { renderer.dispose(); }
});

it.each(['alert', 'error'] as const)('keeps the %s badge symbol legible in both themes', async state => {
  const { animateDot } = await import('./vendor/dots-lab.js');
  const renderer = animateDot(canvas, { ...options, state });
  try {
    for (const color of ['#F5F5F5', '#181818']) {
      renderer.update({ ...options, state, color, ink: color });
      step(2200);
      const badge = paints.slice(state === 'alert' ? -3 : -2);
      expect(badge[0].method).toBe('fill');
      expect(badge[1].method).toBe('stroke');
      for (const symbol of badge.slice(1)) expect(contrast(badge[0].color, symbol.color)).toBeGreaterThanOrEqual(4.5);
    }
  } finally { renderer.dispose(); }
});

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
