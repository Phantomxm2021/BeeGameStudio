# Blender preparation for generated assets

Use the shared [mesh and material production method](../../game-content-pipeline-engineer/references/mesh-material-production.md) for UVs, baking, channels and runtime checks. This reference adds only details specific to the optional batch helper.

## Static-prop batch processing

`scripts/process_asset.py` is a disposable-scene Blender batch utility. It imports an asset, duplicates its mesh data, reduces geometry toward the supplied budget where necessary, creates UVs only if absent, and exports selected mesh copies. Keep the original file and dependencies. Existing usable models may be imported directly without running this utility.

The utility does not provide artistic retopology, bake high-detail geometry, preserve a rig/animation deliverable, build collision meshes, establish scene-scale correctness or prove texture quality. Use the applicable existing method for those needs. Decimation can alter silhouette and UV interpolation; inspect the affected output before consuming it.

References: [Blender baking](https://docs.blender.org/manual/en/latest/render/cycles/baking.html), [glTF materials specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials), [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator).
