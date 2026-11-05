---
name: game-ui-ux-designer
description: "Resolve a non-XR interface behavior, navigation, information hierarchy or layout problem; implement or repair the affected UI. 中文：具体界面行为、导航、信息层级与布局问题。"
---

# Game UI/UX Designer

Make current state and next actions clear through the game's visual language. UI may support world interaction or be the main playable subject. Use actual game loops, devices, inputs and UI vocabulary. Preserve agreed language, scaling and accessibility scope; examples do not authorize new screens, locales, settings or platforms. Scope repairs to affected behavior.

## Interface decisions

For an interface question, start from the player’s situation, what they need to understand or do, and the gameplay result. Compare candidate arrangements by clarity, effort and interference with play. Resolve the relevant state, action, navigation or composition question; record the resulting choice with the situation it supports, referencing existing gameplay and appearance definitions.

When the choice involves a transition, describe its conditions, destination and retained state so the action has an unambiguous result. Ordinary focus, device switching and control activation follow the selected platform and engine conventions; describe design-specific exceptions by their player-visible consequences. Availability and result cues follow authoritative game state; cosmetic animation cannot announce readiness or success early. Disabled, pending and error treatments apply to states the player actually encounters. Exact coordinates and measured typography follow actual resources and runtime.

Use [player-task studies](references/player-task-studies.md) for an unresolved information-priority or menu-cost question, [composition studies](../game-art-director-expert/references/ui-visual-hierarchy.md) for a consequential layout choice, or [type and copy](references/type-and-copy.md) for a hierarchy or language question.

## Visual design

For document-only interface work, use the decision method above; when a broad style still needs a concrete interface treatment, examine relevant shape, subject prominence and world/UI relationships through the shared [finished-game pictures](../game-art-director-expert/references/ui-visual-hierarchy.md#finished-game-references). Reuse selected project pictures once established. When assigned to produce or review the project's screen concepts, read shared [visual production](../game-art-director-expert/references/visual-production.md) and translate the GDD's player situations, layout and art direction into a concise image brief, preserving information, actions and applicable constraints. Use image design to develop concrete appearance and resolve open visual details. Follow that shared method for concept inspection and the existing visual handoff. A local runtime repair need not restart visual exploration.

## Runtime layout

During layout production, allocate game view, information and controls from the actual container, including safe areas and overlays. Use native constraints, suitable scaling and reflow to preserve the intended composition and usable actions. Reference dimensions define design coordinates; minimum playable dimensions need explicit user requirements or observed readability/input limits with actual resources. Resolve insufficient space from those limits rather than turning a reference size into a blocking screen. Preserve IDs, hierarchy and action/state bindings.

Resolve consequential conflicts with the required appearance before affected implementation. When creating or replacing UI skins or decorative icons, read [artwork production](../game-content-pipeline-engineer/references/artwork-production.md) before choosing their source or representation; reuse guidance retained in context. Layout and control code consume that artwork. Use actual artwork dimensions for focal subjects, relative proportions and state-specific appearances, and the [UI artwork method](../game-content-pipeline-engineer/references/production-integration.md#ui-artwork-at-runtime-size) for size, padding, transparent edges and stretch regions. Missing required artwork remains a production dependency; it does not authorize redesigning the screen around generic shapes. Compare the implemented state with its owning appearance definitions and any selected picture. When revising an existing HUD, keep the underlying gameplay capture and framing unchanged while comparing UI treatments, so a different background cannot conceal obstruction or contrast problems.

Use the chosen engine or DOM layout and font measurement facilities. Read native layout, text and input geometry in the actual composition; geometry does not choose composition or interaction.

## Feedback and verification

When producing or verifying motion, distinguish acknowledgment, continuity and confirmed outcome. Static feedback is valid. For a consequential transition read [motion, interruption and accessibility](references/motion-language.md#state-meaning-interruption-and-accessibility); preserve destination focus/input, cancellation, recovery and reduced-motion behavior. Separate input acknowledgment, execution and confirmed outcome. Essential information must not depend on animation completion, color or displacement alone.

For text, font or layout changes, check delivered typography and value ranges where needed to resolve wrapping, overlap, clipping or overflow. Inspect the affected layout or control in the target runtime at supported sizes and inputs, including changed focus or action behavior. Reuse unchanged measurements and label unavailable observations.
