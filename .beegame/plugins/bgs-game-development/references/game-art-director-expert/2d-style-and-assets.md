# 2D styles and asset construction

Use for authored characters, environments, tiles, effects or UI artwork. Select the relevant question and example, not the whole collection. Describe appearance separately from file format, viewpoint and animation method: PNG can carry pixel art, painted surfaces or clean cartoon shapes; an SVG master can be exported to a raster sprite. A layered or skeletal asset is not itself a visual style.

## Describe what the image must preserve

| Appearance wording | Concrete choices | Production and consumption handles |
| --- | --- | --- |
| Pixel art（像素画） | Pixel-cluster size, deliberate stepped contours, color ramps, texture density and relative sprite scale. | Work from the actual native image resolution and intended display scale; choose consistent sampling/grid behavior. A nearest-filtered high-resolution picture is not automatically authored pixel art. |
| Clean cartoon / vector-like（卡通／矢量感） | Broad proportions, curve quality, chosen contour weight, flat or graded fills and restrained interior detail. | Preserve those shapes in acquired/produced images. SVG, PNG and atlas regions are possible representations; source-vector artwork does not imply a live vector renderer or a bone rig. |
| Painted / watercolor（手绘／水彩感） | Which marks follow wood, stone, cloth or foliage; hard versus washed edges; local values and depth layers. | Retain the painted surfaces, suitable alpha and independently composed parts. Choose how drawn illumination and runtime light combine. A colored gradient behind generic shapes loses the authored material. |
| Ink / sketch / print（墨线／涂鸦／版画） | Deliberate irregular contours, hatching or printed masses, paper/ink texture, and the hierarchy of marks. | Put the intended variation in the artwork; a sketch edge need not jitter randomly at runtime. See the existing [Pentiment typography and paper study](ui-visual-hierarchy.md#pentiment-typography-participates-in-the-art) for a different printed treatment, not a universal handwriting preset. |
| Illustrated volume（绘制的体积感） | Coherent projection, visible planes, edge highlights, painted shadows and contact with the ground. | 2D images can depict substantial volume. Preserve their view and contact reference when assembling them; an isometric label does not prove a 3D source model or authorize changing the camera. |

UI skins cross these appearances. Describe the actual silhouette, icon weight, corners/borders, text space and control states together with the world treatment. Their image format does not determine layout, behavior or transitions. Use [UI artwork at runtime size](../game-content-pipeline-engineer/production-integration.md#ui-artwork-at-runtime-size) for affected scaling and stretch regions.

## Public asset comparisons

These are publisher previews, not installed packages or proof of running behavior. Observe the relevant picture; technical contents below are publisher statements. A cover montage may include presentation effects or promote a larger collection, so do not infer exact included files, layers or animation from it.

### Pixel scene: Sunny Land

[Ansimuz's Sunny Land](https://assetstore.unity.com/packages/2d/characters/sunny-land-103349).

![Sunny Land cover: pixel-stepped fox and cottage, clustered grass and layered blue-green scenery](https://assetstorev1-prd-cdn.unity3d.com/key-image/9bd29dff-e516-414f-99a5-acbe5f13af85.png?v=1)

Grass edges, the roof and the fox use different but compatible pixel clusters; the large ground mass leaves detail to selected edges and patches. Study their displayed scale and texture hierarchy rather than copy a palette or impose a fixed sprite size. This still cannot establish animation cadence, camera stability or collision boundaries.

### Painted environment: Village 2D

[NotSlot's Village 2D Hand Painted Pack](https://assetstore.unity.com/packages/2d/environments/village-2d-hand-painted-pack-188560).

![Village 2D cover: timber, roof tiles and grass with painted marks against softer distant mountains](https://assetstorev1-prd-cdn.unity3d.com/key-image/9d29755b-73e7-4503-a53a-98e6ed10415c.jpg?v=1)

Wood strokes, stone shapes and roof edges carry different surface character; softer distant forms separate the settlement from its backdrop. The publisher lists PSD sources, composable houses and Sprite Shape profiles. Those describe this package's preparation options, not a requirement to use Unity Sprite Shape for another renderer. For a different painted relationship, reuse the existing [GRIS color/material study](color-language-system.md#source-studies-contrast-placement-and-painted-color).

### Clean outlined characters: Tiny Teddy zombies

[Jovial Games' 2D Cartoon Zombies Characters Pack](https://assetstore.unity.com/packages/2d/characters/2d-cartoon-zombies-characters-pack-381806).

![Tiny Teddy cover: simplified rounded characters with strong contours and bounded color areas](https://assetstorev1-prd-cdn.unity3d.com/key-image/2b2eca96-10b0-49ce-8f94-fa95dd6c2e64.png?v=1)

The heads, ears and costume shapes remain recognizable through bold outlines and simplified interiors. The publisher lists SVG/Inkscape sources and PNG textures with action animations. This does not establish skeletal data or that cover shadows are baked into each sprite. A different drawn contour/material relationship is visible in the existing [Cuphead study](ui-visual-hierarchy.md#cuphead-distinct-marks-for-actors-and-surroundings).

### Sketch scene: Scribble Platformer

[Kenney's Scribble Platformer](https://kenney.nl/assets/scribble-platformer).

![Scribble Platformer sample: irregular ink-like contours, mostly pale structures and small colored character accents](https://kenney.nl/media/pages/assets/scribble-platformer/d6a0e3a9ac-1674932930/sample.png)

The platforms, characters and small HUD symbols share a drawn contour treatment without making every region equally dark or detailed. Preserve the chosen line character and distribution of filled areas; simply placing neat primitives over paper texture would change that relationship. The publisher's tile dimensions belong to this source, not every sketch-styled game.

### Dimensional illustration: isometric buildings

[Neprosto Assets' 2D stylized hand-painted buildings](https://assetstore.unity.com/packages/2d/environments/2d-stylized-hand-painting-fantasy-isometric-environment-and-buil-265753).

![Publisher montage: illustrated stone, timber and roof planes with exaggerated building profiles and painted highlights](https://assetstorev1-prd-cdn.unity3d.com/key-image/a9bfd192-c329-4450-a219-02fef5c49f6e.jpg?v=1)

Curved profiles, stone edges and warm openings describe volume within images marketed as 2D artwork. Their projection and drawn lighting need to agree when placed together. The montage does not reveal source meshes, editable layers, footprints or separable occluders; obtain the actual companions needed by the selected consumer.

### Game UI artwork: Casual Game kit

[LAYERLAB's GUI Pro - Casual Game](https://assetstore.unity.com/packages/2d/gui/gui-pro-casual-game-176695).

![Casual Game UI cover: game item icons, illustrated frames, labels and controls across several screen compositions](https://assetstorev1-prd-cdn.unity3d.com/key-image/d008b64a-debd-40ca-9cd4-2f32e54c693f.png?v=1)

Icons, frames and controls form a graphic family through edge weight, highlights and color roles. The publisher lists PNG assets and 9-slice support, and explicitly excludes coding and animation. A skin or static state image therefore does not supply its interaction or transitions. The shop/inventory montage does not prescribe the current game's play-view layout, and the non-PSD edition does not establish editable source layers.

## Choose animation and rendering from the required result

Frame-by-frame images can depict changes in silhouette, view or drawing that a rigid transform cannot supply. Cutout animation moves separated parts; paper-like material is a separate appearance choice. Bones and weighted image meshes can bend those parts. These approaches can mix: Esoteric's [Spineboy example](https://esotericsoftware.com/spine-examples-spineboy) documents skeletal constraints, layered images, clipping and frame-switched flare images in one project. This is an explanation of available constructions, not a requirement to adopt Spine, rigs or extra frames.

For actual sheet identities, extents and preparation, use the [shared sheet method](../game-content-pipeline-engineer/spritesheet-production.md); timing and lifecycle belong to [runtime animation](motion-implementation.md). Do not infer sequence order or a state change from atlas proximity or filenames alone.

For pixel presentation, Unity's [Pixel Perfect guide](https://docs.unity3d.com/Packages/com.unity.2d.pixel-perfect@5.1/manual/index.html) explains reference resolution, texel density, filtering and render-time snapping. Its sprite snapping is distinct from simulation transforms. Adapt the selected renderer's sampling/display path to the intended pixel treatment; do not impose one source resolution or quantize gameplay merely to imitate the screenshot.

For an adopted surface that must respond to changing lights, [Unity's Light 2D reference](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/2DLightProperties.html) distinguishes normal-map response, masks and light blending. Use equivalent supported facilities only when needed. A painted highlight and a runtime highlight can conflict; adding normal maps to all 2D images is not a style definition or an automatic improvement.
