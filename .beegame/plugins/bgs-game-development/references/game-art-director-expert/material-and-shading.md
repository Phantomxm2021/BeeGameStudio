# Material and shading expression

Use when first choosing a surface/light treatment, realizing adopted stylized shading, or diagnosing a material/shader mismatch. A layout or binding repair needs no shader work. Connect the visible relationship to its rendering method; the content pipeline prepares required geometry and maps.

## Choose the visible response

Describe the affected subject at its gameplay camera: how planes and edges read, how its surface responds to light/view changes, and what changes with a real state. A style label or a shader name leaves these choices unresolved. Keep the choice in the existing art/material source rather than create another specification.

| Intended relationship | Possible construction | Mismatch to distinguish |
| --- | --- | --- |
| A material's shape and surface remain distinguishable | Authored value groups, normals, roughness/specular response, suitable illumination or a baked treatment | One tint/roughness applied everywhere leaves different surfaces interchangeable; stronger lighting may still miss a flattened silhouette |
| A drawn or graphic treatment carries volume | Chosen light bands, contours, hatch/stipple marks or texture modulation | Marks obscure important edges, change apparent scale, swim over the object or alias during camera movement |
| A surface communicates activation or transformation | A localized emission/mask/deformation driven by the confirmed state | A decorative pulse implies an event that never happened, or the transient cue loses the persistent result |
| Space and effects retain a depth relationship | Appropriate light falloff, fog, transparency or selective screen-space treatment | Glow erases contact edges, a screen effect obscures HUD information, or foreground and background collapse together |

These are alternatives for a demonstrated appearance need, not a required set of effects. The [finished-picture studies](ui-visual-hierarchy.md#finished-game-references) distinguish visible observations from proposed techniques; a screenshot cannot identify the shader that produced it.

For concrete light-band, authored-paint and image-filter implementations, use [style-to-rendering cases](style-rendering-cases.md). Sprite-specific sampling/lighting uses [2D rendering](2d-rendering-cases.md).

## Choose the rendering method

Use an existing material/lighting model and authored maps when they express the intended result. Toon/unlit, baked and physically based treatments are choices, not quality tiers. Extend a supported material/node graph or write a custom shader when a specific required response is missing; a default PBR material with a new tint is insufficient evidence of an adopted surface treatment, while a custom shader is not an improvement by itself.

Put a change where its information lives: geometry for a required silhouette, material/texture for a surface response, or a screen pass for a selected image-space relationship. Normal detail cannot restore a missing profile. Choose object/world/UV versus screen coordinates deliberately: marks attached to a surface should behave accordingly as the object/camera moves; a screen-anchored pattern can instead be an intentional graphic choice.

Implement in the current engine's supported shader/material facilities and version. Reuse its lighting, color/output conversion, depth and transparency conventions where required; replacing a lit material with custom code does not automatically preserve those behaviors. For Three.js, use the existing [materials](../threejs-gamedev/threejs-materials.md) and [shader methods](../threejs-gamedev/threejs-shaders.md#shadermaterial-vs-rawshadermaterial), selecting the actual WebGL or WebGPU path. Other engines keep their native facilities; this method does not select Three.js.

## Observe the material in context

Use the affected mesh, neighboring surfaces, lighting and intended camera distance. For motion/state-dependent shading, follow the relevant movement or transition: inspect contour separation, pattern scale/stability, specular/glow competition and state truthfulness. An isolated sphere, compiling shader or endpoint screenshot answers only part of that question. Reuse the existing observation and lifecycle; measure actual rendering cost before adding passes or reducing required appearance.

Primary technical reference: [Godot spatial shaders](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/spatial_shader.html) illustrates vertex, fragment and light processing plus native render modes. These are implementation distinctions, not portable shader syntax or an engine requirement.
