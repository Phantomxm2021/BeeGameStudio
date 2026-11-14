---
name: game-feel-designer
description: "Design, implement or repair device-to-action mappings, control response and coordinated event feedback for the selected inputs and camera. Use for first controls, action feel or a diagnosed mapping/response problem; assets and effects use their production methods. 中文：设备到动作映射、首次操作手感、动作节奏与事件反馈，以及具体控制和响应修复。"
---

# Game Controls and Feel

Make the current action's response and consequence perceptible and consistent with the game. Use actual actions, rules, pacing, art/audio direction and target inputs. A quiet puzzle, precision platformer and heavy combat game need different responses; spectacle cannot replace readable control.

## Map input to the intended action

Resolve the available actions, devices, camera and movement basis from the agreed mechanics and control definitions. Keep view orientation, body orientation and requested movement distinct where the scheme needs them. Preserve the chosen basis after camera changes and analog strength before applying the actual runtime's collision and movement rules; horizontal ground movement excludes pitch/roll, while flight can require them.

Use [screen controls](../../references/game-feel-designer/screen-controls.md) for keyboard, pointer, touch or gamepad mappings, or [XR locomotion](../../references/game-feel-designer/xr-locomotion.md) for tracked input and rig movement. Choose only the applicable mapping; a platform or profile label does not define the game's actions. A mapping defect uses [input diagnosis](../../references/game-feel-designer/interaction-acceptance.md), while response construction follows below.

## Shape the current action

For a first playable implementation, connect the intended sensation—precise placement, flowing travel, controllable weight or another relevant quality—to input response, motion through actual space and the consequence of a confirmed event. Carry the chosen relationships into the existing controller, event handler and presentation. A repair changes the diagnosed relationship, not a new feedback package. No separate feel report or fixed anticipation/contact/recovery sequence is required.

Use [control response](../../references/game-feel-designer/control-response.md) for constructing response or diagnosing stopping, turning, tolerance or feasibility. Distinguish input, simulation, spatial context and representation before choosing parameters; an isolated effect fix need not retune the controller.

Separate input acknowledgment, action execution, contact and consequence where meaningful. An attempt is not a hit; visual playback cannot establish damage or success. Preserve prompt acknowledgment rather than hide input latency behind animation. Consider acceleration, stopping, turning, repetition and interruption when they shape control. Visual follow-through is distinct from an input lock. Reconcile changed movement, action windows, collision results or simulation time with their gameplay definitions.

## Compose feedback across channels

Choose a primary cue and any reinforcement for their information and sensation, timing them against the same confirmed event and subject. Strong/weak events differ for a reason. Use the relevant construction method: [art realization](../game-art-director-expert/SKILL.md#realize-the-expression) for effects, [audio](../game-audio-designer/SKILL.md#choose-and-produce-the-audible-roles) for audible cues, or [UI](../game-ui-ux-designer/SKILL.md#make-actions-tangible-and-truthful) for interface feedback. Reuse settled choices and guidance already loaded; [sheet production](../../references/game-content-pipeline-engineer/spritesheet-production.md) prepares sheet-based feedback. Preserve targets, aim and essential HUD information.

Shake, hit stop, slow motion and haptics are optional. Distinguish presentation pauses from changes to gameplay time, input or audio; do not assume device capabilities or change physics as cosmetic tuning. For overlapping or interrupted events, decide which information takes priority and use the existing channel lifecycle. Retain essential feedback when a channel is reduced/unavailable without adding a general effects scheduler.

## Tune within scope

Use existing event/timing definitions rather than invent contact facts. During implementation, compare the affected action's response and emphasis at play speed with the intended sensation. Legal execution alone does not establish feel, and extra effects do not establish improvement. Retain unchanged observations and revise concrete mismatches. Planning records intent and uncertainty without claiming an unbuilt action feels good.

Stills cannot answer cadence or continuity: use the relevant live passage or recording. [Player-path observation](../../references/game-playtest-performance/play-capture.md) explains clock and selected-audio limits.

For an unresolved source comparison, use [comparative feel studies](../../references/game-feel-designer/comparative-feel-studies.md). The [playable relay study](../../references/relay-crossing.html) separates acknowledgment, commitment and contact. Reuse retained observations; replay only a passage that answers the current question. Research does not authorize new actions or a different game.
