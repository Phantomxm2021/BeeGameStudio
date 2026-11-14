---
name: game-ui-ux-designer
description: "Design and implement game interfaces: information organization, controls, focus and state-change motion. Use for first UI realization, new interface design or focused repair; includes XR placement, gaze/gesture input and ergonomic legibility when the interface is spatial. 中文：游戏界面的信息、控件、焦点和转场实现，含空间界面的布局、手势与可读性。"
---

# Game UI/UX Designer

Build interface subjects, control states, motion and input handoff from the current brief and settled decisions. For relationships being built or changed, read [Art](../game-art-director-expert/SKILL.md) for shared form/type/materials, or [Scene/spatial design](../game-scene-designer/SKILL.md) for playable visibility and space affected by the interface. For API mechanics, match the selected engine and version: [Phaser 4](../phaser4-gamedev/SKILL.md) for Phaser 4, [Three.js](../threejs-gamedev/SKILL.md) for Three.js, and corresponding APIs and documentation for Phaser 3 or other engines. Preserve confirmed rules, language requirements, devices and inputs; carry forward selected designs only for the subjects, visual properties and state changes they actually resolve, constructing any remaining expression rather than treating an implementation choice as a complete design. Reuse existing layout and transition code where it serves the intended information and control relationships under current conditions.

For a new complete game, default to working Simplified Chinese and English presentation with an in-game language choice, preserving explicit project language requirements and existing localization when revising a game. A baseline/player-visible language is not an exclusive language list. [Language and copy](../../references/game-ui-ux-designer/type-and-copy.md#localize-the-player-facing-expression) covers messages, fonts, layout and switching; an API-only question, ordinary answer or focused repair does not expand into a localization retrofit. Voice translation is not a default deliverable.

## Compose around the player's decision

Start from the player's current task: reading while acting, inspecting a subject, comparing alternatives, or planning and committing. Decide which information and actions must coexist and where the player returns. Arrange their actual visual bounds and input regions in the current container, choosing placement alongside play, an overlay or a state change according to that task. Carry the arrangement into the existing layout constraints. Use [task organization](../../references/game-ui-ux-designer/player-task-studies.md#organize-information-and-actions) for the relevant information relationship; these are decision contexts, not required screen types. A board, inventory or menu can itself be the playable surface.

Menus and results show what matters in that situation instead of repeating facts as headings, cards and captions. Familiar controls can fit; distinctiveness must not obscure available actions or require literal world props.

## Choose the interface representation

Compare the required shapes, proportions, material detail and visible state changes at gameplay size with what the selected runtime can express. Preserve explicit source choices and suitable existing assets. Use native geometry, typography, styles or materials when they form the intended visual expression; a simple outline, interactive role or ease of coding does not establish that fit.

Where specific authored forms or surface detail are needed, define the required artwork and any fixed, stretchable or independently changing regions its consumer needs, in a target-engine-supported representation. Layout, live text, hit areas and playback retain their runtime ownership. These consumer needs determine the art inputs while keeping responsive layout and control behavior in the interface implementation.

## Make actions tangible and truthful

Give controls recognizable affordances and immediate acknowledgment, distinguishing accepted input from confirmed success. Hover, focus, press, selection and disabled treatments follow actual inputs and states, not a component checklist. Retain visible focus; essential touch actions cannot depend on hover.

Motion and UI sound express the control's role, material and consequence. A frequent small action and a major commitment need different emphasis, not the same bounce or ping. Coordinate with existing action feedback; overall music and soundscape keep their own design ownership.

## Build state-change motion

For each consequential state change in a new interface, connect the triggering action and current focus to the destination and next action. Use the adopted material and rhythm to express what persists, moves, reveals, settles or disappears. Carry this into actual subjects, properties, start/destination values and input handoff with the existing runtime. [Motion construction](../../references/game-ui-ux-designer/motion-language.md#from-intent-to-implementation) turns that relationship into playback; press feedback alone does not express the screen change.

Use a cut for immediate repetition, a deliberate break of context, or an adopted static/reduced-motion presentation. Choose it for the affected transition while defining its purpose; do not infer that choice afterward from an instantaneous visibility toggle. A cut needs no artificial wait. A focused repair preserves existing working motion outside the affected relationship.

Align visibility, game state and accepted input. Keep an animated exit renderable until completion or cancellation, disabling its departing controls. Offer the destination's next action and sensible focus without delaying input or claiming success before confirmation; [input/state lifecycle](../../references/game-ui-ux-designer/motion-language.md#input-and-state-lifecycle) handles interruption and return. Retry stays prompt; essential information survives reduced/silent presentation.

Observe the implemented passage through actual input at play speed: movement, renderability and control transfer. Compare it with the chosen change, reusing valid [observations](../../references/game-ui-ux-designer/motion-language.md#runtime-observation). Design-only work records intent without claiming runtime verification.

## Spatial interfaces

When the interface occupies XR space, use [spatial interface construction](../../references/game-ui-ux-designer/spatial-interface.md) for anchoring, viewing distance, gaze/gesture targeting and tracking-loss recovery on the actual device. Carry the same player task, visible states and input handoff into that placement. Body movement, room constraints and locomotion use [spatial gameplay](../spatial-computing-game-expert/SKILL.md).

## Detail for the current question

- [Playable relay study](../../references/relay-crossing.html): visible destination and control transfer; replay only for an unanswered question.
- [Task cases](../../references/game-ui-ux-designer/player-task-studies.md#concrete-task-studies), [composition](../../references/game-art-director-expert/ui-visual-hierarchy.md), [type/copy](../../references/game-ui-ux-designer/type-and-copy.md): the corresponding design decision.
- [Visual production](../../references/game-art-director-expert/visual-production.md): commissioned concepts or selected-picture reconciliation.
- [Resource production](../game-content-pipeline-engineer/SKILL.md): plan and obtain the required art inputs. [UI artwork sizing](../../references/game-content-pipeline-engineer/production-integration.md#ui-artwork-at-runtime-size) and [layout calculation](../../references/game-ui-ux-designer/layout-calculation.md) resolve actual size/padding/stretch/bounds. Missing required art remains a dependency.
