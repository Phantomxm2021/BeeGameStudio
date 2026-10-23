import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DotsAvatar } from './DotsAvatar';

const mock = vi.hoisted(() => ({
  reduced: false,
  renderer: { update: vi.fn(), look: vi.fn(), resetLook: vi.fn(), react: vi.fn(), dispose: vi.fn() },
  animate: vi.fn(),
}));
vi.mock('motion/react', async importOriginal => ({
  ...await importOriginal<typeof import('motion/react')>(),
  useReducedMotion: () => mock.reduced,
}));
vi.mock('./vendor/dots-lab.js', () => ({ animateDot: mock.animate }));
beforeEach(() => {
  vi.clearAllMocks();
  mock.reduced = false;
  mock.animate.mockReturnValue(mock.renderer);
});
afterEach(cleanup);
const props = { token: 'm110122bj08a5a3a', mood: 'idle' as const, label: 'Avatar' };
const initialized = () => waitFor(() => expect(mock.animate).toHaveBeenCalledOnce());

it('responds to pointer and typing, leaves thinking focused, and cleans up pointer listeners', async () => {
  const { rerender, unmount } = render(<DotsAvatar {...props} />);
  await initialized();
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 280, clientY: 110 })));
  expect(mock.renderer.look).toHaveBeenLastCalledWith(1, .5);
  fireEvent.pointerOver(screen.getByRole('img'));
  expect(mock.renderer.react).toHaveBeenLastCalledWith('hover');
  rerender(<DotsAvatar {...props} mood="listening" inputValue="New thought" />);
  expect(mock.renderer.react).toHaveBeenLastCalledWith('input');
  expect(mock.renderer.look).toHaveBeenLastCalledWith(.7, .25);
  rerender(<DotsAvatar {...props} mood="thinking" inputValue="New thought" />);
  mock.renderer.react.mockClear();
  fireEvent.click(screen.getByRole('img'));
  fireEvent.pointerOver(screen.getByRole('img'));
  rerender(<DotsAvatar {...props} mood="thinking" inputValue="Restored draft" />);
  expect(mock.renderer.react).not.toHaveBeenCalled();
  unmount();
  mock.renderer.look.mockClear();
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 280, clientY: 110 })));
  expect(mock.renderer.look).not.toHaveBeenCalled();
  expect(mock.renderer.dispose).toHaveBeenCalledOnce();
});

it('ignores touch tracking and returns gaze when the window loses focus', async () => {
  render(<DotsAvatar {...props} />);
  await initialized();
  const touch = new MouseEvent('pointermove', { clientX: 280, clientY: 110 });
  Object.defineProperty(touch, 'pointerType', { value: 'touch' });
  act(() => window.dispatchEvent(touch));
  expect(mock.renderer.look).not.toHaveBeenCalled();
  fireEvent.blur(window);
  expect(mock.renderer.resetLook).toHaveBeenCalledOnce();
});

it('disables pointer tracking when reduced motion is requested', async () => {
  mock.reduced = true;
  render(<DotsAvatar {...props} />);
  await initialized();
  expect(mock.animate.mock.calls[0][1]).toMatchObject({ reduced: true });
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 280, clientY: 110 })));
  expect(mock.renderer.look).not.toHaveBeenCalled();
});

it('uses the continuous writing state without pointer or typing reactions interrupting it', async () => {
  const { rerender } = render(<DotsAvatar {...props} mood="writing" />);
  await initialized();
  expect(mock.animate.mock.calls[0][1]).toMatchObject({ state: 'write' });
  mock.renderer.look.mockClear();
  mock.renderer.react.mockClear();
  act(() => window.dispatchEvent(new MouseEvent('pointermove', { clientX: 280, clientY: 110 })));
  fireEvent.pointerOver(screen.getByRole('img'));
  fireEvent.click(screen.getByRole('img'));
  rerender(<DotsAvatar {...props} mood="writing" inputValue="Draft" />);
  expect(mock.renderer.look).not.toHaveBeenCalled();
  expect(mock.renderer.react).not.toHaveBeenCalled();
});
