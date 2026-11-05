import { useEffect, useRef, useState } from 'react';

/** Smooth a live text snapshot for presentation; the source text remains unchanged. */
export function useSmoothStreamText(text: string, streaming: boolean): string {
  const target = useRef(text);
  const shown = useRef(streaming ? 0 : text.length);
  const frame = useRef<number | null>(null);
  const lastPaint = useRef<number | null>(null);
  const [visibleLength, setVisibleLength] = useState(streaming ? 0 : text.length);

  useEffect(() => {
    target.current = text;

    if (!streaming || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      shown.current = text.length;
      setVisibleLength(text.length);
      return;
    }

    if (shown.current > text.length) {
      shown.current = text.length;
      setVisibleLength(text.length);
    }
    if (frame.current !== null || shown.current >= text.length) return;

    const advance = (now: number) => {
      frame.current = null;
      const elapsed = Math.min(100, now - (lastPaint.current ?? now - 34));
      if (elapsed >= 28) {
        lastPaint.current = now;
        const remaining = target.current.length - shown.current;
        const rate = Math.max(140, remaining * 1.5);
        shown.current = Math.min(target.current.length, shown.current + Math.max(1, Math.ceil(rate * elapsed / 1000)));
        setVisibleLength(shown.current);
      }
      if (shown.current < target.current.length) frame.current = requestAnimationFrame(advance);
      else lastPaint.current = null;
    };
    frame.current = requestAnimationFrame(advance);
  }, [streaming, text]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    lastPaint.current = null;
  }, []);

  return text.slice(0, visibleLength);
}
