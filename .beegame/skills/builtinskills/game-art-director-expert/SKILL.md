---
name: game-art-director-expert
description: "Establish or repair game art direction: composition, visual style, color, lighting, materials, and VFX. Use for visual quality, not technical import or UI behavior alone. 中文：游戏美术、视觉风格、色彩、光照、特效。"
---

# Game Art Director

Translate the player's fantasy and gameplay information into a coherent, readable visual language. Choose the amount of art direction the request needs; a focused sprite or lighting fix does not require a new art bible.

- Identify the intended mood, focal point, camera/viewing distance, and player-readable categories such as safe space, threat, interactable, and background.
- Connect the art direction to representative screen and scene compositions: how foreground, play space and background create depth, where attention goes first, and which areas are intentionally quiet. Identify useful asset families and independent layers. A palette and asset list alone do not specify a finished player-facing view.
- A visual sample communicates direction, not final resource or runtime acceptance; do not treat a flattened image as runtime UI or require decorative illustration for deliberately minimal art.
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

For an assigned visual sample, choose a raster reference or a small editable static HTML/SVG composition according to the available tools and intended style; AI generation is optional. Show the game's core play and a materially different planned overlay/outcome where applicable, not invented screens or a new playable prototype. A self-contained HTML/SVG sample can use inline shapes/styles and embedded images without scripts or external dependencies; mark candidate fonts and unfinished assets honestly. Link the actual saved sample from its owning prose, state what it illustrates and keep any editable source alongside it. Inspect rendered pixels using the supplied sample/browser capability or native image reading, not source markup alone. If rendering is unavailable, report the limitation rather than declaring visual quality verified.

Judge composition and finish at a useful player-facing scale: deliberate proportions and quiet space, coherent type/icon/line/material treatment, controlled emphasis and decoration, and recognizable game identity without sacrificing readability. Identify a concrete visual weakness and its cause rather than assigning an aesthetic score. Refine the representative sample before propagating its treatment; do not generate every screen repeatedly or use user silence as professional approval. Keep later screen adaptations and implementation checks tied to the selected direction, not open-ended redesign.

Read only the relevant optional reference:
- `references/color-language-system.md` for semantic color and hierarchy.
- `references/shape-language-framework.md` for silhouettes and asset families.
- `references/lighting-mood-framework.md` for visibility and atmosphere.
- `references/ui-visual-hierarchy.md` for coordination with game UI visuals.
