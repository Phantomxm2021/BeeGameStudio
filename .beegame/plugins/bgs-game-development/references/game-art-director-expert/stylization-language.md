# Describing and realizing stylization

Read for an ambiguous style request, a mixed visual target, or translating an adopted look into production. Select the relevant example rather than inspect every product. These overlapping families are useful vocabulary, not an exhaustive style taxonomy, quality ranking or required set of directions. Unity Asset Store pages provide visual comparisons and publisher claims, not a choice of engine or authorization to acquire assets.

## Separate appearance from neighboring labels

“Stylized / 风格化” leaves open what is simplified, exaggerated or selectively rendered. “Low-poly” concerns geometry and sometimes visible faceting; “hand-painted” describes an authoring treatment; “cel” describes a light/shade response. They can coexist. PBR can support stylized proportions and textures. “Anime” and “cartoon” still leave character construction, shadow shapes and line treatment unresolved.

Fantasy, sci-fi and historical describe subject matter; cozy and ominous describe intended mood; isometric and top-down describe the view. They contribute to direction but cannot supply the missing surface, form or shading decisions. A fixed orthographic view can show voxel models, painted sprites or smoothly shaded meshes.

Describe the consequential combination in the existing design/art source: recognizable masses and proportions, edge treatment, surface marks and their scale, light/shadow grouping, material distinctions, color relationships, and the actual viewing distance. Include type/UI and motion where they carry that expression. Use a selected picture to make terms concrete; a source label does not settle those choices. No additional style specification or field schema is needed.

## Vocabulary with construction handles

| Useful wording | Make the visible choice concrete | Possible realization in the selected runtime |
| --- | --- | --- |
| Low-poly / faceted（低模／硬面） | Angular or rounded silhouette? Which planes stay visible? How large are facets relative to the subject? | Model the required profile; choose flat or smooth normals deliberately. Palette textures, vertex colors or ordinary textures can supply color. Few polygons alone do not create a faceted look. |
| Hand-painted（手绘贴图） | Broad painted value groups, grain, edge accents or fine strokes? Which surfaces receive them? | Author the intended marks in sprites/maps; choose how painted illumination and runtime light combine. Neither an unlit material nor a generic noise overlay guarantees a painted appearance. |
| Stylized PBR（风格化 PBR） | Exaggerated form with distinct cloth, enamel, metal or wood response; choose where wear/detail belongs. | Use appropriate base-color, normal and roughness/metalness information with suitable lighting. Map choice follows the material; every surface need not use every map. Different tints with identical response may lose the intended distinction. |
| Cel / toon（赛璐璐／卡通明暗） | Hard or soft shadow boundaries? Broad light groups or continuous shading? Outlines on which objects and at what displayed weight? | Shape the light response with bands/ramps and chosen shadow colors; add an appropriate contour method only when needed. Smooth and faceted normals produce different results. Toon does not require a dark outline. |
| Voxel / block（体素／方块） | Cubic construction, stair-stepped profiles and consistent cell scale, rather than arbitrary triangulated facets. | Use suitable authored meshes or voxel data. Visible blocks do not require a destructible voxel engine. Ordinary rendering can keep geometric steps while shading their surfaces smoothly or sharply. |
| Pixel / 3D pixel（像素画／3D 像素化） | Pixel-cluster scale, edge placement, color steps and pattern behavior during movement. | Use authored pixel sprites, or an appropriate low-resolution/object pixelization path with deliberate sampling and grid behavior. Pixelated 3D and voxel geometry are different decisions; a coarse fullscreen filter may shimmer or damage UI/text. |
| Painterly（绘画感） | Brush/mark direction, stroke scale, boundary softness and retained form; distinguish painted surfaces from a filtered final image. | Use authored painted imagery/materials or a suitable edge-preserving image treatment. Decide whether marks attach to surfaces or the screen. A filter cannot restore a missing silhouette, and motion can reveal swimming or lost detail. |

For authored images, use [2D styles and assets](2d-style-and-assets.md); 3D material or mesh operations are not prerequisites. For actual surface implementation use [material and shading](material-and-shading.md) and the chosen engine's facilities. Unity-specific components below explain their authors' methods, not portable API instructions or mandatory dependencies.

## Asset Store comparisons

The pictures are publisher promotional views, not controlled comparisons or measured gameplay results. Their visible features support the observations below; implementation facts are attributed separately. Inspect the linked gallery when a cover obscures the feature needed for the current question. Existing source preferences and the content pipeline govern actual acquisition and compatibility.

### Faceted form: Synty POLYGON

