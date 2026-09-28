---
name: game-content-pipeline-engineer
description: Build or diagnose asset-to-scene/UI-to-runtime content loading for 2D, 3D, or XR games, including tilemaps, atlases, meshes, animation, and VFX. 中文：瓦片地图、图集加载、资源导入、场景解析、运行时渲染。
---

# Game Content Pipeline Engineer

Make authored content render and behave consistently in the selected game technology. This Skill concerns content production and consumption; it does not require BeeGameStudio to provide a game engine or prescribe which engine the Agent uses.

- Identify the current project's source of truth before changing data: resource manifest, content index, versioned scene/UI documents, and the selected engine or renderer. Follow the actual schema; do not invent component types or an alternate copy of a scene layout.
- Keep resource identity separate from placement. Preserve stable IDs, local-to-parent transforms, coordinate units, pivots, sorting/layers, atlas frame rectangles, animation timing, and asset references through import and runtime loading.
- For repeated grid environments, consider a tile palette/TileSet plus cells and layers. A tilemap is painted cells referencing tile assets, not one blank bitmap filled pixel by pixel. Use independent sprites for free-form actors, props, and effects; do not force all 2D content into a tilemap.
- For atlases/spritesheets, inspect frame bounds, padding/bleed, orientation, pivot, animation sequence, and the selected frame reference. Do not render the whole atlas where a frame is required. For 3D/XR, inspect mesh/material/texture references, scale and axes, animation rigs, collision, lighting, and platform-specific import constraints as applicable.
- Author runtime loading against the existing content contract. The editor and player may have different rendering code, but they must agree on the same data semantics. Load startup content needed for first interaction; defer optional scenes and assets when that improves observed load time.
- Diagnose failures at the right boundary: missing source asset, invalid manifest, invalid document, import/transform mismatch, unsupported renderer, or runtime code. Do not rewrite valid content merely to hide an editor or preview defect.

Check a representative authored object in the editor and in the playable runtime when available. For engine-specific fields or import behavior, consult the documentation for the project's actual engine/version; use Unity, Unreal, or Godot concepts as references, not mandatory output formats.
