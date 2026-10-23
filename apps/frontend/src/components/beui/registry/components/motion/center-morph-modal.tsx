// beui.dev/components/motion/center-morph-modal
import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { EASE_OUT } from '@/components/beui/registry/lib/ease';
import { PresenceGate } from '@/components/beui/registry/lib/presence-gate';
import { cn } from '@/components/beui/registry/lib/utils';

type CenterMorphModalContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
};

const CenterMorphModalContext = createContext<CenterMorphModalContextValue | null>(null);

function useCenterMorphModalContext() {
  const context = useContext(CenterMorphModalContext);
  if (!context) throw new Error('CenterMorphModalContent must be used within CenterMorphModal');
  return context;
}

export function CenterMorphModal({ children, open, onOpenChange }: {
  children: ReactNode;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);
  const setOpen = useCallback((next: boolean) => onOpenChangeRef.current?.(next), []);
  const value = useMemo(() => ({ open, setOpen, contentId: `${id}-content` }), [id, open, setOpen]);
  return <CenterMorphModalContext.Provider value={value}>{children}</CenterMorphModalContext.Provider>;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const CENTER_FOLDED_CLIP = 'inset(48% 48% 48% 48% round 30px)';
const CENTER_OPEN_CLIP = 'inset(0% 0% 0% 0% round 30px)';
const CENTER_UNFOLD_TRANSITION = { duration: 0.43, ease: [0.2, 0, 0.2, 1] as const };

function getFocusableElements(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => element.tabIndex >= 0);
}

export function CenterMorphModalContent({
  children,
  ariaLabel,
  ariaDescribedBy,
  dismissible = true,
  showCloseButton = true,
  closeButtonLabel = 'Close modal',
  className,
  backdropClassName,
}: {
  children: ReactNode;
  ariaLabel: string;
  ariaDescribedBy?: string;
  dismissible?: boolean;
  showCloseButton?: boolean;
  closeButtonLabel?: string;
  className?: string;
  backdropClassName?: string;
}) {
  const context = useCenterMorphModalContext();
  const reduce = useReducedMotion() ?? false;
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!context.open) return;
    const previousOverflow = document.body.style.overflow;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const focusFrame = requestAnimationFrame(() => {
      const [firstFocusable] = getFocusableElements(panelRef.current);
      (firstFocusable ?? panelRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        context.setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(panelRef.current);
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [context, dismissible]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {context.open ? <PresenceGate>{({ isPresent, gate }) => <>
        <motion.button
          type="button"
          aria-label="Dismiss modal"
          tabIndex={-1}
          disabled={!dismissible}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          {...gate}
          transition={{ duration: reduce ? 0.1 : 0.28, ease: EASE_OUT }}
          onClick={() => context.setOpen(false)}
          className={cn('pointer-events-auto fixed inset-0 z-[240] h-full w-full cursor-default bg-background/10 backdrop-blur-sm', backdropClassName)}
        />
        <div inert={!isPresent} className="pointer-events-none fixed inset-4 z-[241] flex items-center justify-center overflow-y-auto drop-shadow-2xl">
          <div className="flex w-full flex-col items-center py-8">
            <motion.div
              ref={panelRef}
              id={context.contentId}
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              aria-describedby={ariaDescribedBy}
              tabIndex={-1}
              initial={reduce ? { opacity: 0, clipPath: CENTER_OPEN_CLIP } : { opacity: 1, clipPath: CENTER_FOLDED_CLIP }}
              animate={{ opacity: 1, clipPath: CENTER_OPEN_CLIP }}
              exit={reduce ? { opacity: 0, clipPath: CENTER_OPEN_CLIP } : { opacity: 1, clipPath: CENTER_FOLDED_CLIP }}
              {...gate}
              transition={reduce ? { duration: 0.14, ease: EASE_OUT } : CENTER_UNFOLD_TRANSITION}
              className={cn('pointer-events-auto relative w-full max-w-[26rem] origin-center overflow-hidden rounded-[30px] border border-border bg-background will-change-[clip-path]', className)}
            >
              {children}
              {showCloseButton ? <motion.button
                type="button"
                aria-label={closeButtonLabel}
                onClick={() => context.setOpen(false)}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: reduce ? 1 : 0.88, transition: { duration: 0.1 } }}
                transition={{ delay: reduce ? 0 : 0.16, duration: reduce ? 0.12 : 0.2, ease: EASE_OUT }}
                className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground/[0.05] text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              ><X className="size-4" aria-hidden="true" /></motion.button> : null}
            </motion.div>
          </div>
        </div>
      </>}</PresenceGate> : null}
    </AnimatePresence>,
    document.body,
  );
}
