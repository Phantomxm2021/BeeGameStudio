// Adapted from Bencho Command bar — MIT: https://bencho.dev/licence
import { useRef, useState, type CSSProperties, type Ref } from 'react';
import { Liquid } from 'liquid-gooey';
import { ArrowUp, Paperclip } from 'lucide-react';
import { useReducedMotion } from 'motion/react';

/* the one helper this file wants from the shared kit */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ── D · command bar ───────────────────────────────────── */
/* THE CHIP ROW IS GONE. Attach, Image and Project were three
   toggles that toggled nothing — the bar has no attachment to
   carry and never did, so what they demonstrated was a row of
   chips rather than a command bar. What is left is the field
   and the one action it can take. */
/* ── the split ────────────────────────────────────────────
   The bar and the send button are two bodies in one liquid
   group, and they are MORPH items rather than move ones: the
   library owns their x and animates the element and its
   silhouette in perfect sync, so while the button is leaving
   the two are still one body of liquid, necking thinner until
   the goo gives up.

   That choice carries a second one with it. Morph positions
   its items with a CSS transform on a real wrapper, in layout
   pixels, which scales correctly inside a scaled card on its
   own — so this component must NOT carry the 1/k correction
   every `move` group here needs. Applying it would over-shrink
   the silhouette until it sat smaller than the bar it is meant
   to be. Right for move, wrong for morph.

   ── THE BAR DOES NOT MOVE ───────────────────────────────
   The reference splits the offset between the two so the pair
   stays centred — the field slides one way while the button
   slides the other. That is right for a form that only ever
   holds those two things, and wrong here: everything inside
   the bar travels with it, so the mic fading out was also
   sliding sideways, and a thing that is leaving in two
   different ways at once reads as neither.

   So the whole offset goes on the button. The bar is fixed and
   the button walks out from under its right edge. The cost is
   that the composition is no longer centred at rest — it grows
   rightwards into the space the button will occupy, which is
   48px of slack on the right while nothing is typed. That is a
   fair trade for a field whose contents hold still. */
const CMD_BTN = 38;
const CMD_GAP = 8;
/* how far the button has to travel to be fused into the bar:
   its whole width plus the gap it would otherwise sit across,
   which lands its right edge exactly on the bar's */
const CMD_TUCK = CMD_BTN + CMD_GAP;
/* the reference's curve — a little past its target and back,
   so the neck snaps rather than easing apart */
const CMD_MORPH = { duration: 520, ease: 'cubic-bezier(0.22, 1.3, 0.71, 1)' } as const;

/* 28 is half of the bar's 56px height — the pill it already
   is, so the slider only runs downwards from the default. */
/* Adaptation: a 44px field needs a 22px pill radius. */
const CMD_CORNER = 22;

interface CommandBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputLabel: string;
  sendLabel: string;
  attachLabel: string;
  onAttach: () => void;
  onFocusChange?: (focused: boolean) => void;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  autoFocus?: boolean;
  hasAttachments?: boolean;
  bridge?: number;
  edge?: number;
  corner?: number;
}

