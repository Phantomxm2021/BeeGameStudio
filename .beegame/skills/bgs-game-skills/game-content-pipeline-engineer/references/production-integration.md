# Resource production and runtime integration

Use the relevant parts for a resource-format or renderer feasibility question, or when acquiring, registering, importing or debugging actual content.

- Identify the current project's source of truth before changing data: the chosen engine/framework's scenes, UI sources, resource references and any manifest/content index actually used. Follow the actual schema; do not invent component types or an alternate copy of a scene layout.
- `assets/asset-manifest.json` indexes delivered resources (with modules under `assets/manifest/`). Register resources through the supplied `resources.mjs` entry; read `--contract registration` when registering files. For a selected library element, `assets.mjs fetch` downloads its complete dependency closure and returns `root_path`, `file_paths` and registration-shaped `dependencies` records; pass those fields through to one `resources.mjs` registration without rebuilding dependency metadata. Use the selected runtime’s resource bindings; the resource Manifest is not a scene graph.
- Keep resource identity separate from placement. Preserve stable IDs, local-to-parent transforms, coordinate units, pivots, sorting/layers, atlas frame rectangles, animation timing, and asset references through import and runtime loading.
- For repeated grid environments, consider a tile palette/TileSet plus cells and layers. A tilemap is painted cells referencing tile assets, not one blank bitmap filled pixel by pixel. Use independent sprite objects for free-form actors, props, and effects; their images may share an atlas. Independent objects do not require separate generation requests.
- For atlases/spritesheets, inspect frame bounds, padding/bleed, orientation, pivot, animation sequence, and the selected frame reference. For character/monster actions from any source, use the shared preparation and playback checks in [sprite animation](../../game-technical-artist/references/ai-sprite-animation.md); atlas rectangles alone are not playable actions. Do not render the whole atlas where a frame is required. For 3D/XR, inspect mesh/material/texture references, scale and axes, animation rigs, collision, lighting, and platform-specific import constraints as applicable.
- Author runtime loading against the existing content contract. Load startup content needed for first interaction; defer optional scenes and assets when that improves observed load time.
- Diagnose failures at the right boundary: missing source asset, invalid manifest, invalid document, import/transform mismatch, unsupported renderer, or runtime code. Do not rewrite valid content merely to hide an editor or preview defect.

## Production from selected designs

After actual compositions are selected, revise the affected production choices in that same plan to match them. Distinguish artwork/skins, live text/values and runtime-driven objects. Procedural controls must retain the selected appearance, not replace distinctive artwork with generic shapes. For AI derivatives use the existing referenceImagePath input; distinctive UI skins can use uiAssets on the supplied assets entry (see its --help). Group compatible small artwork into sheets before generation; split for an actual resolution or composition need. Inspect and register delivered files before binding them in scene/UI data authored in the chosen engine’s format from the same designs. Image requests are not layouts. Repair existing content in place.

## Saved resources and runtime observations

For BGS saved sources, use CheckResourcesAndBindings `{}` to check all registered resources and saved UI/Scene references against actual files, hashes, members and atlas frames. `{"detailsFor":"content/ui/actual-file.json"}` expands node/component operands without narrowing checks. Missing inputs remain unverified. Correct authorized sources with existing Edit; this tool does not register, produce or bind resources, or prove runtime action/state wiring.

Check a representative authored object in the playable runtime. For engine-specific fields or import behavior, consult the documentation for the project's actual engine/version; use its native scene/UI code and data.

