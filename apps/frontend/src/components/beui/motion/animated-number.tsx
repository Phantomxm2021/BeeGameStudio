import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** Animate display digits only; callers retain their existing precision, units and clocks. */
export function AnimatedNumber({ children, className, duration = 0.18 }: {
  children: string | number;
  className?: string;
  duration?: number;
}) {
  const reduceMotion = useReducedMotion();
  const text = String(children);

  if (reduceMotion || !/\d/.test(text)) {
    return <span className={cn('tabular-nums', className)}>{text}</span>;
  }

  return <span className={cn('relative inline-block tabular-nums', className)}>
    {/* Keep one complete, current value available to assistive technology. */}
    <span className="sr-only">{text}</span>
    <span aria-hidden="true" className="inline-flex whitespace-pre">
      {text.split(/(\d+)/).map((part, group) => /\d/.test(part)
        ? <span key={group} className="inline-flex">
          {Array.from(part, (digit, index) => (
            // Anchor each run at its units column when a counter gains a digit.
            <span key={part.length - index} className="relative inline-grid overflow-hidden">
              <AnimatePresence initial={false}>
                <motion.span
                  key={digit}
                  className="col-start-1 row-start-1"
                  initial={{ y: '80%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: '-80%', opacity: 0 }}
                  transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
                >{digit}</motion.span>
              </AnimatePresence>
            </span>
          ))}
        </span>
        : <span key={group}>{part}</span>)}
    </span>
  </span>;
}
