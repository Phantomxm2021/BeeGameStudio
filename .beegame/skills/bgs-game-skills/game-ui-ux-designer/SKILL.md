---
name: game-ui-ux-designer
description: Design or repair non-XR game HUDs, menus, interface feedback and motion, navigation, gamepad focus, and input accessibility. For XR interfaces, use spatial UX. 中文：游戏界面、血条、菜单、界面切换与动效、手柄焦点、触屏布局。
---

# Game UI/UX Designer

Make current state and next actions clear without obscuring play. Use actual game loops, devices, inputs and UI vocabulary. Preserve agreed language, scaling and accessibility scope; examples do not authorize new screens, locales, settings or platforms. Scope repairs to affected behavior.

## Interaction and appearance

- Cover all planned screens/states, actions, navigation and authoritative information sources. Choose persistent/contextual/urgent cues for player decisions, distinguish world/screen space and resolve competing emphasis.
- Preserve art direction's focal subject, primary action, supporting information and quiet space—not only its palette. For initial/substantial composition work use shared [composition studies](../game-art-director-expert/references/ui-visual-hierarchy.md); do not default every screen to cards.
- Define control behavior and state transitions; reference shared appearance treatments in ART_DIRECTION.md and describe only local exceptions. Keep text/actions on button nodes; authored styles or images/frames can supply appearance.
- Specify in-scope inputs, focus/navigation, device switching and control-versus-gameplay-shortcut precedence. Derive prompts from real bindings. Coordinate overlays with gameplay/camera input and pointer lock; hidden is not necessarily disabled.
- Restore useful selection/scroll position or a valid replacement on return. Avoid replaying introductions on pause/retry. Include inventory/map/dialogue behavior only if present.
- Preserve IDs, hierarchy, text/images and state/action bindings. Read availability/results from authoritative state; cosmetic animation cannot announce readiness/success early. Check actual-size legibility, contrast and distinguishable disabled/pending/error states.

For unresolved hierarchy or interface language use [type and copy](references/type-and-copy.md), including optical grouping, mixed scripts and action consequences; this does not require restyling resolved screens.

## Layout and production

Allocate game view, information and controls before children: hierarchy, size/spacing limits, safe areas, overlays and insufficient-space behavior. Encode editable relationships, not per-viewport coordinate tables. Empty world space is not permanently safe for overlays. Choose supported orientations/sizes from requirements; use consistent padding/gaps/minima/scaling and verify minima after projection. Describe behavior outside supported conditions.

BGS screen UI keeps hierarchy in parentId, geometry in Yoga layout, appearance in style and connections in actions/bindings; it is distinct from Scene Canvas components. Native engine/DOM layouts retain their own facilities.

For new work, write screens/actions/navigation/space needs in UI_UX_SPEC.md before actual complete-screen visual designs. Compare selected pictures with the agreed element order, placement, prominence, actions and states. For reference-only delivery, report image paths and consequential unresolved deviations in the completion message; keep design documents unchanged unless the user explicitly requests a design change. Revise an affected complete screen with its existing image as reference, rather than adding component explanation boards. Resolve consequential conflicts before affected implementation. Use actual asset metrics when binding resources in the authored layout. Do not begin with placeholder UI JSON.

When authoring/checking saved BGS geometry, measuring fonts or integrating its renderer, read [layout calculation](references/layout-calculation.md) for CheckUiLayouts, schemas and consumer limits. Reuse the solver and authored game-view/camera relationships; edit source constraints, not computed positions. Geometry does not choose composition or interaction.

## Feedback and verification

Motion should communicate acknowledgment, context, continuity or outcome. Static feedback is valid. For consequential state/transition feedback read [motion, interruption and accessibility](references/motion-language.md#state-meaning-interruption-and-accessibility); preserve destination focus/input, cancellation, recovery and reduced-motion behavior. Separate input acknowledgment, execution and confirmed outcome. Essential information must not depend on animation completion, color or displacement alone.

Keep text/value ranges and typography traceable; specify overflow/formatting and label provisional metrics. For actual font measurement or runtime UI inspection, use the relevant section of [layout calculation](references/layout-calculation.md#runtime-typography-and-observation).
