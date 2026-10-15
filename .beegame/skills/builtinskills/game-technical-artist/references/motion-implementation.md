# Motion implementation comparisons

Use only when choosing a consequential representation or investigating weak/misleading dynamic feedback. These examples are implementation decisions, not required effects or tested solutions for another game. Start from the actual art/feel intent and supported renderer. Reuse the game's existing animation/event facilities.

## Facing, motion and contact

| Intended information | Small implementation that may serve it | Mismatch to examine in play |
|---|---|---|
| A top-down rigid object has a readable heading | Rotate a suitable silhouette about its authored pivot; derive heading from the real movement/aim rule and retain the intended heading at rest | Rotation looks wrong for a perspective-painted sprite, the feet/wheels drift from contact, or heading is inferred from a visual tween rather than legal motion |
| A perspective-painted character turns between distinct poses | Select authored direction frames or a supported directional animation; retain logical scale/pivot and actual cadence | One painted pose slides in every direction, or changing frames shifts the apparent body position |
| A squash, lean or hover conveys acceleration/contact | Apply a restrained local transform to the visual child while simulation/collision stays authoritative, when that separation matches the design | Scaling/moving the collision root changes gameplay, a cosmetic lean suggests a direction that the object cannot move, or the effect never returns after interruption |

A circular/abstract subject may need no direction frame or lean. Contact deformation is not appropriate to every rigid material. Inspect start → turn → stop and any meaningful landing/contact, including the frames between stills. Choose the representation that preserves the intended shape, mass and camera view. More frames or particles are not a quality criterion.

For a local lean or positional follow-through, an existing engine tween can control a visual child's property. Stop/replace only that owned tween on a new action, cancellation or restart and restore its owned offset; do not reset the whole character or create a second motion clock. Frame animation follows the actual moving/stopped/action state; the sprite finishing is not a legal-action signal.

## Impact and persistent consequence

Suppose a contact activates an object. Gameplay confirms the subject and outcome, then presentation may emphasize that same subject with a brief material flash, deformation, sound or camera response. The object must also retain its resulting active appearance. A transient flash alone cannot communicate a persistent state, and playing the cue on attempted input can imply success when contact never happened.

Use the real event boundary already in the project. Keep a short cue's start/contact/recovery relationships consistent with audio/feel decisions. Where dense events actually mask each other, merge or replace a specific effect rather than constructing a general scheduler. Inspect repeated contact, a missed attempt and restart during recovery: look for wrong subjects, disappearing outcomes, stale sound/particles and leftover camera offsets.

## Scene layers and VFX readability

The same particle may read differently behind the actor, at the contact surface or in screen space. Choose its source position, depth, scale and contrast from the intended physical relationship. A ground trail should not move with the camera as a HUD decoration unless that is designed. Preserve silhouettes, targets and useful quiet areas at the actual play scale before adding more particles or glow.

Compare a meaningful short sequence in the complete scene. A contact sheet can expose pose/pivot changes, while a clip or live observation exposes easing, continuity, cadence and cancellation. The supplied Preview can capture stills or run a focused project-owned input test; its shared [optional player-path helper](../../game-playtest-performance/references/play-capture.md) retains silent video and selected stills for that same test. Inspect the clip and its input/state assertions; stills alone do not verify motion. Use its native Skill-load facts when investigating whether the relevant method was loaded, while application/visual quality remain separate judgments. Engine examples can inform implementation—[Godot's animation documentation](https://docs.godotengine.org/en/stable/tutorials/animation/index.html) and [platformer demo](https://github.com/godotengine/godot-demo-projects/tree/master/2d/platformer)—but use the actual target engine/version and assets.
