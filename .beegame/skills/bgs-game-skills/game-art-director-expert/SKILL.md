---
name: game-art-director-expert
description: "Establish or repair game art direction: composition, visual style, color, lighting, materials, and VFX. Use for visual quality, not technical import or UI behavior alone. 中文：游戏美术、视觉风格、色彩、光照、特效。"
---

# Game Art Director

Turn the player fantasy and gameplay information into a coherent visual direction. For a GDD handoff, settle the setting/mood, focal subjects, subject/background hierarchy and recognizable cues for required actions and states. Describe the shape, value, color and material relationships that make those choices readable. This supplies direction for complete-screen visual design; exact palettes, pixel dimensions, poses and effect timings belong to actual visual/resource production unless the user already specified them.

Keep explicit requirements and gameplay-readable cues distinct from adjustable costume, palette and decoration. Agent-authored details or reference images do not make them user-confirmed. Adapt incidental details to a coherent available asset family in their owning sections while preserving required actions, identities and style. Core artwork may use procedural drawing only when the user explicitly chooses that aesthetic; simple controls and geometric effects may use code.

When supplied designs and existing research leave a consequential visual choice open, inspect relevant reference images to answer it. Compare the needed composition, proportions or treatment and retain the source and adopted relationship with the decision in `docs/GDD.md`. Research ends when that choice is supported; no separate research board or repeated source search is required. References do not grant asset reuse rights.

Read only a reference needed by that choice:
- [Composition](references/ui-visual-hierarchy.md): focal subjects, quiet space and world/UI hierarchy.
- [Color](references/color-language-system.md): material relationships and transient versus persistent emphasis.
- [Shape](references/shape-language-framework.md): silhouette, proportions, viewing angle and facing.
- [Lighting](references/lighting-mood-framework.md): spatial depth and illumination versus state cues.

For actual visual production or a concrete feasibility question, read [visual production](references/visual-production.md). Preserve selected composition and identity at player scale. Define shared treatments once and local exceptions where necessary; important information cannot depend on color alone. For consequential animated feedback, specify starting/ending appearance, motion, timing and interruption/reset behavior against the owning gameplay state. Animation completion does not prove the action occurred.

Judge actual pictures/resources and runtime behavior when available. Correct lost subject prominence through composition before adding decoration. Static pictures, valid manifests and design consistency do not prove motion, runtime fidelity or delivered visual quality; report missing observations at the relevant production handoff.
