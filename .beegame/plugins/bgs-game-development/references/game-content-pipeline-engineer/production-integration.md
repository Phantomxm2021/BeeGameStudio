# Resource production and runtime integration

Use [artwork production](artwork-production.md) before choosing scene parts, shared atlases or other artwork representations. Use the integration sections for resource-format or renderer feasibility, acquisition, source tracking, import or debugging.

- Identify the current project's source of truth before changing data: the chosen engine/framework's scenes, UI sources, resource references and any manifest/content index actually used. Follow the actual schema; do not invent component types or an alternate copy of a scene layout.
- Retain actual acquisition records and complete dependency files; dimensions and anchors belong to native resource metadata or consuming code. Preserve the complete dependency closure of imported library assets and reuse the download/processing tools’ actual output records rather than reconstructing dependency metadata. Use the selected runtime’s resource bindings; native asset metadata is distinct from a scene graph.
- Preserve resource IDs, units, transforms, pivots, layers, atlas frames and timing through import. Derive placement from the visible form in the consumer's coordinate space. A hanging lantern attaches by its hook, which may sit inside a padded image: align that transformed local point to the support, not the canvas top. Import the part relationships established by [artwork production](artwork-production.md), keeping actual anchors and layer ownership in existing resource/scene sources.
- For a concrete detached-contact, occlusion or stretched-skin problem, use the [runtime assembly examples](runtime-assembly-examples.md) for source anchors, ordered layers and stretch regions; adapt the example to the actual engine and assets.
- For repeated grid environments, consider a tile palette/TileSet plus cells and layers. A tilemap is painted cells referencing tile assets, not one blank bitmap filled pixel by pixel. Use independent sprite objects for free-form actors, props, and effects; their images may share an atlas.
- For sheets/atlases of any material, use [spritesheet/atlas production](spritesheet-production.md) for measured frame regions and origins; [runtime playback](../game-art-director-expert/motion-implementation.md#sheet-and-sequence-playback) handles sequence clocks and endings. Display independent elements by their named regions, select variants from their owning state, and play temporal sequences in their intended order and timing. For actual 3D mesh/material production or import repairs, use [mesh and material production](mesh-material-production.md) for UVs, baking, texture channels and target-renderer checks; use art's [skeletal animation handoff](../game-art-director-expert/skeletal-animation-handoff.md) when rigs/clips are involved. Preserve scale/axis conventions, collision, lighting and platform-specific import constraints.
- Author runtime loading against the existing content contract. Load startup content needed for first interaction; defer optional scenes and assets when that improves observed load time.
- Diagnose failures at the right boundary: missing source asset, invalid manifest, invalid document, import/transform mismatch, unsupported renderer, or runtime code. Do not rewrite valid content merely to hide an editor or preview defect.

For artwork source choice, generation deliverables and transparent-output inspection, use [artwork production](artwork-production.md).

## Web / Vite resource URLs

Use the project's actual Vite base for both a root-hosted game and a path-mounted preview. Vite rewrites recognized asset imports and CSS `url(...)` references for the configured base. For dynamic public-file references, use Vite's native `import.meta.env.BASE_URL`:

```js
const resourceBase = import.meta.env.BASE_URL
const imageUrl = `${resourceBase}art/prop.png`
const atlasStyle = { backgroundImage: `url("${imageUrl}")` }
const cue = new Audio(`${resourceBase}audio/cue.wav`)
```

For example, JSX can use `<img src={imageUrl} />`; a stylesheet can use `url('/fonts/game.woff2')` for a file in Vite's public directory. Keep the public paths relative to that configured directory. Arbitrary JavaScript strings such as `new Audio('/audio/cue.wav')` target the origin root, escaping a mounted preview. The preview host does not repair those strings. Changing `vite preview --base` also cannot rewrite arbitrary strings in a previously built bundle; build against the intended base. See [Vite public base path](https://vite.dev/guide/build.html#public-base-path).

On the BGS macOS project sandbox, native filesystem events are unavailable. The existing managed development preview uses Vite's polling watch option. If starting Vite directly, its native `server.watch.usePolling` option is the working configuration; the environment switch alone does not disable FSEvents in the bundled Chokidar versions tested here.

## Matching a source family

Use these criteria for a concrete candidate comparison; the source order remains in [resource selection](resource-selection.md).

| Family | What to inspect in a relevant sample | Why existence alone is insufficient |
|---|---|---|
| Modular environment | Scale, edge treatment, pivots, tile joins, lighting/material and required variants in the scene | Attractive isolated tiles can fail to assemble coherently or omit a needed corner/transition |
| UI/font family | Render actual title, counter and label strings at display size; compare glyph shapes/weight, proportions, control states and stretch regions | Coverage alone does not establish matching letterforms. If subsetting is needed, derive coverage from player-visible copy, dynamic alphabets and confirmed languages, not the technical GDD prose |
| Repeated feedback sound | Event meaning, attack/tail, variation, mix space and loading/playback constraints | A valid file can be wrong in tone, mask another cue or fail in its actual playback path |


Examples of concrete reference material: [Unciv's UI skins](https://github.com/yairm210/Unciv/blob/master/docs/Modders/Creating-a-UI-skin.md) show reusable shapes and nine-patch behavior; [Veloren's models](https://book.veloren.net/contributors/artists/voxel-models.html) place assets in a shared style/scale context; [OpenRA's mod guide](https://github.com/OpenRA/OpenRA/wiki/Modding-Guide) separates authored rules/maps/UI and resources. These illustrate matching and integration, not mandatory file formats or a reason to copy their look.


## Language-dependent resources

Reuse the project's existing localization/resource bindings for the supported languages. Keep ordinary labels, counters and instructions live; where lettering itself is authored artwork, retain that expression in language-specific variants rather than replace it with generic text or require every locale to share one bitmap. Check actual translated strings and dynamic character coverage when choosing or subsetting fonts. A declared font family or language tag does not prove that its glyphs, shaping or target-renderer support are available.

Bind only resources whose language actually changes: text-bearing art, subtitles and speech where that language coverage is required. Music and nonverbal effects can remain shared. Multiple interface languages do not authorize new translated voice production. Keep variants and dependencies under the actual engine's existing resource identifiers and loading path; a language selection changes the selected resource, not gameplay identity or a second asset registry. Use the same preview/publication base for dynamically selected Web URLs, and retain the currently usable presentation if a required variant fails to load.

## UI artwork at runtime size

Evaluate the delivered atlas skins/icons at their actual display boxes. Compare their visible silhouettes, line weight, padding and prominence with the intended screen composition at the same scale; identical canvas dimensions do not establish equal visual size. Keep editable masters and intentional crop/atlas margins. A responsive text wrap that preserves hierarchy is an adaptation; distorting fixed corners, border strokes or an emblem is an assembly defect to correct in the owning skin/layout, not a reason to rewrite the design.

For a resizable panel, identify fixed corners/borders and the stretchable or tileable center in source pixels. Use the selected engine's nine-slice or equivalent only where the artwork supports it. Keep emblems and irregular ornament outside stretched regions; use separate decorative parts or a suitable fixed-size variant when stretching would distort the design. Compare the smallest and largest intended panel sizes, including border thickness, corner shape and seams. Do not assume a border width from the whole image's dimensions.

Keep actual sizes, regions and bindings in the project's existing resource/layout sources. [NinePatchRect](https://docs.godotengine.org/en/stable/classes/class_ninepatchrect.html) illustrates fixed corners and configurable center/edge behavior; use the equivalent facilities of the project's actual engine.

## Saved resources and runtime observations

Compare authorized resource needs with actual delivered files and native metadata. Native scene/UI bindings need observation in the selected engine/framework. Preserve known acquisition sources through the existing tools; structural inspection does not produce assets or establish runtime wiring.

Check a representative authored object in the playable runtime. For engine-specific fields or import behavior, consult the documentation for the project's actual engine/version; use its native scene/UI code and data.

