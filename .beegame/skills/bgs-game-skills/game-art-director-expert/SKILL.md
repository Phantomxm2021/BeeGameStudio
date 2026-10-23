---
name: game-art-director-expert
description: "Establish or repair game art direction: composition, visual style, color, lighting, materials, and VFX. Use for visual quality, not technical import or UI behavior alone. 中文：游戏美术、视觉风格、色彩、光照、特效。"
---

# Game Art Director

Translate player fantasy and gameplay information into a coherent visual language. Scope a sprite/lighting repair to its actual need rather than a new art bible.

When supplied designs and prior research leave a consequential visual choice open, use focused web research and inspect the actual reference images before settling it. Compare the relevant composition, proportions, layers, lighting, materials or motion, and explain how the chosen treatment serves this game's needs. Keep source links and the adopted or adapted conclusions in ART_DIRECTION.md, reusing them in later resource planning. Stop when the open choice is resolved; an established direction needs no repeated reference search or separate research board. A visual reference is not permission to reuse its asset files.

- Establish mood, focal subject, viewing distance and readable categories such as threat, safe space, interactable and background. Relate prominence, foreground/play space/background and quiet areas in the owning design; a palette/asset list alone does not describe a finished screen. For a cue that tells the player where an action is possible, safe, risky or confirmed, name the existing gameplay condition and its owner; choose visual treatment that communicates that condition without silently changing the rule.
- Choose shape, value, color, material, light, texture density, animation and VFX for the intended experience. Keep world and UI coherent with interaction/layout needs. Critical information cannot depend on color alone. Flat shapes, system fonts or sparse layouts can be valid but do not by themselves establish visual identity.
- Define shared control/subject treatments once, with observable differences and coexistence of applicable default, hover, pressed, focused, disabled and selected cues. Describe local exceptions; do not add unrequested screens, artwork or pixel-by-pixel specifications.
- For consequential feedback, specify subject, starting/ending appearance, motion, timing and sequence, plus relevant interruption/repetition/reset behavior. The ending appearance must match actual resulting state; animation completion does not prove a gameplay action occurred.

For actual visual production or a concrete production feasibility question, read [visual production](references/visual-production.md) for complete-screen designs, reference reuse, reconciliation and asset boundaries. A document-only assignment ends before production; unproduced visuals stay planned inputs.

Judge deliberate proportions, type/icon/material consistency, controlled emphasis, recognizable identity and readability at actual player scale/settings. If a focal subject loses prominence, correct composition rather than decorate it. For changes, compare the same player-facing moment before/after when available. Design consistency, valid manifests, builds, static previews, user silence and aesthetic scores do not prove delivered visual quality; state unavailable resource/runtime observations.

Read only references relevant to the current unresolved choice:
- [Composition studies](references/ui-visual-hierarchy.md): initial/substantially revised screen composition and concrete reference analysis; diagrams are not game templates.
- [Color language](references/color-language-system.md): material/world/UI relationships and transient versus persistent emphasis.
- [Shape language](references/shape-language-framework.md): silhouettes, proportions, detail, view angle and facing.
- [Lighting](references/lighting-mood-framework.md): spatial/material depth and illumination versus state indication.
- [Canal-crossing exercise](../game-level-designer-expert/references/encounter-design-patterns.md#worked-scene-reasoning-a-canal-crossing): action, camera and environmental identity tradeoffs, not a theme/layout default.