export function CommandBar({
  /* How far apart the bar and the button still bridge, px, and
     it is deliberately LOW. A long neck reads as the button
     being reluctant to leave; a short one reads as it snapping
     off, which is what a control appearing the instant you
     type should feel like. */
  bridge = 3,
  /* how sharp the liquid edge is */
  edge = 22,
  /* the bar's corner, 0..28 */
  corner = CMD_CORNER,
  value: q, onChange, placeholder, inputLabel, sendLabel, attachLabel,
  onAttach, onFocusChange, inputRef, disabled = false, hasAttachments = false, autoFocus = false,
}: CommandBarProps) {
  const [live, setLive] = useState(false);
  const composing = useRef(false);
  const reducedMotion = useReducedMotion();

  /* ── OPEN ON FOCUS, NOT ON THE FIRST CHARACTER ────────────
     It used to key off content alone: the button appeared with
     the first keystroke and vanished when you deleted it,
     which puts the largest movement in the component in the
     middle of typing — the one moment you are looking at the
     words rather than at the bar.

     Clicking into the field is the moment you have decided to
     send something, so that is when the bar offers the way to.
     Content still counts on its own, so a field filled
     programmatically or restored from a draft opens it too. */
  const has = live || !!q.trim() || hasAttachments;
  const armed = !!q.trim() || hasAttachments;

  /* ── the split, heard ────────────────────────────────────
     The button leaving and returning is the largest thing this
     component does and it happened in silence. `expand` and
     `collapse` are the bench's two notes for something opening
     and closing, so it uses the same pair every other block
     does rather than inventing a sound of its own.

     A ref, not a plain effect on `has`: it must not fire on
     mount, and it must not fire again while you keep typing —
     only on the frame the state actually flips. */
  // The source no longer plays these sounds; BGS also keeps the split silent.

  /* ── send, and nothing after it ──────────────────────────
     This used to spend two seconds on "Working..." and then
     unfold a paragraph of invented answer. Neither belonged to
     the component: the shimmer was a loading state for a
     request that never happens, and the answer was a mock of
     somebody else's product wearing this one's clothes. What
     the block is about is the field and the split — so the
     send empties the field, and the button merges back into
     the bar it came from. The gesture has an outcome you can
     see, and it is the component's own. */
  // Product integration: the parent owns the real request and retains the
  // draft on errors. Submit the existing form instead of clearing it here.
  const run = (input: HTMLInputElement) => {
    /* it is not reachable with nothing to send — it is inside
       the bar and hidden — but Enter still arrives here */
    if (!armed || disabled) return;
    input.form?.requestSubmit();
  };

  return (
    <div className="bgs-command-bar" data-surface="flat" data-testid="command-bar"
      style={{ '--cmd-r': `${clamp(corner, 0, CMD_CORNER)}px` } as CSSProperties}>
      {/* OPAQUE FILL. --pane is rgba glass, and the goo's alpha
          contrast erases anything under about 0.39 — a
          translucent bar would not look faint here, it would
          not be drawn at all. Mixed from the fill's own ink and
          ground so it still inverts with the Fill control. */}
      <Liquid className="cmd-goo" blur={reducedMotion ? 0 : bridge} contrast={edge}
        fill="var(--fill-slab, var(--board))"
        /* NO SHADOW AT ALL. It carried a 1px ring first, which
           the Stroke switch could not turn off, and then a soft
           drop shadow — and the bar does not need lifting off
           anything. It is a flat white body on a flat card, and
           the only edge it should ever draw is the one Stroke
           asks for. */
        filterPadding={60}>
        {/* x is never set: the bar stays exactly where it is */}
        <Liquid.Item className="cmd-slot cmd-field-slot" transition={reducedMotion ? { duration: 0 } : CMD_MORPH}>
          {/* the bar gives up the width the button is taking — see .cmd */}
          <div className="cmd" data-has={has || undefined}>
            <input ref={inputRef} autoFocus={autoFocus} value={q} placeholder={placeholder} aria-label={inputLabel} disabled={disabled}
              onChange={event => onChange(event.target.value)}
              onFocus={() => { setLive(true); onFocusChange?.(true); }}
              /* it closes again when you leave — unless there
                 is something in it, which `has` already covers */
              onBlur={() => { setLive(false); onFocusChange?.(false); }}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing || composing.current) return;
                event.preventDefault();
                run(event.currentTarget);
              }}
              onPointerDown={event => event.stopPropagation()} />
            {/* ── the mic STAYS IN THE BAR ──────────────────
                It used to be the other face of the send button,
                which meant it rode out of the bar on the split:
                the icon you are watching disappear was also
                sliding right while it faded, and the two
                movements read as one confused thing. They are
                different objects with different jobs — the mic
                belongs to the field, the send button is what
                the field produces — so the mic sits still and
                simply goes. */}
            {/* BGS has real references, not dictation. Keep their picker
                stationary and available even while the user is typing. */}
            <button type="button" className="cmd-mic" data-show="true" disabled={disabled}
              aria-label={attachLabel} title={attachLabel}
              onPointerDown={event => event.stopPropagation()} onClick={onAttach}>
              <Paperclip size={18} strokeWidth={2} />
            </button>
          </div>
        </Liquid.Item>
        {/* One slot, two faces. Both are always mounted and
            crossfade in place — swapping the element would
            snap, and the swap is the whole point.

            At rest it is tucked inside the bar's right end and
            reads as a control within it; the first character
            typed pushes it out and the goo necks and breaks. */}
        <Liquid.Item className="cmd-slot" x={has ? 0 : -CMD_TUCK}
          transition={reducedMotion ? { duration: 0 } : CMD_MORPH}>
          {/* only ever Send. At rest it is tucked inside the
              bar with nothing drawn in it — a body for the goo
              to split from, and nothing else. */}
          <button type="submit" className="cmd-go"
            /* shown on focus, filled once there is something
               to send — see .cmd-go */
            data-on={has} data-armed={armed || undefined} disabled={disabled || !armed}
            tabIndex={has ? 0 : -1} aria-hidden={!has} aria-label={sendLabel} title={sendLabel}
            onPointerDown={event => event.stopPropagation()}>
            <ArrowUp size={20} strokeWidth={2} />
          </button>
        </Liquid.Item>
      </Liquid>
    </div>
  );
}
