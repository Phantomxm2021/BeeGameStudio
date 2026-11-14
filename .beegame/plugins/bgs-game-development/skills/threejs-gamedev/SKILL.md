---
name: threejs-gamedev
description: "Select Three.js for a new Web 3D project only when no user-specified or existing engine governs it; implement or debug Three.js scene/render APIs, animation, picking, loading and performance in a selected Three.js runtime, including React Three Fiber and glTF format/loading work. Playable layout, visual expression, control response and interface transitions use their task methods. 中文：无用户指定或已有引擎约束的新建 Web 3D 默认选 Three.js；用于 Three.js API 实现与排障，不替代操作、界面和表现设计方法。"
---

# Three.js Game Development

Work within the selected runtime and existing project. Resolve APIs from the
installed `three` version, its exports/source and compatible typings; use the
matching official documentation when behavior is unclear. Upstream examples
below target r186 (`three@0.186`), with R3F 9.8, drei 10.7 and gltf-transform 4.5
where relevant. Those are reference baselines, not dependency installation or
upgrade instructions. For a new setup or concrete compatibility mismatch, use
[runtime dependency selection](../../references/runtime-dependencies.md).

Preserve adopted design and the project's renderer and hosting approach. WebGL and WebGPU examples
are alternatives with different APIs; React as an application shell does not
by itself require React Three Fiber. For relationships being built or changed, read the corresponding method:
[Scene/spatial design](../game-scene-designer/SKILL.md) for playable arrangements,
[Art](../game-art-director-expert/SKILL.md) for visual expression,
[UI/UX](../game-ui-ux-designer/SKILL.md) for interface states and transitions,
[controls and feel](../game-feel-designer/SKILL.md) for input and action response,
or [resource production](../game-content-pipeline-engineer/SKILL.md) for source
choice and deliverables. Reuse existing implementation and methods already read
in context. First realization still constructs the runtime result even with a
complete GDD; API-only questions use the technical references below.

## Read for the actual task

Select the relevant topic and section; each reference keeps its own examples
and common mistakes. Related-topic links are navigation, not a required reading
sequence. Search headings or the API symbol before reading a whole reference.

| Current problem | Technical reference |
|---|---|
| Scene setup, camera, transforms, render loop and cleanup | [Scene/camera](../../references/threejs-gamedev/threejs-fundamentals.md#scene), [render loop/setup](../../references/threejs-gamedev/threejs-fundamentals.md#quick-start), [coordinates](../../references/threejs-gamedev/threejs-fundamentals.md#coordinate-system), [cleanup](../../references/threejs-gamedev/threejs-fundamentals.md#cleanup) |
| BufferGeometry, instancing, batching, points and lines | [BufferGeometry](../../references/threejs-gamedev/threejs-geometry.md#buffergeometry), [instancing](../../references/threejs-gamedev/threejs-geometry.md#instancedmesh), [batching](../../references/threejs-gamedev/threejs-geometry.md#batchedmesh), [morph targets](../../references/threejs-gamedev/threejs-geometry.md#morph-targets) |
| PBR, transparency, material slots and recompilation | [Material choice](../../references/threejs-gamedev/threejs-materials.md#material-types-overview), [PBR](../../references/threejs-gamedev/threejs-materials.md#meshstandardmaterial-pbr), [runtime changes/disposal](../../references/threejs-gamedev/threejs-materials.md#runtime-changes-cloning-disposal) |
| Lights, physical units, shadows and environments | [Light units](../../references/threejs-gamedev/threejs-lighting.md#light-types-and-units), [shadows](../../references/threejs-gamedev/threejs-lighting.md#shadows), [environment lighting](../../references/threejs-gamedev/threejs-lighting.md#environment-lighting-ibl), [probes](../../references/threejs-gamedev/threejs-lighting.md#light-probes) |
| Color space, UVs, texture memory and render targets | [Color space](../../references/threejs-gamedev/threejs-textures.md#color-space), [UV channels](../../references/threejs-gamedev/threejs-textures.md#uv-channels), [filtering](../../references/threejs-gamedev/threejs-textures.md#filtering-mipmaps-anisotropy), [KTX2](../../references/threejs-gamedev/threejs-textures.md#compressed-textures-ktx2) |
| Clips, skeletal/morph animation and blending | [Mixer](../../references/threejs-gamedev/threejs-animation.md#animationmixer), [actions/interruption](../../references/threejs-gamedev/threejs-animation.md#animationaction), [crossfades](../../references/threejs-gamedev/threejs-animation.md#fades-and-crossfades), [skeletal animation/clones](../../references/threejs-gamedev/threejs-animation.md#skeletal-animation) |
| glTF/GLB loading, progress, decoder setup and disposal | [GLTFLoader, Draco, meshopt, KTX2, loading ownership](../../references/threejs-gamedev/threejs-loaders.md#gltf-and-glb) |
| Picking, pointer coordinates, camera controls and dragging | [Raycaster, layers, world/screen coordinates, pointer capture](../../references/threejs-gamedev/threejs-interaction.md#raycasting) |
| Custom GLSL, shader chunks, TSL and node materials | [WebGL materials](../../references/threejs-gamedev/threejs-shaders.md#shadermaterial-vs-rawshadermaterial), [GLSL patterns](../../references/threejs-gamedev/threejs-shaders.md#common-shader-patterns), [WebGPU/TSL](../../references/threejs-gamedev/threejs-shaders.md#webgpu-and-tsl) |
| EffectComposer, pass order and WebGPU RenderPipeline | [Output conversion, bloom, depth, resizing and render passes](../../references/threejs-gamedev/threejs-postprocessing.md#pass-order) |
| Diagnosing CPU, draw-call, memory or fill-rate bottlenecks | [Frame measurement, instancing/batching, allocation, compile stalls](../../references/threejs-gamedev/threejs-performance.md#measure-first) |
| An existing or explicitly selected React Three Fiber runtime | [Canvas, useFrame, pointer propagation, Suspense, drei, disposal](../../references/threejs-gamedev/threejs-react-three-fiber.md#canvas-props) |
| Preparing and compressing existing 3D assets | [Inspection](../../references/threejs-gamedev/threejs-asset-pipeline.md#inspect-and-validate), [geometry compression](../../references/threejs-gamedev/threejs-asset-pipeline.md#geometry-compression), [texture compression](../../references/threejs-gamedev/threejs-asset-pipeline.md#texture-compression), [matching loaders](../../references/threejs-gamedev/threejs-asset-pipeline.md#loader-setup-for-each-output) |

Use the examples to resolve concrete implementation questions. Observe the
changed behavior with the project's available tools; these notes do not
prescribe a test harness, report schema, audit stage or BGS completion protocol.

## Source and adaptation

Technical references are adapted from [CloudAI-X/threejs-skills](https://github.com/cloudai-x/threejs-skills),
revision `0e181866f095b5f06d005133876e926515390d95` (retrieved 2026-11-03), under the
included [MIT license](../../references/threejs-gamedev/LICENSE.txt). Skill frontmatter is removed and cross-topic references resolve to local files.
Repeated WebGL scene/camera/renderer scaffolding is centralized in fundamentals;
topic-specific API examples and renderer/version distinctions are retained.
React Three Fiber keeps its separate hosting example.
Only this entry is discoverable as a Skill. No upstream installer, plugin,
external service or project dependency is installed. Upstream verification
claims are not a new runtime verification of any BGS project.
