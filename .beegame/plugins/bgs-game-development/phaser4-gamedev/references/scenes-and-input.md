# Scenes and input

Use for restart, pause/resume, duplicated callbacks or input crossing overlays.

## Scene lifetime

`init(data)` establishes per-run inputs; `preload()` queues required files;
`create()` connects the ready scene; `update(time, delta)` advances its behavior.
A restarted scene can reuse its JavaScript instance, so reset per-run state
rather than assuming the constructor runs again. Animation and texture managers
are game-wide; scene restart is not a fresh global cache.

Choose transitions by the intended lifetime:

- `start`: replace the current scene with another run.
- `launch`: run another scene alongside it, for example an independent HUD.
- `pause` / `resume`: suspend and continue update behavior.
- `sleep` / `wake`: preserve a scene while suspending update and rendering.
- `stop`: shut down the current run; it can be started again later.

Do not introduce a separate scene for every panel. A local container is enough
when the panel shares the scene's lifetime and pause behavior.

## Ownership and cleanup

Scene-owned plugins handle their own lifecycle. Explicitly detach listeners on
longer-lived emitters (another scene, global event bus, DOM, scale manager), and
release externally owned resources when this scene shuts down. `SHUTDOWN` can
occur more than once for one instance; `DESTROY` is the final instance teardown.
A method merely named `shutdown()` is not an event subscription.

```typescript
const resize = () => this.relayout();
this.scale.on('resize', resize);
this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
  this.scale.off('resize', resize);
});
```

Timers use the scene clock while `setTimeout` uses wall time. Match the clock to
pause semantics rather than adding a second timer system. Repeated callbacks
after restart often indicate a listener on a longer-lived emitter.

## Input routing

Use a held key for continuous movement and an edge transition such as
`Phaser.Input.Keyboard.JustDown(key)` for one activation per press. Normalize a
diagonal direction before applying a fixed movement speed. Use the intended
camera to map pointer coordinates into world coordinates when it scrolls/zooms.

An overlay must deliberately consume input or suspend the underlying input
owner; drawing a rectangle does not disable the game underneath. A dragged
virtual joystick retains its original anchor and pointer ID until release;
re-centering its base on each move changes the gesture. Cross-scene controls
need an owner whose lifetime actually spans those scenes.

Source topics: phaser-scene, phaser-input; scene lifecycle also checked against
[official scene systems](https://github.com/phaserjs/phaser/blob/master/src/scene/Systems.js).

Upstream technical source: [pinned skill collection](https://github.com/yakoub-ai/phaser4-gamedev/tree/1c1bf45dec3f0acbe8b2a963cc6dab93be31253a/skills).
