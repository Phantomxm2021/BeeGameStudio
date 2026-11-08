# React hosting a Phaser runtime

Read for a React-hosted game with duplicate canvases, repeated boot, stale HUD,
leaked listeners or UI/game state disagreement. This is an integration example,
not a requirement to use React, a shared store or a new event framework.

## Own the engine instance at the host lifetime

Create the runtime after its DOM mount exists; destroy that owned instance at
cleanup. React development Strict Mode exercises setup/cleanup again. Making
that lifecycle correct is preferable to turning Strict Mode off or using a flag
that prevents the second setup after the first instance was destroyed.

```tsx
import { useLayoutEffect, useRef } from 'react';
import type Phaser from 'phaser';

type Props = { startGame: (parent: HTMLElement) => Phaser.Game };

export function GameHost({ startGame }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const game = startGame(mount.current!);
    return () => game.destroy(true);
  }, [startGame]);
  return <div ref={mount} className="game-mount" />;
}
```

`startGame` is the project's existing factory using its real configuration and
scenes. Keep its identity stable while that runtime configuration is unchanged;
passing a new inline function on each score update would recreate the game.
The cleanup captures its own instance. It does not dispose another mount's game
or clear the whole shared event bus. Phaser's destruction follows its engine
lifecycle; follow the installed API when coordinating asynchronous teardown.

The [official Phaser React template](https://github.com/phaserjs/template-react/blob/main/src/PhaserGame.jsx)
uses a layout effect for the host and destroys the game at cleanup. The example
above is a smaller independently written host, not a copy of its scaffold or
an instruction to adopt its dependency versions, scripts or event bus.

## Bridge state without a second simulation

Keep the existing owner of game rules, clocks and outcomes. React controls can
request actions; the owner decides whether they are legal and publishes the
result. Do not copy score, pause rules or a wave timer into a second independent
React simulation merely to display them.

For event-based UI, subscribe and unsubscribe the same callback, and read the
current value after subscribing so an earlier ready/score event is not the only
way to obtain initial state. Remove only the host's listener, not every listener
with that event name. A scene reference becomes usable at its actual ready
boundary and can become stale after scene replacement.

If the game already exposes a store, React's subscription hook can consume it:

```tsx
import { useSyncExternalStore } from 'react';

type HudSnapshot = Readonly<{ score: number; lives: number }>;
type HudSource = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => HudSnapshot;
};

export function Score({ source }: { source: HudSource }) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  return <output>{snapshot.score}</output>;
}
```

This client-only fragment assumes the existing source has stable, bound methods.
`getSnapshot` returns the same cached immutable object until values change;
creating a new object on every read can cause repeated updates. Publish the HUD
facts needed by React, not every actor's position on every frame. An existing
simple event bridge need not be replaced by a generic store for this example.

## Match the DOM HUD to the displayed canvas

`FIT` can letterbox the game. Anchor its DOM HUD to the canvas display rectangle,
not automatically to the window. In an untransformed, borderless, unscrolled
wrapper, the offset is canvasRect.left/top minus wrapperRect.left/top; the HUD
surface uses canvasRect.width/height. Logical HUD coordinates become fractions
of that surface. CSS pixels and device backing pixels are different units.
Refresh that alignment at the relevant layout/scale change, cleaning up the
owned observer/listener. A modal's visual overlay also needs deliberate input
ownership; drawing it does not stop underlying game input.

Sources: [React effect lifecycle and Strict Mode](https://react.dev/reference/react/useEffect),
[external-store subscription and snapshot identity](https://react.dev/reference/react/useSyncExternalStore),
[canvas rectangle coordinates](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect).
