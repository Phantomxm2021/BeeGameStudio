---
name: game-content-pipeline-engineer
description: Load or debug tilemaps, atlas frames, meshes, animation and VFX references through Scene/UI data into the game runtime for 2D, 3D or XR. 中文：瓦片地图、图集加载、资源导入、场景解析、运行时渲染。
---

# Game Content Pipeline Engineer

Make authored content render and behave consistently in the selected game technology. This Skill concerns content production and consumption; it does not require BeeGameStudio to provide a game engine or prescribe which engine the Agent uses.

- Identify the current project's source of truth before changing data: the chosen engine/framework's scenes, UI sources, resource references and any manifest/content index actually used. Follow the actual schema; do not invent component types or an alternate copy of a scene layout.
- Keep resource identity separate from placement. Preserve stable IDs, local-to-parent transforms, coordinate units, pivots, sorting/layers, atlas frame rectangles, animation timing, and asset references through import and runtime loading.
- For repeated grid environments, consider a tile palette/TileSet plus cells and layers. A tilemap is painted cells referencing tile assets, not one blank bitmap filled pixel by pixel. Use independent sprites for free-form actors, props, and effects; do not force all 2D content into a tilemap.
- For atlases/spritesheets, inspect frame bounds, padding/bleed, orientation, pivot, animation sequence, and the selected frame reference. Do not render the whole atlas where a frame is required. For 3D/XR, inspect mesh/material/texture references, scale and axes, animation rigs, collision, lighting, and platform-specific import constraints as applicable.
- Author runtime loading against the existing content contract. The editor and player may have different rendering code, but they must agree on the same data semantics. Load startup content needed for first interaction; defer optional scenes and assets when that improves observed load time.
- Diagnose failures at the right boundary: missing source asset, invalid manifest, invalid document, import/transform mismatch, unsupported renderer, or runtime code. Do not rewrite valid content merely to hide an editor or preview defect.

When specifying content integration, describe the chosen target/runtime, authored Scene/UI and asset loading, input integration, platform/performance constraints and consequential feasibility risks. Reference existing space allocation and world/framing requirements for layout consumption and coordinate conversion. A prototype or calculation input is needed only for a specific unresolved question, not document completion. Do not maintain another screen-rectangle, viewport-allocation or camera-offset table.

When planning resources, trace each required asset family (including fonts and procedural visual/audio content) to its scene, UI or audio use. Record expected format, scale or frame needs, source/license or production route, and a fallback for expensive or uncertain custom work. Do not turn an asset list into a mandate to use one sourcing method.

Check a representative authored object in the editor and in the playable runtime when available. For engine-specific fields or import behavior, consult the documentation for the project's actual engine/version; use Unity, Unreal, or Godot concepts as references, not mandatory output formats.
