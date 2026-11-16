---
name: game-ui-ux-designer
description: "Design and implement game interfaces: information organization, controls, focus and state-change motion. Use for first UI realization, new interface design or focused repair; includes XR placement, gaze/gesture input and ergonomic legibility when the interface is spatial."
---

# Game UI/UX Designer

Build interface subjects, control states, motion and input handoff from the current brief and settled decisions. For relationships being built or changed, read [Art](../game-art-director-expert/SKILL.md) for shared form/type/materials, or [Scene/spatial design](../game-scene-designer/SKILL.md) for playable visibility and space affected by the interface. For API mechanics, match the selected engine and version: [Phaser 4](../phaser4-gamedev/SKILL.md) for Phaser 4, [Three.js](../threejs-gamedev/SKILL.md) for Three.js, and corresponding APIs and documentation for Phaser 3 or other engines. Preserve confirmed rules, language requirements, devices and inputs; carry forward selected designs only for the subjects, visual properties and state changes they actually resolve, constructing any remaining expression rather than treating an implementation choice as a complete design. Reuse existing layout and transition code where it serves the intended information and control relationships under current conditions.

For a new complete game, default to working Simplified Chinese and English presentation with an in-game language choice, preserving explicit project language requirements and existing localization when revising a game. A baseline/player-visible language is not an exclusive language list. [Language and copy](../../references/type-and-copy.md#localize-the-player-facing-expression) covers messages, fonts, layout and switching; an API-only question, ordinary answer or focused repair does not expand into a localization retrofit. Voice translation is not a default deliverable.

## Compose around the player's decision

Decide what this view does for the player now, whether it introduces the game, supports an action in progress or brings choices together for comparison. Place controls and feedback in relation to the focal point and spatial relationships established by the art direction. A board, inventory or menu can itself be the playable surface. If a separate readout lets the player decide without looking at the subject, ask whether reading it is the intended activity. Use [task organization](../../references/player-task-studies.md#organize-information-and-actions) when choosing what must coexist or where focus returns.

Menus and results show what matters in that situation instead of repeating facts as headings, cards and captions. Familiar controls can fit; distinctiveness must not obscure available actions or require literal world props.

## Choose the interface representation

Identify what the player is acting on or reading. An object the player manipulates as part of play keeps its gameplay role even when a control handles its input. A readout or command presented to the player serves an interface role, including when it is attached to that same object.

For the interface, carry the adopted shapes, proportions, materials and visible control states into the artwork at play size. Reuse suitable assets and follow [resource production's source order](../game-content-pipeline-engineer/SKILL.md#acquire-and-deliver-usable-files) for missing artwork. Keep regions independent where they need to stretch or change separately. The runtime handles layout, live text, hit areas and playback.

## Make actions tangible and truthful

Give controls recognizable affordances and immediate acknowledgment, distinguishing accepted input from confirmed success. Hover, focus, press, selection and disabled treatments follow actual inputs and states, not a component checklist. Retain visible focus; essential touch actions cannot depend on hover.

Motion and UI sound express the control's role, material and consequence. A frequent small action and a major commitment need different emphasis, not the same bounce or ping. Coordinate with existing action feedback; overall music and soundscape keep their own design ownership.

## Build state-change motion

For each consequential state change in a new interface, connect the triggering action and current focus to the destination and next action. Use the adopted material and rhythm to express what persists, moves, reveals, settles or disappears. Carry this into actual subjects, properties, start/destination values and input handoff with the existing runtime. [Motion construction](../../references/motion-language.md#from-intent-to-implementation) turns that relationship into playback; press feedback alone does not express the screen change.

Use a cut for immediate repetition, a deliberate break of context, or an adopted static/reduced-motion presentation. Choose it for the affected transition while defining its purpose; do not infer that choice afterward from an instantaneous visibility toggle. A cut needs no artificial wait. A focused repair preserves existing working motion outside the affected relationship.

Align visibility, game state and accepted input. Keep an animated exit renderable until completion or cancellation, disabling its departing controls. Offer the destination's next action and sensible focus without delaying input or claiming success before confirmation; [input/state lifecycle](../../references/motion-language.md#input-and-state-lifecycle) handles interruption and return. Retry stays prompt; essential information survives reduced/silent presentation.

Observe the implemented passage through actual input at play speed: movement, renderability and control transfer. Compare it with the chosen change, reusing valid [observations](../../references/motion-language.md#runtime-observation). Design-only work records intent without claiming runtime verification.

## Spatial interfaces

When the interface occupies XR space, use [spatial interface construction](../../references/spatial-interface.md) for anchoring, viewing distance, gaze/gesture targeting and tracking-loss recovery on the actual device. Carry the same player task, visible states and input handoff into that placement. Body movement, room constraints and locomotion use [spatial gameplay](../spatial-computing-game-expert/SKILL.md).

## Detail for the current question

- [Playable relay study](../../references/relay-crossing.html): visible destination and control transfer; replay only for an unanswered question.
- [Task cases](../../references/player-task-studies.md#concrete-task-studies), [composition](../../references/ui-visual-hierarchy.md), [type/copy](../../references/type-and-copy.md): the corresponding design decision.
- [Visual production](../../references/visual-production.md): commissioned concepts or selected-picture reconciliation.
- [Resource production](../game-content-pipeline-engineer/SKILL.md): plan and obtain the required art inputs. [UI artwork sizing](../../references/production-integration.md#ui-artwork-at-runtime-size) and [layout calculation](../../references/layout-calculation.md) resolve actual size/padding/stretch/bounds. Missing required art remains a dependency.
