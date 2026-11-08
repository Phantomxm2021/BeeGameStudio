---
name: game-content-pipeline-engineer
description: "Source, generate and prepare game/UI asset files. Use for library/Web acquisition, image-family production, extraction, atlas packing, provenance, registration or import compatibility. Appearance and required behavior come from the project. 中文：资源选源、生成、切分打包、登记与导入兼容。"
---

# Game Content Pipeline Engineer

Prepare the resource files and metadata needed by the selected runtime, preserving the project's appearance and behavior definitions. Source choice, image-family production, processing, provenance and import compatibility belong here; the resource Manifest is not a scene graph. Runtime animation, VFX and material behavior use the relevant technical-art or engine method. This Skill does not prescribe an engine.

## Resource planning

Use resource planning when a concrete resource uncertainty affects a design choice or authorized production. Determine the independently controlled parts needed by the required appearance and behavior; record consequential product constraints with their design. During production choose sources using [resource selection](references/resource-selection.md). For 2D artwork, choose the atlas or independent-image deliverables using [artwork production](references/artwork-production.md) before per-object file lists and requests; runtime objects can use separate regions of one image. For any required sheet or sequence, use the shared [spritesheet/atlas method](../game-technical-artist/references/spritesheet-production.md), retaining the current project's entries and visible changes.

Representations must support the required independent changes: transforms do not create missing drawn shape changes, and baked-in parts cannot move independently. For 2D, distinguish independent elements, discrete state variants and temporal sequences for the actual consumers; for 3D, identify compatible models, rigs/animations and modular joins. Keep live text/state separate from static artwork. Resolve a concrete feasibility uncertainty before dependent production; reference existing rule, layout or interface definitions rather than duplicating them.

## Acquisition and integration

For a new resource source or a change of source, read [resource selection](references/resource-selection.md) before choosing its production method; reuse guidance retained in context. For character, environment, prop or decorative UI production, use [artwork production](references/artwork-production.md) to retain the confirmed appearance requirements and owning GDD definitions. An unavailable library match does not change that target.

Acquire, inspect and register actual resource files, preserving paths, frames, dimensions, anchors and provenance. During implementation, connect their native resource references without treating registration as evidence of correct animation or gameplay. Source choice remains distinct from consumption: Canvas can play authored sprites without redrawing them. Resource-only assignments stop at their authorized boundary.

For new 3D model generation or preparation of its downloaded output, read [3D asset production](../bgs-3d-asset/SKILL.md); existing usable meshes need no generation or bake-down. For character-specific identity or pose production, read [character animation](../game-technical-artist/references/ai-sprite-animation.md); its AI-production details apply only when generation is selected. For 3D rig/clip delivery or locomotion-transition problems, read [skeletal animation handoff](../game-technical-artist/references/skeletal-animation-handoff.md). Reconcile consequential resource/design conflicts in their owning sections.

Sourcing or generation failure leaves the affected artwork requirement unmet. Retain that dependency and continue independent authorized work; do not substitute newly drawn generic shapes for selected artwork.

Read [production and integration](references/production-integration.md) for an import/format or registration question, [assembly examples](references/runtime-assembly-examples.md) for detached contact, occlusion or stretched skins, or [mesh/material production](references/mesh-material-production.md) for actual mesh/texture repairs. For supplied historical BGS Scene/UI sources or legacy handoffs, use [legacy integration checks](references/saved-content-checks.md); new tasks use their selected runtime's native sources.