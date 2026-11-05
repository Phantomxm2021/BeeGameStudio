# Blender preparation for generated assets

Use the shared [mesh and material production method](../../game-content-pipeline-engineer/references/mesh-material-production.md) for UVs, baking, channels and runtime checks. This reference adds only details specific to the optional batch helper.

## Static-prop batch processing

`scripts/process_asset.py` is a disposable-scene Blender batch utility. It imports an asset, duplicates its mesh data, reduces geometry toward the supplied budget where necessary, creates UVs only if absent, and exports selected mesh copies. Keep the original file and dependencies. Existing usable models may be imported directly without running this utility.

The utility does not provide artistic retopology, bake high-detail geometry, preserve a rig/animation deliverable, build collision meshes, establish scene-scale correctness or prove texture quality. Use the applicable existing method for those needs. Decimation can alter silhouette and UV interpolation; inspect the affected output before consuming it.

## Material and bake details

- Preserve supplied texture maps and their color-space/channel assignments. A constant roughness or metallic factor can be an authored approximation; a derived guess is not a recovered source map.
- Bake high-to-low only when source geometry and a projection target exist. Match transforms, selected-to-active direction and cage/ray distance. Avoid unintended UV overlap on independently baked regions; intentional reuse or mirrored UVs are not universally invalid.
- glTF tangent-space normal textures use the +Y/OpenGL convention. Convert a -Y/DirectX source when needed; do not flip channels merely because an engine name appears. Normal, roughness, metallic and occlusion textures are non-color data. In packed ORM, R is occlusion, G roughness and B metallic.
- After export, inspect silhouette, seams, projection errors, materials and lighting on the intended mesh in its target runtime. Dependency resolution must work without relying on source-machine absolute paths.

References: [Blender baking](https://docs.blender.org/manual/en/latest/render/cycles/baking.html), [glTF materials specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials), [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator).
