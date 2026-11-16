---
name: game-content-pipeline-engineer
description: "Choose how required game artwork, audio or 3D models will be produced and prepared for the selected runtime. Use for initial sourcing and production, including acquired and generated artwork, then extraction, spritesheet/atlas packing and import preparation; playback stays with its runtime consumer."
---

# Game Content Pipeline Engineer

Derive usable resources and their production path from the required appearance, sound or behavior and the selected runtime's consumers. Use the current brief, established design or supplied material as the basis. Source choice, production, processing, provenance and import compatibility belong here; playback and control remain with their runtime consumers. File metadata is not a scene graph or proof of correct play.

## Choose deliverables before requests

Derive the artwork to request from the visible differences established by the GDD and selected visuals, where available. Choose the representation that preserves the intended appearance through the change at play size. A value can select painted states in a sheet or drive a mask over shared artwork. Reuse suitable artwork and request the poses, surfaces or intermediate shapes the chosen playback needs.

Keep parts or regions separately controllable if either can change while the other holds, including when their cues start together but end at different times. They can share a file while retaining that control. Bake together only what stays together through motion, lighting, occlusion and layout. Preserve contact, depth and the area revealed behind moving parts. Group production requests by shared appearance, scale and what the source can deliver. Pack the results according to the consumer's sampling, size and loading needs.

## Acquire and deliver usable files

Preserve explicit user source choices, suitable supplied/adopted assets and rights. For each independently usable artwork component or set that must match as a unit, search the self-hosted resource library first, then suitable Web sources, then authorized AI generation for the required asset type. Judge candidates against the selected appearance, required states and runtime compatibility, and stop once a suitable source is found. [Resource selection](../../references/resource-selection.md) covers candidate matching and acquisition evidence; audio follows its existing production choice there. For selected AI image production, the system imagegen Skill executes generation/editing of the planned deliverables.

Acquire and inspect the selected files, preserving required appearance and behavior. Reuse the acquisition tools’ saved file facts and known sources, and hand off only adopted runtime files. An unmet art requirement remains a dependency.

Use [production/integration](../../references/production-integration.md) for import/format/source tracking, or [assembly examples](../../references/runtime-assembly-examples.md) for detached contacts, occlusion or stretched skins. Runtime sequence clocks and endings use [sheet playback](../../references/motion-implementation.md#sheet-and-sequence-playback). Reconcile real design/resource conflicts with their owning definitions and keep resource-only work within its boundary.

## Detail for the current resource

- [Artwork production](../../references/artwork-production.md): image composition, visual matching and prepared parts at runtime size.
- [Spritesheets/atlases](../../references/spritesheet-production.md): static entries or temporal sequences, layout and measured preparation for any subject, including the optional standalone PNG helper. Specialist character/VFX details are linked there only when applicable.
- [3D production](../../references/3d-production.md): new model generation or downloaded-model preparation, with optional provider notes/static-prop scripts. Existing usable meshes need no generation/bake-down.
- [Mesh/material production](../../references/mesh-material-production.md): actual geometry, UV or texture work.
- [Skeletal handoff](../../references/skeletal-animation-handoff.md): compatible rigs/clips or locomotion-transition problems.
