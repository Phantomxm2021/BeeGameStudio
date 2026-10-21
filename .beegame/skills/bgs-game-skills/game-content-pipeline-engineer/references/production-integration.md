# Resource production and runtime integration

Use the relevant parts for a resource-format or renderer feasibility question, or when acquiring, registering, importing or debugging actual content.

- Identify the current project's source of truth before changing data: the chosen engine/framework's scenes, UI sources, resource references and any manifest/content index actually used. Follow the actual schema; do not invent component types or an alternate copy of a scene layout.
- In BGS, `content/index.json` indexes Scene/UI documents; `assets/asset-manifest.json` indexes image/audio/font/atlas resources (with modules under `assets/manifest/`). Register resources through the supplied `resources.mjs` entry; read `--contract registration` when registering files. Reference registered resource IDs from Scene/UI data; do not add assets to the document index.
- Keep resource identity separate from placement. Preserve stable IDs, local-to-parent transforms, coordinate units, pivots, sorting/layers, atlas frame rectangles, animation timing, and asset references through import and runtime loading.
- In BGS, retain screen UI's element tree/layout/style/actions/bindings and Scene's objects/components as distinct models. Declare Scene Text data.font.assetRef in document.assetRefs, preserving data.font.member. The optional shared 2D painter handles world-space Canvas Image/Text with existing RectTransform geometry and layer/zIndex order; screen-space Canvas modes and component sorting overrides remain unsupported. Use consumer --api for the current capability boundary rather than deleting valid source fields to fit the helper.
- For repeated grid environments, consider a tile palette/TileSet plus cells and layers. A tilemap is painted cells referencing tile assets, not one blank bitmap filled pixel by pixel. Use independent sprite objects for free-form actors, props, and effects; their images may share an atlas. Independent objects do not require separate generation requests.
- For atlases/spritesheets, inspect frame bounds, padding/bleed, orientation, pivot, animation sequence, and the selected frame reference. Do not render the whole atlas where a frame is required. For 3D/XR, inspect mesh/material/texture references, scale and axes, animation rigs, collision, lighting, and platform-specific import constraints as applicable.
- Author runtime loading against the existing content contract. The editor and player may have different rendering code, but they must agree on the same data semantics. Load startup content needed for first interaction; defer optional scenes and assets when that improves observed load time.
- Diagnose failures at the right boundary: missing source asset, invalid manifest, invalid document, import/transform mismatch, unsupported renderer, or runtime code. Do not rewrite valid content merely to hide an editor or preview defect.

## Production from selected designs

After actual compositions are selected, revise the affected production choices in that same plan to match them. Distinguish artwork/skins, live text/values and runtime-driven objects. Procedural controls must retain the selected appearance, not replace distinctive artwork with generic shapes. For AI derivatives use the existing referenceImagePath input; distinctive UI skins can use uiAssets on the supplied assets entry (see its --help). Group compatible small artwork into sheets before generation; split for an actual resolution or composition need. Inspect and register delivered files, then author Scene/UI data and bindings from the same designs and assets. Image requests are not layouts; do not create early UI/Scene JSON. Repair existing content in place.

## Saved resources and runtime observations

For BGS saved sources, use CheckResourcesAndBindings `{}` to check all registered resources and saved UI/Scene references against actual files, hashes, members and atlas frames. `{"detailsFor":"content/ui/actual-file.json"}` expands node/component operands without narrowing checks. Missing inputs remain unverified. Correct authorized sources with existing Edit; this tool does not register, produce or bind resources, or prove runtime action/state wiring.

Check a representative authored object in the editor and in the playable runtime when available. For engine-specific fields or import behavior, consult the documentation for the project's actual engine/version; use Unity, Unreal, or Godot concepts as references, not mandatory output formats.

