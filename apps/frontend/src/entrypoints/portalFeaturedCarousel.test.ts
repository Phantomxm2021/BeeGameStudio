import { execFileSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/dom';
import portalHtml from '../../../game-portal/public/index.html?raw';

const controller = execFileSync('bun', ['build', '../game-portal/public/portal.js', '--target=browser', '--format=iife', '--external=/auth.js', '--define', 'import.meta.env={}'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });

it('follows the measured hold/transition cycle, manual pause, replay and empty/plain-text captions', async () => {
  window.history.replaceState(null, '', '/');
  document.body.innerHTML = portalHtml;
  localStorage.setItem('i18nextLng', 'zh');
  document.cookie = 'beegame-language=zh; Path=/';
  const originalAnimate = Element.prototype.animate;
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn(() => ({})) });
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const track = document.getElementById('feature-track')!;
    const width = this.classList.contains('feature-slide') ? 1260 : 1512;
    const height = this.id === 'featured' ? 926 : 710;
    const index = this.classList.contains('feature-slide') ? [...track.children].indexOf(this) : 0;
    const left = this.classList.contains('feature-slide') ? 126 + index * 1280 - track.scrollLeft : 0;
    return { x: left, y: 100, left, top: 100, width, height, right: left + width, bottom: 100 + height, toJSON: () => ({}) };
  });
  vi.stubGlobal('getComputedStyle', ((original => (element: Element) => {
    const style = original(element);
    if (element.id === 'feature-track') return new Proxy(style, { get: (target, key) => key === 'paddingLeft' ? '126px' : Reflect.get(target, key, target) });
    return style;
  })(getComputedStyle)));
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input === '/api/featured') return Response.json({ games: [
      { projectId: 'one', title: 'One', featuredCaption: '' },
      { projectId: 'two', title: 'Two', featuredCaption: '<b>Caption</b>\nSecond line' },
    ] });
    if (input === '/api/config') return Response.json({});
    return Response.json({ games: [] });
  }));
  const node = (id: string) => document.getElementById(id)!;
  const step = (time: number) => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); };
  try {
    new Function(controller)();
    await waitFor(() => expect(node('feature-dots').children).toHaveLength(2));
    const first = node('featured-tab-0'), second = node('featured-tab-1');
    expect(document.querySelectorAll('.feature-caption')[0]).not.toBeVisible();
    expect(document.querySelectorAll('.feature-caption')[1]).toHaveTextContent('<b>Caption</b>');
    expect(document.querySelector('.feature-caption b')).toBeNull();
    expect(node('feature-playback')).toHaveAttribute('data-state', 'playing');
    fireEvent.wheel(node('feature-track'), { deltaY: 100 });
    expect(node('feature-playback')).toHaveAttribute('data-state', 'playing');
    step(1); step(6151); step(6651);
    expect(node('feature-track').scrollLeft).toBe(640);
    expect(first.style.getPropertyValue('--feature-distance')).toBe('-0.5');
    expect(second).toHaveAttribute('aria-selected', 'true');
    step(7151);
    fireEvent.scroll(node('feature-track'));
    expect(node('feature-track').scrollLeft).toBe(1280);
    expect(node('feature-playback')).toHaveAttribute('data-state', 'playing');
    step(13301);
    expect(node('feature-playback')).toHaveAttribute('data-state', 'ended');
    fireEvent.click(node('feature-playback'));
    step(13302); step(14302);
    expect(node('feature-track').scrollLeft).toBe(0);
    expect(node('feature-playback')).toHaveAttribute('data-state', 'playing');
    fireEvent.click(second);
    step(15302);
    expect(node('feature-track').scrollLeft).toBe(1280);
    expect(node('feature-playback')).toHaveAttribute('data-state', 'paused');
    fireEvent.keyDown(second, { key: 'Home' });
    step(15303); step(16303);
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(first);
  } finally {
    frames.clear(); bounds.mockRestore(); vi.unstubAllGlobals();
    if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: originalAnimate });
    else Reflect.deleteProperty(Element.prototype, 'animate');
  }
});
