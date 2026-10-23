import { useCallback, useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { AvatarMood } from './AvatarDialogue';
import type { animateDot, DotRenderOptions, DotState } from './vendor/dots-lab';
import { playHomeSound } from './homeSounds';

const stateForMood: Record<AvatarMood, DotState> = { idle: 'idle', sleeping: 'sleep', listening: 'listen', thinking: 'think', writing: 'write', ready: 'success', error: 'error' };

export function DotsAvatar({ token, mood, label, inputValue = '' }: { token: string; mood: AvatarMood; label: string; inputValue?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof animateDot> | null>(null);
  const reduced = Boolean(useReducedMotion());
  const latest = useRef({ token, mood, reduced });
  const previousInput = useRef(inputValue);
  const options = useCallback((): DotRenderOptions => {
    const dark = document.documentElement.classList.contains('dark');
    return { token: latest.current.token, state: stateForMood[latest.current.mood], reduced: latest.current.reduced, color: dark ? '#F5F5F5' : '#181818', ink: dark ? '#F5F5F5' : '#181818' };
  }, []);
  useEffect(() => {
    let disposed = false;
    const observer = new MutationObserver(() => renderer.current?.update(options()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    void import('./vendor/dots-lab.js').then(({ animateDot }) => {
      if (!disposed && canvasRef.current) renderer.current = animateDot(canvasRef.current, options());
    });
    return () => { disposed = true; observer.disconnect(); renderer.current?.dispose(); renderer.current = null; };
  }, [options]);
  useEffect(() => {
    const previousMood = latest.current.mood;
    latest.current = { token, mood, reduced };
    renderer.current?.update(options());
    if (previousMood === 'listening' && mood === 'thinking') renderer.current?.react('input');
    if (previousMood !== mood && mood === 'thinking') playHomeSound('hum');
    if (previousMood !== mood && mood === 'ready') playHomeSound('chime');
  }, [token, mood, reduced, options]);
  useEffect(() => {
    if (reduced) return;
    const follow = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !canvasRef.current) return;
      if (latest.current.mood === 'writing') return;
      const box = canvasRef.current.getBoundingClientRect();
      renderer.current?.look((event.clientX - box.left - box.width / 2) / 280, (event.clientY - box.top - box.height / 2) / 220);
    };
    const reset = () => renderer.current?.resetLook();
    window.addEventListener('pointermove', follow, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('pointermove', follow);
      document.documentElement.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
    };
  }, [reduced]);
  useEffect(() => {
    if (previousInput.current !== inputValue && mood !== 'thinking' && mood !== 'writing' && mood !== 'error') {
      renderer.current?.look(.7, .25);
      renderer.current?.react('input');
      playHomeSound('pat', false, 900);
    }
    previousInput.current = inputValue;
  }, [inputValue, mood]);
  return <canvas ref={canvasRef} role="img" aria-label={label} data-testid="idea-avatar" data-mood={mood} data-dot-token={token}
    style={{ width: '100%', height: '100%' }} onPointerEnter={() => { if (mood !== 'thinking' && mood !== 'writing') renderer.current?.react('hover'); }}
    onClick={() => { if (mood !== 'thinking' && mood !== 'writing') { renderer.current?.react(); playHomeSound('perk', true); } }} />;
}
