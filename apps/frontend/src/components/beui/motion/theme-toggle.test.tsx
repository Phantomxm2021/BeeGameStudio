import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { applyThemeToDocument, setTheme, state } = vi.hoisted(() => {
  const state = { isDark: false };
  const setTheme = vi.fn((isDark: boolean) => { state.isDark = isDark; });
  const applyThemeToDocument = vi.fn((isDark: boolean) => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  });
  return { applyThemeToDocument, setTheme, state };
});

vi.mock('@/store/systemStore', () => ({
  applyThemeToDocument,
  useSystemStore: (selector: (value: typeof state & { setTheme: typeof setTheme }) => unknown) => selector({ ...state, setTheme }),
}));

import { ThemeToggle } from './theme-toggle';

describe('beUI ThemeToggle adapter', () => {
  beforeEach(() => {
    state.isDark = false;
    applyThemeToDocument.mockClear();
    setTheme.mockClear();
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
    document.getElementById('beui-theme-toggle-style')?.remove();
  });

  it('commits the next theme inside the View Transition callback', async () => {
    let transitionCallback: (() => void) | undefined;
    const startViewTransition = vi.fn((callback: () => void) => {
      transitionCallback = callback;
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition });

    render(<ThemeToggle />);
    await userEvent.click(screen.getByTestId('beui-theme-toggle'));

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(setTheme).not.toHaveBeenCalled();
    transitionCallback?.();
    expect(applyThemeToDocument).toHaveBeenCalledWith(true);
    expect(setTheme).toHaveBeenCalledWith(true);
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('installs the 700ms circle reveal style', () => {
    render(<ThemeToggle />);
    const style = document.getElementById('beui-theme-toggle-style');
    expect(style?.textContent).toContain('700ms cubic-bezier(.4,0,.2,1)');
    expect(style?.textContent).toContain('circle(150%');
  });
});
