---
name: game-content-pipeline-engineer
description: "Choose asset sources and representations, produce or import required game/UI parts, or diagnose asset-format and assembly problems from an established art/audio direction. 中文：资源选型、制作导入、图集与场景装配；不重新选择风格。"
---

# Game Content Pipeline Engineer

Make authored content render and behave consistently in the selected game technology. This Skill concerns content production and consumption; it does not require BeeGameStudio to provide a game engine or prescribe which engine the Agent uses.

## Resource planning

Use resource planning when a concrete resource uncertainty affects a design choice or authorized production. Determine the independently controlled parts needed by the required action and appearance; record consequential product constraints with their design. During production choose sources using [resource selection](references/resource-selection.md). For generated 2D artwork, choose the atlas or independent-image deliverables using [artwork production](references/artwork-production.md) before per-object file lists and requests; runtime objects can use separate regions of one image. Choose frame counts and dimensions from the current playable situation and confirmed art/audio direction.

Representations must support the required actions and independent changes: a translated still image does not replace changing character poses, and baked-in parts cannot move independently. For 2D, identify needed action/state sequences and reusable layers; for 3D, identify compatible models, rigs/animations and modular joins. Keep live text/state separate from static artwork. Resolve a concrete feasibility uncertainty before dependent production; reference existing rule, layout or interface definitions rather than duplicating them.

## Acquisition and integration

For a new resource source or a change of source, read [resource selection](references/resource-selection.md) before choosing its production method; reuse guidance retained in context. For character, environment, prop or decorative UI production, use [artwork production](references/artwork-production.md) to retain the confirmed appearance requirements and owning GDD definitions. An unavailable library match does not change that target.

Acquire, inspect and register resources for a coherent player situation, then connect them to consumers during implementation; observe the required feedback through the current task's runtime verification. Saved resource-only assignments stop at their boundary. Register actual files/frames and provenance through the existing resource contract; dimensions and anchors belong to resource metadata or consuming code. A candidate list or a final label is not delivered/verified content. Keep source choice distinct from runtime consumption: Canvas may play sprites without procedurally replacing their artwork.

For new 3D model generation or preparation of its downloaded output, read [3D asset production](../bgs-3d-asset/SKILL.md); existing usable meshes need no generation or bake-down. For 2D character animation from any source, read [sprite animation](../game-technical-artist/references/ai-sprite-animation.md); use its AI-generation method only if selected. For 3D rig/clip delivery or locomotion-transition problems, read [skeletal animation handoff](../game-technical-artist/references/skeletal-animation-handoff.md). Reconcile consequential resource/design conflicts in their owning sections.

Sourcing or generation failure leaves the affected artwork requirement unmet. Retain that dependency and continue independent authorized work; do not substitute newly drawn generic shapes for selected artwork.

For a concrete resource-format or renderer feasibility question, or for acquiring, registering, importing and verifying actual files, read the relevant section of [production and integration](references/production-integration.md). It contains the supplied command usage, atlas/3D import details and saved-resource checks.
