import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Undo2, X } from 'lucide-react';
import { MagneticButton } from '../../beui/registry/components/motion/button/magnetic';
import { DotsAvatar } from './DotsAvatar';
import { useDailyAvatar } from './useDailyAvatar';
import { playHomeSound } from './homeSounds';
import styles from './AvatarDialogue.module.css';

export type AvatarMood = 'idle' | 'sleeping' | 'listening' | 'thinking' | 'writing' | 'ready' | 'error';
interface AvatarDialogueProps {
  mood: AvatarMood;
  heading?: string;
  description?: string;
  expanded: boolean;
  generatingOptions?: boolean;
  back?: { label: string; onClick: () => void; disabled?: boolean };
  close?: { label: string; onClick: () => void };
  inputValue?: string;
  children: ReactNode;
}
const geometryTransition = { duration: .5, ease: [.16, 1, .3, 1] as const };

export function AvatarDialogue({ mood, heading, description, expanded, generatingOptions = false, back, close, inputValue = '', children }: AvatarDialogueProps) {
  const { t } = useTranslation('landing');
  const reducedMotion = Boolean(useReducedMotion());
  const dotToken = useDailyAvatar();
  const [hour] = useState(() => new Date().getHours());
  const greeting = t(`avatar.${hour < 11 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}`);
  const messageHeading = heading || greeting;
  const messageDescription = description ?? t('avatar.invitation');
  const messageKey = `${messageHeading}/${messageDescription}`;
  const [playback, setPlayback] = useState({ key: messageKey, finished: false });
  if (playback.key !== messageKey) setPlayback({ key: messageKey, finished: false });
  const finishMessage = useCallback(() => setPlayback(current => current.key === messageKey && !current.finished ? { ...current, finished: true } : current), [messageKey]);
  const controlsRef = useRef<HTMLDivElement>(null);
  const controlsReady = reducedMotion || playback.key === messageKey && playback.finished;
  useEffect(() => {
    if (!controlsReady) return;
    controlsRef.current?.querySelector<HTMLElement>('[data-dialogue-focus]')?.focus();
  }, [controlsReady, messageKey]);
  const Presence = reducedMotion ? Fragment : AnimatePresence;
  return <section className={styles.scene} data-testid="avatar-dialogue" data-mood={mood} data-expanded={expanded} data-generating={generatingOptions} aria-label={t('avatar.conversation')}
    onClickCapture={event => { const button = (event.target as Element).closest('button'); if (button && !button.disabled) playHomeSound('knock', true); }}>
    <Presence {...(reducedMotion ? {} : { mode: 'wait' as const })}>
    <SpeechBubble key={messageKey} reducedMotion={reducedMotion}>
      <motion.div layout="position" className={back ? close ? styles.messageWithActions : styles.messageWithBack : undefined}>
        <TypedMessage heading={messageHeading} description={messageDescription} delay={heading ? 220 : 420} reducedMotion={reducedMotion} onComplete={finishMessage} />
      </motion.div>
      {controlsReady && !generatingOptions && back ? <div key={`back-${messageKey}`} className={styles.backCorner}>
        <div className={styles.revealItem}><MagneticButton variant="ghost" size="icon" className="size-9 rounded-full" aria-label={back.label} disabled={back.disabled} onClick={back.onClick}><Undo2 aria-hidden="true" className="size-5" /></MagneticButton></div>
        {close ? <div className={styles.revealItem} style={{ '--dialogue-order': 1 } as CSSProperties}><MagneticButton variant="ghost" size="icon" className="size-9 rounded-full" aria-label={close.label} onClick={close.onClick}><X aria-hidden="true" className="size-5" /></MagneticButton></div> : null}
      </div> : null}
      {/* Each utterance owns a fresh, initially hidden control layer. Mounting
          only after typing prevents children or reused animation values flashing. */}
      <motion.div key={messageKey} ref={controlsRef} layout="position" className={styles.content} inert={!controlsReady || generatingOptions} aria-hidden={!controlsReady || generatingOptions}
        data-testid="avatar-dialogue-controls" data-ready={controlsReady && !generatingOptions}>
        {controlsReady && !generatingOptions ? children : null}
      </motion.div>
    </SpeechBubble>
    </Presence>
    <div className={styles.characterSlot} data-testid="avatar-slot">
      <motion.div layout className={styles.character} initial={reducedMotion ? false : { y: 80, scale: .7, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', duration: reducedMotion ? 0 : .85, bounce: .35 }}>
        <DotsAvatar token={dotToken} mood={mood} inputValue={inputValue} label={t(`avatar.mood.${mood}`)} />
      </motion.div>
      {mood === 'thinking' ? <span className={styles.srOnly} role="status" aria-label={messageHeading}>{messageDescription}</span> : null}
    </div>
  </section>;
}

function SpeechBubble({ reducedMotion, children }: { reducedMotion: boolean; children: ReactNode }) {
  const present = useIsPresent();
  const hidden = !present;
  const contentRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ height: 0, resizing: false });
  useEffect(() => { playHomeSound('expand'); }, []);
  useLayoutEffect(() => {
    if (reducedMotion || !contentRef.current) return;
    const content = contentRef.current;
    // Animate the actual box height instead of layout projection, which
    // stretches text and controls. Its contents measure independently.
    const measure = () => {
      const height = content.offsetHeight + 2; // The surface's two 1px borders.
      setSize(current => current.height === height ? current : { height, resizing: true });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [reducedMotion]);
  return <motion.div className={styles.bubbleAssembly} data-testid="avatar-dialogue-assembly" data-exiting={!present}
    aria-hidden={hidden} inert={hidden} initial={false} animate={{ opacity: 1 }}
    exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .18 }}>
    <motion.div className={`${styles.bubble} ${styles.glassSurface}`} data-testid="avatar-dialogue-bubble" aria-hidden={hidden} inert={hidden}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1, height: !reducedMotion && size.height ? size.height : 'auto' }}
      style={{ overflow: size.resizing && !reducedMotion ? 'hidden' : 'visible' }}
      onAnimationComplete={() => setSize(current => current.resizing ? { ...current, resizing: false } : current)}
      transition={{ duration: reducedMotion ? 0 : .36, height: reducedMotion ? { duration: 0 } : geometryTransition, opacity: { delay: reducedMotion ? 0 : .12 }, ease: [.16, 1, .3, 1] }}>
      <div ref={contentRef} className={styles.bubbleContent}>{children}</div>
    </motion.div>
  </motion.div>;
}