[POLYGON Fantasy Kingdom](https://assetstore.unity.com/packages/3d/environments/fantasy/polygon-fantasy-kingdom-pack-art-by-synty-164532).

![Synty cover: angular beard, crown, armor and equipment in a densely furnished throne room](https://assetstorev1-prd-cdn.unity3d.com/key-image/24b422ff-db5d-4612-8f52-63b78ee7244e.png?v=1)

Large planes remain visible in the beard, armor and stone while numerous props still establish a furnished place. Low-poly does not imply an empty scene or a few primitive placeholders. This picture does not reveal the pack's UV layout, normals or texture pipeline; the construction alternatives above are proposals, not reverse-engineered facts.

### Painted surfaces: TriForge Fantasy Forest

[Fantasy Forest Environment](https://assetstore.unity.com/packages/3d/environments/fantasy/fantasy-forest-environment-34245).

![TriForge forest cover: painted bark, clustered foliage and layered vegetation around a lit path](https://assetstorev1-prd-cdn.unity3d.com/key-image/770a4cc3-43ec-4ff8-b36c-036612454a40.png?v=1)

Leaf clusters and bark marks give the surfaces character without a uniform contour line. The publisher describes hand-painted, diffuse-only textures. That is this asset's workflow, not a definition excluding hand-painted maps from PBR. Compare an adopted painted treatment through its actual marks and neighboring surfaces; lowering polygon count or saturating green would not supply them.

### Stylized materials: StylArts House Interior

[Stylized House Interior](https://assetstore.unity.com/packages/3d/environments/stylized-house-interior-224331).

![StylArts kitchen cover: rounded appliances, painted cabinetry, glossy chairs and metallic trim](https://assetstorev1-prd-cdn.unity3d.com/key-image/e34e8f92-b42a-4022-819e-61f05250aa93.jpg?v=1)

The kitchen combines softened forms with differing highlights, surface marks and material identities. The publisher explicitly lists PBR maps. “Stylized” therefore does not imply unlit, textureless or non-PBR. An additional publisher example, [N-hance's Stylized Human Buildings](https://assetstore.unity.com/packages/3d/environments/stylized-human-buildings-205361), lists hand-painted diffuse maps together with normal maps: the categories can overlap.

### Shading choices: Flat Kit

[Flat Kit store gallery](https://assetstore.unity.com/packages/vfx/shaders/flat-kit-toon-shading-and-water-143368) and [author's Stylized Surface documentation](https://flatkit.dustyroom.com/stylized-surface/).

![Flat Kit cover: outlined robot alongside graphic forest and desert treatments](https://assetstorev1-prd-cdn.unity3d.com/key-image/c0071db5-db7b-403e-bd6b-b1bd927d9a62.png?v=1)

The cover presents multiple treatments rather than a single “stylized shader look.” The documentation separates cel modes, transition sharpness, specular, rim, gradients and outlines, and explains flat versus smooth normals. Choose those features from the desired picture. Its documented PBR option concerns indirect light; metallicness and translucency are unsupported. The label alone does not establish a full material model or compatibility.

### Cubic construction: Voxel Tile Asset Pack

[Voxel Tile Asset Pack - Lite](https://assetstore.unity.com/packages/3d/environments/voxel-tile-asset-pack-lite-398560).

![Voxel Tile pack cover: small plants and terrain tiles built from visible cubic steps](https://assetstorev1-prd-cdn.unity3d.com/key-image/489eb1df-6f68-4792-9d58-d2ee41a0a260.png?v=1)

The cubic steps define profiles and plant detail; this differs from the broad slanted planes in the Synty picture. The publisher identifies MagicaVoxel as an authoring tool, not the consumer's runtime world representation.

### Pixel sampling: ProPixelizer

[ProPixelizer store gallery](https://assetstore.unity.com/packages/vfx/shaders/fullscreen-camera-effects/propixelizer-realtime-3d-pixel-art-177877) and [author's guide](https://sites.google.com/view/propixelizer/user-guide).

![ProPixelizer cover: repeated 3D rock forms with pixel-stepped contours and color clusters](https://assetstorev1-prd-cdn.unity3d.com/key-image/017d0d21-49e9-476b-941e-402731dc416d.jpg?v=1)

The author describes low-resolution rendering, object/grid alignment and pixel expansion, distinguishing surface pixelization from geometry. The guide's pixel-creep discussion explains why the appearance must also be considered during movement; its orthographic limitations belong to that method. A still cannot verify temporal stability, responsiveness or readable text, and its Unity components are not a requirement for authored 2D pixel art.

### Image treatment: Artistic Oil Paint

[Artistic: Oil Paint store page](https://assetstore.unity.com/packages/vfx/shaders/fullscreen-camera-effects/artistic-oil-paint-264134) and [author's method documentation, Oil Paint section](https://fronkongames.github.io/store/artistic/).

![Oil Paint village promotion: coarse painted-looking treatment beside a region labelled Vanilla](https://assetstorev1-prd-cdn.unity3d.com/key-image/3b1d9b3b-673d-4fad-a33f-abdcb9da232a.jpg?v=1)

The cover contrasts coarse marks with cleaner architectural surfaces. The author describes edge-preserving smoothing, including Kuwahara variants. This is one image-space route to a painted impression, distinct from painting the object's source texture. Its still does not establish motion stability or that filtering every scene/UI layer preserves the selected design.

## Express a target rather than repeat its label

Two possible descriptions of the same market stall illustrate different decisions:

- Faceted treatment: broad roof planes and angular cloth folds, simple material color patches, restrained small-scale grain, readable contact shadows and selective warm highlights.
- Painted treatment: a curved canvas silhouette, broad directional strokes following folds, hand-painted wood color variation, softer shading transitions and restrained specular response.

These are examples, not presets or requirements for a stall. Match the actual selected picture, player action and camera; preserve the important features during production. Keep an unobserved rendering hypothesis distinct from an author-documented technique.
