---
name: game-art-director-expert
description: "Establish or repair game art direction: composition, visual style, color, lighting, materials, and VFX. Use for visual quality, not technical import or UI behavior alone. 中文：游戏美术、视觉风格、色彩、光照、特效。"
---

# Game Art Director

Translate player fantasy and gameplay information into a coherent visual language. Scope a sprite/lighting repair to its actual need rather than a new art bible.

- Establish mood, focal subject, viewing distance and readable categories such as threat, safe space, interactable and background. Relate prominence, foreground/play space/background and quiet areas in the owning design; a palette/asset list alone does not describe a finished screen.
- Choose shape, value, color, material, light, texture density, animation and VFX for the intended experience. Keep world and UI coherent with interaction/layout needs. Critical information cannot depend on color alone. Flat shapes, system fonts or sparse layouts can be valid but do not by themselves establish visual identity.
- Define shared control/subject treatments once, with observable differences and coexistence of applicable default, hover, pressed, focused, disabled and selected cues. Describe local exceptions; do not add unrequested screens, artwork or pixel-by-pixel specifications.
- For consequential feedback, specify subject, starting/ending appearance, motion, timing and sequence, plus relevant interruption/repetition/reset behavior. The ending appearance must match actual resulting state; animation completion does not prove a gameplay action occurred.

For new visual production, create complete-screen compositions covering planned UI states, Scene and needed props. Reuse pictures across UI/Scene responsibilities; another image needs an unresolved view/subject. Identify supplied images as inspiration, selected designs or runtime captures. Use reference-image inputs for derivatives preserving identity/composition.

Read selected pictures and reconcile affected ART_DIRECTION.md treatments (type/title, controls, depth and motion) with UI/Scene placement/actions before resources or layout JSON. Links/palettes alone are insufficient. Correct pictures that contradict confirmed requirements; resolve consequential conflicts through existing authorization, without changing scope. A document-only assignment stops before production. Runtime production preserves appearance while separating independently controlled parts; a flattened screen board is not runtime UI.

For modular families preserve scale, pivots, coordinates, materials and assembly transforms. Check provenance, use, compatibility and download/runtime cost of sourced assets. Inspect the smallest useful complete screen/scene before propagating an uncertain treatment; use available renders or authorized image tools. This is not another mandatory review stage.

Judge deliberate proportions, type/icon/material consistency, controlled emphasis, recognizable identity and readability at actual player scale/settings. If a focal subject loses prominence, correct composition rather than decorate it. For changes, compare the same player-facing moment before/after when available. Design consistency, valid manifests, builds, static previews, user silence and aesthetic scores do not prove delivered visual quality; state unavailable resource/runtime observations.

Read only references relevant to the current unresolved choice:
- [Composition studies](references/ui-visual-hierarchy.md): initial/substantially revised screen composition and concrete reference analysis; diagrams are not game templates.
- [Color language](references/color-language-system.md): material/world/UI relationships and transient versus persistent emphasis.
- [Shape language](references/shape-language-framework.md): silhouettes, proportions, detail, view angle and facing.
- [Lighting](references/lighting-mood-framework.md): spatial/material depth and illumination versus state indication.
- [Canal-crossing exercise](../game-level-designer-expert/references/encounter-design-patterns.md#worked-scene-reasoning-a-canal-crossing): action, camera and environmental identity tradeoffs, not a theme/layout default.
