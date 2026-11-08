---
name: game-ui-ux-designer
description: "Design and implement non-XR game HUDs, menus, overlays, layout and interface motion, from first production to a focused repair. 中文：游戏界面首次设计制作、布局与动效，以及具体交互问题修复。"
---

# Game UI/UX Designer

Make current state and next actions clear through the game's visual language. UI may support world interaction or be the main playable subject. Use actual game loops, devices, inputs and UI vocabulary. Preserve agreed language, scaling and accessibility scope; examples do not authorize new screens, locales, settings or platforms. Scope repairs to affected behavior.

## Interface decisions

For an interface question, start from the player’s situation, what they need to understand or do, and the gameplay result. Compare candidate arrangements by clarity, effort and interference with play. Resolve the relevant state, action, navigation or composition question; record the resulting choice with the situation it supports, referencing existing gameplay and appearance definitions.

For a navigation choice, describe its UI-specific trigger, destination and retained interface state, using the existing gameplay definitions for outcomes. Ordinary focus, device switching and control activation follow the selected platform and engine conventions; describe design-specific exceptions by their player-visible consequences. Availability and result cues follow authoritative game state; cosmetic animation cannot announce readiness or success early. Disabled, pending and error treatments apply to states the player actually encounters. Exact coordinates and measured typography follow actual resources and runtime.

Use [player-task studies](references/player-task-studies.md) for an unresolved information-priority or menu-cost question, [composition studies](../game-art-director-expert/references/ui-visual-hierarchy.md) for a consequential layout choice, or [type and copy](references/type-and-copy.md) for a hierarchy or language question.

## Visual design

Compose the first interface around what the player attends to before acting and what takes their attention next. In the first playable preview, see whether the arrangement directs that shift and the destination accepts control when expected. Rework provisional framing or persistent controls that compete with the action. The shared [playable relay study](../references/relay-crossing.html) shows how a marked destination stays visible as control moves from dispatch to the switch. Preserve user-specified or selected visual designs. The shared [finished-game pictures](../game-art-director-expert/references/ui-visual-hierarchy.md#finished-game-references) can inform a visual comparison. For screen-concept production or review, read shared [visual production](../game-art-director-expert/references/visual-production.md) and translate the GDD's player situations, information and art direction into a concise image brief, preserving actions and applicable constraints. Use image design to develop concrete appearance and resolve open visual details. Follow that shared method for concept inspection and the existing visual handoff. A local runtime repair need not restart visual exploration.

## Runtime layout

Allocate from the actual container, including safe areas and overlays. Use native constraints, suitable scaling and reflow to preserve the intended composition and usable actions. Preserve subject proportions when mapping design coordinates to the container; scale the shared playfield consistently and reflow interface regions rather than stretching subjects independently across axes. Reference dimensions define design coordinates; minimum playable dimensions need explicit user requirements or observed readability/input limits with actual resources. Resolve insufficient space from those limits rather than turning a reference size into a blocking screen. Preserve IDs, hierarchy and action/state bindings.

Resolve consequential conflicts with the required appearance before affected implementation. When creating or replacing UI skins or decorative icons, read [artwork production](../game-content-pipeline-engineer/references/artwork-production.md) before choosing their source or representation; reuse guidance retained in context. Layout and control code consume that artwork. Use actual artwork dimensions for focal subjects, relative proportions and state-specific appearances, and the [UI artwork method](../game-content-pipeline-engineer/references/production-integration.md#ui-artwork-at-runtime-size) for size, padding, transparent edges and stretch regions. Missing required artwork remains a production dependency; it does not authorize redesigning the screen around generic shapes. Compare the implemented state with its owning appearance definitions and any selected picture. When revising an existing HUD, keep the underlying gameplay capture and framing unchanged while comparing UI treatments, so a different background cannot conceal obstruction or contrast problems.

Use the chosen engine or DOM layout and font measurement facilities. For a concrete bounds, scaling or coordinate question, read [runtime layout calculations](references/layout-calculation.md). Read native layout, text and input geometry in the actual composition; geometry does not choose composition or interaction.

## Feedback and verification

When producing or verifying motion, distinguish acknowledgment, continuity and confirmed outcome. Static feedback is valid. For a consequential transition read [motion, interruption and accessibility](references/motion-language.md#state-meaning-interruption-and-accessibility); preserve destination focus/input, cancellation, recovery and reduced-motion behavior. Separate input acknowledgment, execution and confirmed outcome. Essential information must not depend on animation completion, color or displacement alone.

For text, font or layout changes, check delivered typography and value ranges where needed to resolve wrapping, overlap, clipping or overflow. Use targeted runtime inspection to resolve a concrete layout/control construction issue. When verification is a separate assignment, that work checks the supported sizes and inputs, including focus and action behavior; implementation supplies the layout intent and known gaps. Reuse unchanged measurements and label unavailable observations.