function TypedMessage({ heading, description, reducedMotion, delay, onComplete }: { heading: string; description: string; reducedMotion: boolean; delay: number; onComplete: () => void }) {
  const headingChars = Array.from(heading);
  const descriptionChars = Array.from(description);
  const total = headingChars.length + descriptionChars.length;
  const [visible, setVisible] = useState(reducedMotion ? total : 0);

  useEffect(() => {
    if (reducedMotion) { onComplete(); return; }
    let frame = 0;
    let started: number | undefined;
    // Reveal by elapsed time rather than timer ticks, so dropped frames do not
    // slow the conversation. A short pause separates the two spoken lines.
    const reveal = (now: number) => {
      started ??= now;
      const elapsed = Math.max(0, now - started - delay);
      const headingDuration = headingChars.length * 32;
      const count = elapsed < headingDuration
        ? Math.floor(elapsed / 32)
        : headingChars.length + Math.floor(Math.max(0, elapsed - headingDuration - 120) / 24);
      setVisible(Math.min(total, count));
      if (count < total) frame = requestAnimationFrame(reveal);
      else onComplete();
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [headingChars.length, total, reducedMotion, delay, onComplete]);

  const count = reducedMotion ? total : visible;
  const typingHeading = count < headingChars.length;
  const cursor = <span className={styles.typingCursor} />;
  return <div className={styles.message} data-typing={count < total}>
    {/* Announce each complete message once; individual animation frames are visual only. */}
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{heading} {description}</p>
    <h1 className={styles.heading} aria-label={heading}>
      <span className={styles.typeReserve} aria-hidden="true">{heading}</span>
      <span className={styles.typeLayer} aria-hidden="true">{headingChars.slice(0, count).join('')}{typingHeading ? cursor : null}</span>
    </h1>
    <p className={styles.description} aria-label={description}>
      <span className={styles.typeReserve} aria-hidden="true">{description}</span>
      <span className={styles.typeLayer} aria-hidden="true">{descriptionChars.slice(0, Math.max(0, count - headingChars.length)).join('')}{!typingHeading && count < total ? cursor : null}</span>
    </p>
  </div>;
}
