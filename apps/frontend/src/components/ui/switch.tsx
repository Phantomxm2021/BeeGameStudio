"use client";

// Ported from the free beUI motion Switch registry source. This compatibility
// export keeps every settings surface on the same spring interaction.
import { animate, motion, MotionConfig, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

const THUMB_SPRING = { type: 'spring', stiffness: 800, damping: 80, mass: 4 } as const;

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  'aria-label'?: string;
  className?: string;
  size?: 'sm' | 'default';
}

export function Switch({ checked, onCheckedChange, disabled, label, ariaLabel, 'aria-label': ariaLabelAttribute, className, size = 'default' }: SwitchProps) {
  const id = useId();
  const thumbRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [isPressed, setIsPressed] = useState(false);
  const [isPointer, setIsPointer] = useState(false);
  const small = size === 'sm';

  useEffect(() => {
    if (!thumbRef.current || reduce) return;
    if (disabled && isPressed) animate(thumbRef.current, { x: [0, -2, 2, -1, 0] }, { delay: 0.2, duration: 0.6 });
  }, [disabled, isPressed, reduce]);

  const squish = !disabled && isPointer && isPressed && !reduce;
  return <MotionConfig transition={reduce ? { duration: 0 } : THUMB_SPRING}>
    <span className={cn('inline-flex items-center gap-3', className)}>
      <motion.button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? ariaLabelAttribute}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        onPointerDown={event => { setIsPressed(true); setIsPointer(event.type.startsWith('pointer')); }}
        onPointerUp={() => setIsPressed(false)}
        onPointerLeave={() => setIsPressed(false)}
        initial={false}
        data-state={checked ? 'checked' : 'unchecked'}
        className={cn(
          'group peer inline-flex shrink-0 cursor-pointer items-center rounded-full px-1 outline-none transition-colors duration-200',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-60',
          small ? 'h-6 w-10' : 'h-7 w-12',
          checked ? 'justify-end bg-primary' : 'justify-start bg-muted-foreground/60',
        )}
      >
        <motion.div ref={thumbRef} layout animate={{ scale: squish ? 0.9 : 1 }} className={cn('pointer-events-none block rounded-full bg-background shadow-md', small ? 'h-4 w-4' : 'h-5 w-5')}>
          <div className={cn(small ? 'size-4' : 'size-5', squish && (checked ? 'ml-1' : 'mr-1'))} />
        </motion.div>
      </motion.button>
      {label ? <label htmlFor={id} className="cursor-pointer text-sm text-foreground">{label}</label> : null}
    </span>
  </MotionConfig>;
}
