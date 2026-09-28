import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect } from 'react';

import { applyThemeToDocument, useSystemStore } from '@/store/systemStore';
import { cn } from '@/lib/utils';

// Ported from the free beUI theme-toggle registry source
// (https://beui.dev/r/theme-toggle.json). The project already owns theme state
// in Zustand, so this adapter keeps that single source instead of adding
// next-themes as a second theme store.
const VIEW_TRANSITION_STYLE = `
html[data-beui-vt]::view-transition-old(root),
html[data-beui-vt]::view-transition-new(root) { animation: none; mix-blend-mode: normal; }
html[data-beui-vt]::view-transition-new(root) { clip-path: circle(0 at var(--beui-vt-x) var(--beui-vt-y)); animation: beui-theme-reveal 700ms cubic-bezier(.4,0,.2,1) both; }
@keyframes beui-theme-reveal { to { clip-path: circle(150% at var(--beui-vt-x) var(--beui-vt-y)); } }
@media (prefers-reduced-motion: reduce) { html[data-beui-vt]::view-transition-new(root) { animation-duration: 1ms; } }
`;

function ensureViewTransitionStyle() {
  if (typeof document === 'undefined' || document.getElementById('beui-theme-toggle-style')) return;
  const style = document.createElement('style');
  style.id = 'beui-theme-toggle-style';
  style.textContent = VIEW_TRANSITION_STYLE;
  document.head.appendChild(style);
}

export function ThemeToggle({
  className,
  darkModeLabel = 'Switch to dark mode',
  lightModeLabel = 'Switch to light mode',
}: {
  className?: string;
  darkModeLabel?: string;
  lightModeLabel?: string;
}) {
  const isDark = useSystemStore((state) => state.isDark);
  const setTheme = useSystemStore((state) => state.setTheme);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => ensureViewTransitionStyle(), []);
  useEffect(() => applyThemeToDocument(isDark), [isDark]);

  const handleToggle = useCallback(() => {
    const nextIsDark = !isDark;
    if (typeof document === 'undefined') {
      setTheme(nextIsDark);
      return;
    }
    ensureViewTransitionStyle();
    const transitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };
    if (reducedMotion || typeof transitionDocument.startViewTransition !== 'function') {
      applyThemeToDocument(nextIsDark);
      setTheme(nextIsDark);
      return;
    }
    const source = document.activeElement;
    const rect = source instanceof HTMLElement ? source.getBoundingClientRect() : undefined;
    document.documentElement.style.setProperty('--beui-vt-x', `${(rect?.left ?? window.innerWidth / 2) + (rect?.width ?? 0) / 2}px`);
    document.documentElement.style.setProperty('--beui-vt-y', `${(rect?.top ?? window.innerHeight / 2) + (rect?.height ?? 0) / 2}px`);
    document.documentElement.dataset.beuiVt = 'circle';
    const transition = transitionDocument.startViewTransition(() => {
      applyThemeToDocument(nextIsDark);
      setTheme(nextIsDark);
    });
    const cleanup = () => {
      delete document.documentElement.dataset.beuiVt;
      document.documentElement.style.removeProperty('--beui-vt-x');
      document.documentElement.style.removeProperty('--beui-vt-y');
    };
    void transition.finished.then(cleanup, cleanup);
  }, [isDark, reducedMotion, setTheme]);
  const label = isDark ? lightModeLabel : darkModeLabel;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={handleToggle}
      className={cn('inline-flex size-8 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors duration-[var(--motion-hover)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]', className)}
      data-testid="beui-theme-toggle"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={isDark ? 'sun' : 'moon'}
          initial={{ opacity: 0, rotate: reducedMotion ? 0 : -45, scale: reducedMotion ? 1 : 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: reducedMotion ? 0 : 45, scale: reducedMotion ? 1 : 0.8 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="inline-flex"
        >
          {isDark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
