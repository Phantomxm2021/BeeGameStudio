import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AvatarDialogue } from './AvatarDialogue';

const presence = vi.hoisted(() => ({ real: false }));
vi.mock('motion/react', async importOriginal => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => false,
    // The speech tests own their frame clock. Enable real presence separately
    // to verify the inaccessible outgoing bubble without waiting for its exit.
    AnimatePresence: ({ children, ...props }: ComponentProps<typeof actual.AnimatePresence>) =>
      presence.real ? <actual.AnimatePresence {...props}>{children}</actual.AnimatePresence> : children,
  };
});

vi.mock('./DotsAvatar', () => ({ DotsAvatar: ({ mood, token }: { mood: string; token: string }) => <div data-testid="idea-avatar" data-mood={mood} data-dot-token={token} /> }));

let frames: Map<number, FrameRequestCallback>;
let sequence: number;
const frame = (time: number) => act(() => {
  const current = [...frames.values()];
  frames.clear();
  current.forEach(callback => callback(time));
});
beforeEach(() => {
  frames = new Map(); sequence = 0; presence.real = false; localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

it('disables the outgoing bubble before mounting the next one, while keeping the avatar mounted', () => {
  presence.real = true;
  const { rerender } = render(<AvatarDialogue mood="idle" heading="Hello" description="A thought" expanded={false}><button>Continue</button></AvatarDialogue>);
  const avatar = screen.getByTestId('idea-avatar');
  frame(0); frame(1000);
  expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  rerender(<AvatarDialogue mood="listening" heading="Next" description="Tell me" expanded={false}><button>Send</button></AvatarDialogue>);
  expect(screen.getByTestId('avatar-dialogue-assembly')).toHaveAttribute('data-exiting', 'true');
  expect(screen.getByTestId('avatar-dialogue-assembly')).toHaveAttribute('inert');
  expect(screen.getByTestId('avatar-dialogue-bubble')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  expect(screen.getByTestId('idea-avatar')).toBe(avatar);
});

it('unlocks controls only after both spoken lines finish and locks them again for the next message', () => {
  const { rerender } = render(<AvatarDialogue mood="idle" heading="Hello" description="A thought" expanded={false}><button>Continue</button></AvatarDialogue>);
  expect(screen.getByTestId('avatar-dialogue-controls')).toHaveAttribute('inert');
  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  frame(0); frame(200);
  expect(screen.getByTestId('avatar-dialogue-controls')).toHaveAttribute('data-ready', 'false');
  frame(1000);
  expect(screen.getByTestId('avatar-dialogue-controls')).toHaveAttribute('data-ready', 'true');
  expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  expect(screen.getByTestId('avatar-dialogue-controls')).not.toHaveAttribute('inert');
  rerender(<AvatarDialogue mood="thinking" heading="Working" description="Thinking it through" expanded={false}><button>Cancel</button></AvatarDialogue>);
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  frame(1100);
  // Returning before the intervening line finishes must replay the original
  // speech before controls unlock, rather than reusing a stale completion.
  rerender(<AvatarDialogue mood="idle" heading="Hello" description="A thought" expanded={false}><button>Continue</button></AvatarDialogue>);
  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  frame(1200); frame(2300);
  rerender(<AvatarDialogue mood="thinking" heading="Working" description="Thinking it through" expanded={false}><button>Cancel</button></AvatarDialogue>);
  frame(2400); frame(4000);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

it('uses the daily appearance and removes the debug editor', () => {
  localStorage.setItem('bgs-dots-avatar', 'm1a0122bj08a5a3a'); // Former manual override.
  render(<AvatarDialogue mood="idle" heading="Hi" description="Hello" expanded={false}><button>Continue</button></AvatarDialogue>);
  const saved = JSON.parse(localStorage.getItem('bgs-daily-avatar')!);
  expect(screen.getByTestId('idea-avatar')).toHaveAttribute('data-dot-token', saved.token);
  expect(screen.queryByRole('button', { name: 'Avatar · Debug' })).not.toBeInTheDocument();
  expect(screen.queryByTitle('Dots Lab editor')).not.toBeInTheDocument();
});

it('keeps the thinking bubble visible after typing, with the avatar mounted and controls unavailable', () => {
  render(<AvatarDialogue mood="thinking" heading="Thinking" description="Three ideas" expanded={false} generatingOptions><button>Hidden control</button></AvatarDialogue>);
  expect(screen.getByTestId('avatar-dialogue-bubble')).toHaveAttribute('aria-hidden', 'false');
  const avatar = screen.getByTestId('idea-avatar');
  frame(0); frame(1500);
  expect(screen.getByTestId('avatar-dialogue-bubble')).toHaveAttribute('aria-hidden', 'false');
  expect(screen.getByTestId('avatar-dialogue-bubble')).not.toHaveAttribute('inert');
  expect(screen.getByTestId('avatar-dialogue')).toHaveAttribute('data-generating', 'true');
  expect(screen.getByTestId('idea-avatar')).toBe(avatar);
  expect(screen.getByRole('heading', { name: 'Thinking' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hidden control' })).not.toBeInTheDocument();
  expect(screen.getByTestId('idea-avatar')).toHaveAttribute('data-mood', 'thinking');
});
