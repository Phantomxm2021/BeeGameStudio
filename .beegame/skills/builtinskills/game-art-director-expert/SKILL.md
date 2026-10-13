---
name: game-art-director-expert
description: "Establish or repair game art direction: composition, visual style, color, lighting, materials, and VFX. Use for visual quality, not technical import or UI behavior alone. 中文：游戏美术、视觉风格、色彩、光照、特效。"
---

# Game Art Director

Translate the player's fantasy and gameplay information into a coherent, readable visual language. Choose the amount of art direction the request needs; a focused sprite or lighting fix does not require a new art bible.

- Identify the intended mood, focal point, camera/viewing distance, and player-readable categories such as safe space, threat, interactable, and background.
- Connect the art direction to representative screen and scene compositions: focal subject, relative prominence, foreground/play space/background depth, and intentionally quiet areas. Record those relationships in the existing design source so layout and resource production can preserve them. A palette and asset list alone do not specify a finished player-facing view.
- For an initial composition or substantial visual rework, read [screen composition studies](references/ui-visual-hierarchy.md). Use comparable references to explain a relevant choice, not just name a style or game. A supplied image may be inspiration, an agreed composition, or a runtime capture; establish its role before using it. A flattened image is not runtime UI or proof of delivered quality.
- Use shape, value, color, motion, and sound-adjacent feedback deliberately. Shared conventions create cohesion; contrasting silhouettes can make opposing roles easier to read. Color alone should not carry critical information.
- Establish palette, materials, lighting, texture density, animation and VFX treatment only where they affect the current work. Keep UI visually related to the world and consistent with its interaction and layout requirements.
- Develop the visual identity of planned game screens as well as world assets: focal imagery or motif, title treatment where present, material/shape character, and transition mood. Relate that direction to the layout and interaction requirements. Pick a style for the intended experience, not just framework convenience. Flat shapes, system fonts and sparse layouts are valid choices, but are not a complete art direction by themselves.
- For modular asset families, preserve authored scale, pivots, coordinate basis, material treatment, and consistent transforms. Do not normalize every component to an identical origin or size if that breaks assembly.
- If assets come from different sources, check provenance, intended use, style compatibility, and whether each asset earns its download and runtime cost.
- Judge the result at the player's actual view and target quality settings. A valid manifest, build, or static source preview does not prove that framing, silhouette, lighting, animation, or VFX read well in play.

For a visual change, capture or inspect the current runtime when available, make the smallest relevant improvement, and compare the same player-facing moment afterward. If runtime observation is unavailable, state that visual acceptance remains unverified rather than claiming success from source files.

For written direction, use the confirmed player journey and planned screens/actions to identify the visual treatments actually needed. Define shared treatments for control and subject families once, with observable differences between applicable default, hover, pressed, focused, disabled or selected states. Explain how coexisting cues remain distinguishable. Connect screen and state descriptions to those treatments, describing meaningful differences and explicit exceptions instead of copying the specification. This does not require adding a start screen, cover illustration, menu or decorative resource absent from the agreed scope, or specifying every control pixel by pixel.

For consequential visual feedback, identify the affected subject, its starting and ending appearance, and the motion, timing and sequence needed to communicate the event. Match the ending appearance to the delivered resulting state. Describe what interruption, repetition or reset does to the visual treatment when relevant; a duration alone does not define the feedback, and animation completion is not evidence that a gameplay action occurred.

When reviewing a direction, check that visual choices and interface requirements agree and are implementable. Distinguish that design check from inspecting the actual delivered look; state which resource or runtime observations remain unavailable.

Judge composition and finish at a useful player-facing scale: deliberate proportions and quiet space, coherent type/icon/line/material treatment, controlled emphasis and decoration, and recognizable game identity without sacrificing readability. Inspect the smallest useful complete screen/scene sample before propagating an uncertain treatment across an asset family. Use an available render or authorized image tool when appropriate; a diagram tests hierarchy, not final finish. If the selected focal subject disappears or loses prominence in layout, correct the affected design rather than decorating the wrong composition. State unavailable observations; neither user silence nor an aesthetic score establishes acceptance. This is a working method, not a new mandatory production stage or review loop.

Read only the relevant optional reference:
- `references/color-language-system.md` for semantic color and hierarchy.
- `references/shape-language-framework.md` for silhouettes and asset families.
- `references/lighting-mood-framework.md` for visibility and atmosphere.
- `references/ui-visual-hierarchy.md` for concrete reference analysis and composition examples; use its original diagrams as explanations, not game templates.
