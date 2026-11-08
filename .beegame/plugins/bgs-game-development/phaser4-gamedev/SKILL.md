---
name: phaser4-gamedev
description: Implement and debug Phaser 4 scenes, physics, input, textures, animation, UI and renderer behavior. Use when the selected runtime is Phaser 4 or a Phaser 3-to-4 migration is requested; not for general GDD writing or choosing an engine. 中文：Phaser 4 专业实现与排障，按当前技术问题读取资料。
---

# Phaser 4 Game Development

Apply Phaser-specific implementation knowledge to the agreed game. Identify the
installed version from the dependency and lockfile. For a new version choice,
use [runtime dependency selection](../references/runtime-dependencies.md); resolve uncertain signatures
against that package's `types/phaser.d.ts` and implementation. Use official docs
for the matching version when local types do not explain behavior. A Phaser 3
project does not become a migration task just because this Skill is available.

Keep the existing project's structure and actual gameplay and art decisions.
Engine examples describe API use; they do not select the visual style, asset
production method, screen layout or feature set.

## Read for the current problem

| Problem | Reference |
|---|---|
| Scene restart, pause, input routing, listener ownership | [Scenes and input](references/scenes-and-input.md) |
| React mount/destroy, state subscription or Canvas/DOM HUD alignment | [React host integration](references/react-host-integration.md) |
| Arcade/Matter choice, collision, pooled bodies, Tiled maps | [Physics and tilemaps](references/physics-and-tilemaps.md) |
| Atlas loading, frame alignment, character animation being overwritten | [Textures and animation](references/textures-and-animation.md) |
| Canvas/HUD sizing, DOM overlay alignment, hit areas | [UI and viewport](references/ui-and-viewport.md) |
| Filters, masks, shaders, v3 migration, rendering cost | [Renderer and version changes](references/renderer-and-version.md) |
| Audio unlock, scene music ownership, saved-state reconstruction | [Audio and persistence](references/audio-and-persistence.md) |
| Vite asset paths, loader failures, production-only runtime errors | [Loading and build diagnosis](references/loading-and-build.md) |

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
