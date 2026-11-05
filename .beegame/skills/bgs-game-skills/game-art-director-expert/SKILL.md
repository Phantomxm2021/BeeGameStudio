---
name: game-art-director-expert
description: "Choose visual direction, composition or shape/material treatment, and diagnose loss of a selected appearance. Resource sourcing and effect coding use their own methods. 中文：视觉方向、构图与已选美术表现修订。"
---

# Game Art Director

For an open visual-direction or composition question, compare treatments by what players need to recognize, do and feel in the affected situation. Record the concrete appearance relationships that resolve that question, distinguishing requirements, selected designs and open choices. Develop its concrete appearance through the relevant picture, resource or target-engine work; a separate concept atlas is not required for every game. Gameplay camera and visibility constraints apply to gameplay and overlays retaining its view; title and standalone result screens follow their own compositions.

For document-only work, read a reference when it helps resolve that visual question. For screen-concept production or review, read [visual production](references/visual-production.md). A local correction need not restart design exploration.

Refine presentation within the GDD design and user requirements. When visual evidence reveals a composition weakness, revise only the affected presentation decision and explain the change; a generated picture does not redefine functionality or authorize extra controls, mechanics or screens. When resolving a shared appearance choice, keep the affected subjects and UI consistent with that choice. After selection, runtime production realizes its subjects and UI artwork through reuse, extraction or reference-based derivatives as described in the content pipeline’s [production method](../game-content-pipeline-engineer/references/artwork-production.md); matching the theme alone is not sufficient. A failed production method does not authorize replacing required artwork with placeholders or changing the agreed aesthetic.

When translating a broad style label into its first concrete treatment, choosing between materially different treatments, or diagnosing loss of a treatment, use the relevant [finished-game pictures and visual contrasts](references/ui-visual-hierarchy.md#finished-game-references). Inspect actual pictures for the relationship in question; reuse the selected project design once established instead of starting another style search. For document-design work, retain the adopted relationship and source in the affected GDD decision; production work carries them in its existing handoff. References do not grant asset reuse rights.

Read only a reference needed by that choice:
- [Composition](references/ui-visual-hierarchy.md): focal subjects, quiet space and world/UI hierarchy.
- [Playable view](references/camera-framing.md): a consequential camera/framing choice or an observed visibility/motion problem; distinguish camera, world, UI and input causes.
- [Color](references/color-language-system.md): material relationships and transient versus persistent emphasis.
- [Shape](references/shape-language-framework.md): silhouette, proportions, viewing angle and facing.
- [Lighting](references/lighting-mood-framework.md): spatial depth and illumination versus state cues.

Define shared treatments once and local exceptions where necessary; important information cannot depend on color alone. When producing or implementing consequential animated feedback, specify starting/ending appearance, motion, timing and interruption/reset behavior against the owning gameplay state. Animation completion does not prove the action occurred.

Judge actual pictures/resources and runtime behavior when available. Correct lost subject prominence through composition before adding decoration. Static pictures, valid manifests and design consistency do not prove motion, runtime fidelity or delivered visual quality; report missing observations at the relevant production handoff.
