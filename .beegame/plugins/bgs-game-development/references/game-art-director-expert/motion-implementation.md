# Motion implementation comparisons

Use only when choosing a consequential representation or investigating weak/misleading dynamic feedback. These examples are implementation decisions, not required effects or tested solutions for another game. Start from the actual art/feel intent and supported renderer. Reuse the game's existing animation/event facilities. Transforms can express rigid changes or reinforce an animation, but do not create missing drawn shape changes; choose the representation for the affected subject rather than its category.

## Facing, motion and contact

| Intended information | Small implementation that may serve it | Mismatch to examine in play |
|---|---|---|
| A top-down rigid object has a readable heading | Rotate a suitable silhouette about its authored pivot; derive heading from the real movement/aim rule and retain the intended heading at rest | Rotation looks wrong for a perspective-painted sprite, the feet/wheels drift from contact, or heading is inferred from a visual tween rather than legal motion |
| A perspective-painted character turns between distinct poses | Select authored direction frames or a supported directional animation; retain logical scale/pivot and actual cadence | One painted pose slides in every direction, or changing frames shifts the apparent body position |
| A squash, lean or hover conveys acceleration/contact | Apply a restrained local transform to the visual child while simulation/collision stays authoritative, when that separation matches the design | Scaling/moving the collision root changes gameplay, a cosmetic lean suggests a direction that the object cannot move, or the effect never returns after interruption |

A circular/abstract subject may need no direction frame or lean. Contact deformation is not appropriate to every rigid material. Inspect start → turn → stop and any meaningful landing/contact, including the frames between stills. Choose the representation that preserves the intended shape, mass and camera view. More frames or particles are not a quality criterion.

For a local lean or positional follow-through, an existing engine tween can control a visual child's property. Stop/replace only that owned tween on a new action, cancellation or restart and restore its owned offset; do not reset the whole character or create a second motion clock. Frame animation follows the actual moving/stopped/action state; the sprite finishing is not a legal-action signal.

For bends, weighted meshes, morphs or contact constraints beyond rigid transforms, use [deformation cases](deformation-cases.md).

## Impact and persistent consequence

Suppose a contact activates an object. Gameplay confirms the subject and outcome, then presentation may emphasize that same subject with a brief material flash, deformation, sound or camera response. The object must also retain its resulting active appearance. A transient flash alone cannot communicate a persistent state, and playing the cue on attempted input can imply success when contact never happened.

Keep presentation, simulation and input clocks distinct: implement the intended pause or slowdown without accidentally freezing physics or accepting hidden controls. On cancellation, subject removal or scene change, finish a retained tail on its owning clock or release the owned callbacks/particles/offsets; stopping simulation alone is not an ending. Restore only owned overrides so another effect is not reset.

Use the real event boundary already in the project. Keep a short cue's start/contact/recovery relationships consistent with audio/feel decisions. Where dense events actually mask each other, merge or replace a specific effect rather than constructing a general scheduler. Inspect repeated contact, a missed attempt and restart during recovery: look for wrong subjects, disappearing outcomes, stale sound/particles and leftover camera offsets.

## Scene layers and VFX readability

The same particle may read differently behind the actor, at the contact surface or in screen space. Choose its source position, depth, scale and contrast from the intended physical relationship. A ground trail should not move with the camera as a HUD decoration unless that is designed. Preserve silhouettes, targets and useful quiet areas at the actual play scale before adding more particles or glow.

Compare a meaningful short sequence in the complete scene. A contact sheet can expose pose/pivot changes, while a clip or live observation exposes easing, continuity, cadence and cancellation. Use available runtime tools to observe the relevant action. The [player-path observation reference](../game-playtest-performance/play-capture.md) explains recording scope and clock limits. Inspect the passage and its actual input/state context; stills alone do not verify motion. Engine examples can inform implementation—[Godot's animation documentation](https://docs.godotengine.org/en/stable/tutorials/animation/index.html) and [platformer demo](https://github.com/godotengine/godot-demo-projects/tree/master/2d/platformer)—but use the actual target engine/version and assets.

## Sheet and sequence playback

Use the selected runtime's existing region/state/animation facilities. Static entries select their named bounds; discrete variants select the region mapped to the current state, without a playback clock. For temporal entries, select the intended sequence before selecting a frame. When implementing frame selection directly, advance per-instance elapsed time using the owning clock while that sequence plays; on a sequence change, apply its intended reset or resume behavior. Select frames from their cumulative durations, converting source time units once during import. A loop wraps within that sequence's duration; a one-shot reaches its defined ending or transition instead of wrapping accidentally. Derive the instance ending from the sequence and intended tail, rather than a shared lifetime that unintentionally holds the final frame. On a gameplay-state change, either finish the retained visual sequence on its owning clock or cancel it explicitly; stopping simulation alone must not leave a frozen instance. A scene-global frame modulo alone does not preserve sequence entry, reset or interruption. Gameplay state remains authoritative, and visual playback must not establish a hit or other rule outcome.

Judge the relevant result at its intended display scale and composition. For sequences, use playback to assess cadence, seams, clipping and unintended offsets; a contact sheet answers alignment/coverage questions but cannot prove continuity. Reuse valid observations and disclose what remains unobserved without adding generation/review loops.
