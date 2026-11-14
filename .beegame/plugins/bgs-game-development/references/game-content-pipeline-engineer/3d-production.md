# 3D asset generation and preparation

Produce the independently usable model parts the current game needs, preserving the confirmed appearance, proportions, movable parts, scale and target-engine requirements. Use the actual project's resource IDs, directories and inventory. This reference provides production methods within the content pipeline.

## Source and generation

Follow the existing [artwork source guidance](artwork-production.md). When new 3D generation is appropriate, select an available authorized source that supports the required output. Read the selected [provider's access/capability notes](3d/providers.md), which also retain the package's existing fallback preference separately from production technique. User-selected sources and suitable supplied assets retain priority. Cost is an authorization/budget constraint, not the visual-production objective.

Use the available authorized API, MCP or browser integration. Browser work uses a dedicated authorized session; the user handles login or CAPTCHA. Reuse applicable authorization and current source/rights information. Confirm unresolved upload permission, download rights or spending authority before the affected action; do not extract account credentials or bypass service restrictions. Open-source model licenses and hosted-service terms are separate.

Build the request around the intended subject, silhouette, proportions, material treatment and independently controlled parts. Use the selected design/reference image when it defines appearance. Specify orientation, view and separation where they matter to the consumer; exclude unintended stage, labels and baked shadows, while retaining any ground/base or separate parts the actual asset needs. Retrieve the completed model and its texture dependencies through the allowed channel; a submitted task is not a downloaded asset.

## Prepare only what needs work

Inspect the acquired model before changing it. A usable model does not need a second low-poly copy, UV replacement, retopology or bake-down merely because these techniques are available. Preserve originals and their dependency set; keep transformations and optimization on output copies.

For actual geometry, UV, normal-map or material work, read [Blender preparation](3d/blender-pbr.md), which links the shared mesh/material method. Use the batch [static-prop helper](../../scripts/game-content-pipeline-engineer/3d/process_asset.py) only for an appropriate static prop requiring reduction or missing UVs. It does not preserve a character animation deliverable or perform baking. For rigs/clips use [skeletal animation handoff](../game-art-director-expert/skeletal-animation-handoff.md).

Verify the properties affected by production: silhouette and material treatment against the reference, scale/pivot and independent parts in the target runtime, and the required dependency closure. Observe the asset at its intended gameplay distance and lighting. Use actual delivered paths, production facts, source records and remaining limitations from the existing tools. File availability and structural facts alone do not establish visual agreement or runtime behavior.

## Utilities and limits

Resolve the installed plugin root two levels above the content-pipeline Skill directory; the commands below use that root, not the game workspace.

- `blender -b --python scripts/game-content-pipeline-engineer/3d/process_asset.py -- --input /absolute/input.glb --output /absolute/game.glb --report /absolute/process.json --triangles <project-target>` runs in a disposable batch scene, not a live Blender session. The target is not guaranteed; inspect the returned actual count and output.
- `python3 scripts/game-content-pipeline-engineer/3d/validate_glb.py /absolute/game.glb --max-triangles <project-target> --json /absolute/metadata.json` reads GLB metadata and declared mesh triangle counts only, despite its retained filename. It does not validate buffer contents, dependency completeness or conformance. Its process exit status is not asset acceptance.
- For format conformance, use an already available [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator); its [Node interface](https://github.com/KhronosGroup/glTF-Validator/tree/main/node) supports `validateBytes` and reports issues. If unavailable, leave that validation unperformed rather than treating the metadata helper as a substitute. Runtime import and appearance observations remain separate.

Report concrete tool errors and affected unfinished work. Keep source/license restrictions and existing charge authorization intact without adding another status machine or review task.
