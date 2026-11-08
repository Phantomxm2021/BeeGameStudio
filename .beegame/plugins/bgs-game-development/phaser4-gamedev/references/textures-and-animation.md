# Textures and animation

Use when integrating authored images, atlases or character action frames.

## Preserve the authored representation

A spritesheet is a regular frame grid; an atlas uses metadata for packed frames
of varying sizes. Load the PNG and matching metadata together. Frame names,
trimming, source dimensions and pivot data are part of the asset contract, not
values to infer from a preview thumbnail. A named atlas example:

```typescript
this.load.atlas('actors', 'assets/actors.png', 'assets/actors.json');
// Later, after the texture is ready:
const actor = this.add.sprite(x, y, 'actors', 'player/idle-0');
```

For sheets, use the file's actual frame dimensions, spacing and margin. For
animations, supply explicit frame order or a verified name/number range; visual
packing order is not necessarily action order. Keep one consistent anchor and
apparent character scale across frames; independently centered trimmed crops
can cause the feet or held prop to jump.

Load the selected assets through their existing source/production contract.
Atlas batching is a runtime packaging choice, not permission to redraw the art
or substitute a placeholder. Scale/rotation tweens can supplement an action;
they do not supply missing authored action poses.

For a source-contact offset or layered prop that looks detached despite correct
frame loading, see the [runtime assembly examples](../../game-content-pipeline-engineer/references/runtime-assembly-examples.md).

## State and playback ownership

The animation manager is shared across scenes. Reuse an existing animation key
when restarting a scene; do not create competing definitions under one name.
Avoid restarting the same loop every update; `play(key, true)` can preserve an
already-playing animation where supported by the installed API.

When a hurt/attack/death clip instantly becomes idle, trace all writers of
`play()` and the update state decision. A one-shot action needs precedence over
locomotion until its intended completion or interruption. Solve that ownership
in the existing state logic rather than replaying the clip every frame.

Use a one-shot completion listener for a finite clip, scoped to the intended
animation where possible. A looping clip does not produce the same completion
behavior. Remove obsolete listeners if the action is interrupted, and define
what should happen on cancellation/restart. Do not add a universal extra tick
or always stop before every `play()` based only on an upstream anecdote; check
the actual installed animation behavior and failing transition.

Source topics: phaser-animation, phaser-gameobj, phaser-asset-advisor.

Upstream technical source: [pinned skill collection](https://github.com/yakoub-ai/phaser4-gamedev/tree/1c1bf45dec3f0acbe8b2a963cc6dab93be31253a/skills).
