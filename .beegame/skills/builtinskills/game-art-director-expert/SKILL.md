---
name: game-art-director-expert
description: "Establish or repair game art direction: composition, visual style, color, lighting, materials, and VFX. Use for visual quality, not technical import or UI behavior alone. 中文：游戏美术、视觉风格、色彩、光照、特效。"
---

# Game Art Director

Translate the player's fantasy and gameplay information into a coherent, readable visual language. Choose the amount of art direction the request needs; a focused sprite or lighting fix does not require a new art bible.

- Identify the intended mood, focal point, camera/viewing distance, and player-readable categories such as safe space, threat, interactable, and background.
- Connect the art direction to representative screen and scene compositions: how foreground, play space and background create depth, where attention goes first, and which areas are intentionally quiet. A palette and asset list alone do not specify a finished player-facing view.
- For ART_DIRECTION.md, relate the visual language to the planned screens and scenes: focal points, foreground/play-space/background separation, readability, asset families, and which parts need independent layers. A visual reference can help when available, but it is not a prerequisite to documenting the direction; do not treat a flattened screen image as runtime UI.
- Use shape, value, color, motion, and sound-adjacent feedback deliberately. Shared conventions create cohesion; contrasting silhouettes can make opposing roles easier to read. Color alone should not carry critical information.
- Establish palette, materials, lighting, texture density, animation and VFX treatment only where they affect the current work. Keep UI visually related to the world while leaving control clarity and layout to the UI/UX design.
- Own the visual identity of game screens as well as world assets: focal imagery or motif, title treatment, material/shape character, and transition mood. UI/UX turns that direction into spatial and interaction decisions; neither document should leave the complete picture to the implementer. Pick a style for the intended experience, not just framework convenience. Flat shapes, system fonts and sparse layouts are valid choices, but are not a complete art direction by themselves.
- For modular asset families, preserve authored scale, pivots, coordinate basis, material treatment, and consistent transforms. Do not normalize every component to an identical origin or size if that breaks assembly.
- If assets come from different sources, check provenance, intended use, style compatibility, and whether each asset earns its download and runtime cost.
- Judge the result at the player's actual view and target quality settings. A valid manifest, build, or static source preview does not prove that framing, silhouette, lighting, animation, or VFX read well in play.

For a visual change, capture or inspect the current runtime when available, make the smallest relevant improvement, and compare the same player-facing moment afterward. If runtime observation is unavailable, state that visual acceptance remains unverified rather than claiming success from source files.

Read only the relevant optional reference:
- `references/color-language-system.md` for semantic color and hierarchy.
- `references/shape-language-framework.md` for silhouettes and asset families.
- `references/lighting-mood-framework.md` for visibility and atmosphere.
- `references/ui-visual-hierarchy.md` for coordination with game UI visuals.
