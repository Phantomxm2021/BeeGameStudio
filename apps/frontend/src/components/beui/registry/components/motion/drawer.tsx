"use client";

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EASE_OUT, SPRING_PANEL } from '../../lib/ease';
import { cn } from '../../lib/utils';

type DrawerProps = { open: boolean; onOpenChange: (open: boolean) => void; side?: 'left' | 'right'; children: ReactNode; className?: string; backdropClassName?: string; ariaLabel: string };

/** A focused side sheet. Its content is independent from the page beneath it. */
export function Drawer({ open, onOpenChange, side = 'right', children, className, backdropClassName, ariaLabel }: DrawerProps) {
    const reduce = useReducedMotion() ?? false;
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onOpenChange, open]);
    const offscreen = side === 'right' ? '100%' : '-100%';
    const content = <AnimatePresence>{open ? <>
        <motion.button type="button" aria-label="Close" onClick={() => onOpenChange(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} className={cn('fixed inset-0 z-[400] h-full w-full cursor-default bg-black/30 backdrop-blur-[1px]', backdropClassName)} />
        <motion.aside role="dialog" aria-modal="true" aria-label={ariaLabel} initial={reduce ? { opacity: 0 } : { x: offscreen }} animate={reduce ? { opacity: 1 } : { x: 0 }} exit={reduce ? { opacity: 0 } : { x: offscreen }} transition={reduce ? { duration: 0.18, ease: EASE_OUT } : SPRING_PANEL} className={cn('fixed inset-y-0 z-[401] flex w-[min(34rem,92vw)] flex-col border-[var(--border)] bg-[var(--background)] shadow-2xl', side === 'right' ? 'right-0 border-l' : 'left-0 border-r', className)}>{children}</motion.aside>
    </> : null}</AnimatePresence>;
    return typeof document === 'undefined' ? null : createPortal(content, document.body);
}
