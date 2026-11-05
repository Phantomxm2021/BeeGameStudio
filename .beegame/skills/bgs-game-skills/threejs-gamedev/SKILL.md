---
name: threejs-gamedev
description: Implement and debug Three.js scenes, materials, lighting, textures, animation, interaction and rendering performance; includes React Three Fiber and glTF asset preparation when those are in scope. Use for a selected Three.js runtime, not general GDD writing or choosing an engine. 中文：Three.js 专业实现与排障，相关技术参考按需读取。
---

# Three.js Game Development

Work within the selected runtime and existing project. Resolve APIs from the
installed `three` version, its exports/source and compatible typings; use the
matching official documentation when behavior is unclear. Upstream examples
below target r186 (`three@0.186`), with R3F 9.8, drei 10.7 and gltf-transform 4.5
where relevant. Those are reference baselines, not dependency installation or
upgrade instructions. For a new setup or concrete compatibility mismatch, use
[runtime dependency selection](../gameplay-programmer/references/runtime-dependencies.md).

Preserve the project's renderer and hosting approach. WebGL and WebGPU examples
are alternatives with different APIs; React as an application shell does not
by itself require React Three Fiber. Technical examples do not choose the
game's art direction, asset source, layout or features.

## Read for the actual task

Select the relevant topic and section; each reference keeps its own examples
and common mistakes. Related-topic links are navigation, not a required reading
sequence. Search headings or the API symbol before reading a whole reference.

| Current problem | Technical reference |
|---|---|
| Scene setup, camera, transforms, render loop and cleanup | [Scene hierarchy, coordinate spaces, Timer, renderer setup](references/threejs-fundamentals.md) |
| BufferGeometry, instancing, batching, points and lines | [Geometry attributes, morph targets, bounds and draw calls](references/threejs-geometry.md) |
| PBR, transparency, material slots and recompilation | [Standard/Physical/Toon materials, blending, node materials](references/threejs-materials.md) |
| Lights, physical units, shadows and environments | [Shadow cameras, HDR image-based lighting, light probes](references/threejs-lighting.md) |
| Color space, UVs, texture memory and render targets | [sRGB versus data textures, channels, filtering, KTX2](references/threejs-textures.md) |
| Clips, skeletal/morph animation and blending | [AnimationMixer, action interruption, crossfades, skinned clones](references/threejs-animation.md) |
| glTF/GLB loading, progress, decoder setup and disposal | [GLTFLoader, Draco, meshopt, KTX2, loading ownership](references/threejs-loaders.md#gltf-and-glb) |
| Picking, pointer coordinates, camera controls and dragging | [Raycaster, layers, world/screen coordinates, pointer capture](references/threejs-interaction.md#raycasting) |
| Custom GLSL, shader chunks, TSL and node materials | [WebGL ShaderMaterial versus WebGPU node graphs](references/threejs-shaders.md) |
| EffectComposer, pass order and WebGPU RenderPipeline | [Output conversion, bloom, depth, resizing and render passes](references/threejs-postprocessing.md#pass-order) |
| Diagnosing CPU, draw-call, memory or fill-rate bottlenecks | [Frame measurement, instancing/batching, allocation, compile stalls](references/threejs-performance.md#measure-first) |
| An existing or explicitly selected React Three Fiber runtime | [Canvas, useFrame, pointer propagation, Suspense, drei, disposal](references/threejs-react-three-fiber.md#canvas-props) |
| Preparing and compressing existing 3D assets | [gltf-transform, compression ordering and matching loader setup](references/threejs-asset-pipeline.md) |

Use the examples to resolve concrete implementation questions. Observe the
changed behavior with the project's available tools; these notes do not
prescribe a test harness, report schema, audit stage or BGS completion protocol.

## Source and adaptation

The technical files now include short problem/renderer section links; this changes navigation, not their API examples. Technical references are adapted from [CloudAI-X/threejs-skills](https://github.com/cloudai-x/threejs-skills),
revision `0e181866f095b5f06d005133876e926515390d95` (retrieved 2026-11-03), under the
included [MIT license](LICENSE.txt). The technical bodies are retained; their
Skill frontmatter is removed and cross-topic references resolve to local files.
Only this entry is discoverable as a Skill. No upstream installer, plugin,
external service or project dependency is installed. Upstream verification
claims are not a new runtime verification of any BGS project.
