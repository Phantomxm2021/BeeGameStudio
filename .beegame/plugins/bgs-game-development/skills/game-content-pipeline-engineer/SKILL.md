---
name: game-content-pipeline-engineer
description: "Choose how required game artwork, audio or 3D models will be produced and prepared for the selected runtime. Use for initial sourcing and production, including acquired/generated artwork and fallback construction, then extraction, spritesheet/atlas packing and import preparation; playback stays with its runtime consumer."
---

# Game Content Pipeline Engineer

Derive usable resources and their production path from the required appearance, sound or behavior and the selected runtime's consumers. Use the current brief, established design or supplied material as the basis. Source choice, production, processing, provenance and import compatibility belong here; playback and control remain with their runtime consumers. File metadata is not a scene graph or proof of correct play.

## Choose deliverables before requests

Translate independent motion, lighting, occlusion and responsive placement into addressable parts, regions or masks, preserving contact/depth and the exposed area behind moving parts. Background placement does not make a part static. Static parts sharing the same treatment can remain one image; live text/state stay with their runtime consumer. Retain these relationships in existing resource/scene sources.

Derive required image elements, state variants and visible changes before writing prompts or per-object output paths. Group content by shared appearance, scale and element/state relationships. A content family does not prescribe a single generation request or runtime file: generation groups follow actual output capabilities, while runtime packing follows consumer format, sampling, texture-size and loading/release needs. Runtime objects can share named regions instead of requiring a file per object.

## Acquire and deliver usable files

Preserve explicit user source choices, suitable supplied/adopted assets and rights. For each remaining visual resource family, search the self-hosted resource library first, then suitable Web sources, then authorized AI generation for the required asset type; programmatic artwork is the final fallback after those sources cannot supply a usable, licensed match. Judge candidates against the selected appearance, required states and runtime compatibility, and stop once a suitable source is found. [Resource selection](../../references/resource-selection.md) covers candidate matching and acquisition evidence; audio follows its existing production choice there. For selected AI image production, the system imagegen Skill executes generation/editing of the planned deliverables.

Acquire and inspect the selected files, preserving required appearance and behavior. Reuse the acquisition tools’ saved file facts and known sources, and hand off only adopted runtime files. An unmet art requirement remains a dependency.

Use [production/integration](../../references/production-integration.md) for import/format/source tracking, or [assembly examples](../../references/runtime-assembly-examples.md) for detached contacts, occlusion or stretched skins. Runtime sequence clocks and endings use [sheet playback](../../references/motion-implementation.md#sheet-and-sequence-playback). Reconcile real design/resource conflicts with their owning definitions and keep resource-only work within its boundary.

## Detail for the current resource

- [Artwork production](../../references/artwork-production.md): image composition, visual matching and prepared parts at runtime size.
- [Spritesheets/atlases](../../references/spritesheet-production.md): static entries or temporal sequences, layout and measured preparation for any subject, including the optional standalone PNG helper. Specialist character/VFX details are linked there only when applicable.
- [3D production](../../references/3d-production.md): new model generation or downloaded-model preparation, with optional provider notes/static-prop scripts. Existing usable meshes need no generation/bake-down.
- [Mesh/material production](../../references/mesh-material-production.md): actual geometry, UV or texture work.
- [Skeletal handoff](../../references/skeletal-animation-handoff.md): compatible rigs/clips or locomotion-transition problems.
