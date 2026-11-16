---
name: phaser4-gamedev
description: "Default new Web 2D games, including React-hosted games, to Phaser 4 unless another runtime is specified; implement or debug Phaser 4 APIs for scenes, physics, input, textures, animation and UI in a selected Phaser 4 runtime or a requested migration. Phaser 3 uses its matching APIs and documentation, not these Phaser 4 examples. Playable layout, control response, interface transitions and visual expression use their task methods."
---

# Phaser 4 Game Development

The implementation references below target Phaser 4. For an existing project,
identify its installed version from the dependency and lockfile. Phaser 4 work
resolves uncertain signatures against that package's types and implementation,
using matching official documentation when these leave behavior unclear. Phaser 3 work uses its own types,
implementation and matching documentation; these Phaser 4 examples are not its
API reference. For a new version choice or compatibility mismatch, use
[runtime dependency selection](../../references/runtime-dependencies.md).
Choose the 4.x release for project compatibility. Retain an existing runtime unless a migration is requested.

Keep the existing project's structure and settled gameplay/art decisions.
For relationships being built or changed, read the corresponding method:
[Scene/spatial design](../game-scene-designer/SKILL.md) for playable arrangements,
[Art](../game-art-director-expert/SKILL.md) for visual expression,
[UI/UX](../game-ui-ux-designer/SKILL.md) for interface states and transitions,
[controls and feel](../game-feel-designer/SKILL.md) for input and action response,
or [resource production](../game-content-pipeline-engineer/SKILL.md) for source
choice and deliverables. Reuse existing implementation and methods already read
in context. First realization still constructs the runtime result even with a
complete GDD; API-only questions use the technical references below.

## Read for the current problem

| Problem | Reference |
|---|---|
| Scene restart, pause, input routing, listener ownership | [Scenes and input](../../references/scenes-and-input.md) |
| React mount/destroy, state subscription or Canvas/DOM HUD alignment | [React host integration](../../references/react-host-integration.md) |
| Arcade/Matter choice, collision, pooled bodies, Tiled maps | [Physics and tilemaps](../../references/physics-and-tilemaps.md) |
| Atlas loading, frame alignment, character animation being overwritten | [Textures and animation](../../references/textures-and-animation.md) |
| Canvas/HUD sizing, DOM overlay alignment, hit areas | [UI and viewport](../../references/ui-and-viewport.md) |
| Filters, masks, shaders, v3 migration, rendering cost | [Renderer and version changes](../../references/renderer-and-version.md) |
| Audio unlock, scene music ownership, saved-state reconstruction | [Audio and persistence](../../references/audio-and-persistence.md) |
| Vite asset paths, loader failures, production-only runtime errors | [Loading and build diagnosis](../../references/loading-and-build.md) |

Read only the reference relevant to the current work. Its examples are starting
points to adapt to the installed version and the existing code. Choose validation
that observes the changed behavior; this Skill supplies no prescribed harness,
report format, review stage or completion gate.

## Source

Adapted technical notes from [yakoub-ai/phaser4-gamedev](https://github.com/yakoub-ai/phaser4-gamedev),
revision `1c1bf45dec3f0acbe8b2a963cc6dab93be31253a` (retrieved 2026-11-03).
This is a focused adaptation, not the upstream plugin installation. Upstream GDD
templates, agents, hooks, commands, test harnesses and placeholder-art defaults
are outside this adaptation. Reference footers identify the source topics;
installed engine source remains authoritative for version-sensitive details.
