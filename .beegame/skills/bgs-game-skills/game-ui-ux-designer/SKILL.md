---
name: game-ui-ux-designer
description: Design or repair non-XR game HUDs, menus, interface feedback and motion, navigation, gamepad focus, and input accessibility. For XR interfaces, use spatial UX. 中文：游戏界面、血条、菜单、界面切换与动效、手柄焦点、触屏布局。
---

# Game UI/UX Designer

Make current state and next actions clear without obscuring play. Use actual game loops, devices, inputs and UI vocabulary. Preserve agreed language, scaling and accessibility scope; examples do not authorize new screens, locales, settings or platforms. Scope repairs to affected behavior.

## GDD decisions

- Cover all planned screens/states, actions, navigation and authoritative information sources. Choose persistent/contextual/urgent cues for player decisions, distinguish world/screen space and resolve competing emphasis.
- Preserve art direction's focal subject, primary action, supporting information and quiet space—not only its palette. For initial/substantial composition work use shared [composition studies](../game-art-director-expert/references/ui-visual-hierarchy.md); do not default every screen to cards.
- Define control behavior and state transitions; reference shared appearance treatments in the Art direction chapter of `docs/GDD.md` and describe only local exceptions. Keep text and actions on their actual controls; styles or images/frames can supply appearance.
- Specify in-scope inputs, focus/navigation, device switching and control-versus-gameplay-shortcut precedence. Derive prompts from real bindings. Coordinate overlays with gameplay/camera input and pointer lock; hidden is not necessarily disabled.
- Restore useful selection/scroll position or a valid replacement on return. Avoid replaying introductions on pause/retry. Include inventory/map/dialogue behavior only if present.
- Tie availability/results to authoritative game state; cosmetic animation cannot announce readiness or success early. Hand off the required distinctions, including disabled/pending/error states where relevant.

The GDD handoff is the screen/state flow, information/action hierarchy and play-area/overlay relationships. Final geometry, measured typography and decorative motion depend on selected visuals and resources. Read [type and copy](references/type-and-copy.md) only for an unresolved hierarchy or language choice.

## Layout and production

During layout production, allocate game view, information and controls before children, including safe areas, overlays and insufficient-space behavior. Empty world space is not permanently safe for overlays. Use supported orientations/sizes and native layout constraints rather than per-viewport coordinate tables; verify minima after projection. Preserve IDs, hierarchy and action/state bindings.

For visual production, compare selected complete-screen pictures with the GDD’s hierarchy, actions and states. For reference-only delivery, report image paths and consequential unresolved deviations in the completion message; keep the GDD unchanged unless the user explicitly requests a design change. Revise an affected complete screen with its existing image as reference, rather than adding component explanation boards. Resolve consequential conflicts before affected implementation. Author the selected composition with its focal subjects, relative proportions and state-specific appearances, using delivered asset metrics or the authored dimensions of the selected procedural representation. Missing required artwork remains a production dependency; it does not authorize redesigning the screen around generic shapes. Compare the implemented screen at the corresponding state with the selected picture; geometry and JSON checks do not establish visual agreement. Do not begin with placeholder UI JSON.

Use the chosen engine or DOM layout and font measurement facilities. Only when maintaining existing BGS UI JSON with host-exposed diagnostics, read [saved BGS layout calculation](references/layout-calculation.md). Geometry does not choose composition or interaction.

## Feedback and verification

When producing or verifying motion, distinguish acknowledgment, continuity and confirmed outcome. Static feedback is valid. For a consequential transition read [motion, interruption and accessibility](references/motion-language.md#state-meaning-interruption-and-accessibility); preserve destination focus/input, cancellation, recovery and reduced-motion behavior. Separate input acknowledgment, execution and confirmed outcome. Essential information must not depend on animation completion, color or displacement alone.

Keep text/value ranges and typography traceable; measure delivered fonts, specify overflow/formatting and label provisional metrics. Inspect agreed screens/states in the target runtime at supported sizes and inputs: wrapping, overlap, clipping, hierarchy, world visibility, focus, actions and motion. DOM presence or still images alone do not establish visual quality or motion. Reuse unchanged measurements and label unavailable observations.
