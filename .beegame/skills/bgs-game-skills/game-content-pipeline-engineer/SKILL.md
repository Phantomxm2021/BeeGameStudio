---
name: game-content-pipeline-engineer
description: Plan resource sourcing and import needs, or load/debug tilemaps, atlas frames, meshes, animation and VFX references through Scene/UI into the runtime. Use the selected art/audio direction, not a new style. 中文：资源规划与获取、资源导入、图集瓦片、场景解析、运行时消费。
---

# Game Content Pipeline Engineer

Make authored content render and behave consistently in the selected game technology. This Skill concerns content production and consumption; it does not require BeeGameStudio to provide a game engine or prescribe which engine the Agent uses.

## Resource planning

Establish ASSET_PLAN.md among the eight design records with intended uses, required appearance/behavior and unresolved resource needs. Select production methods from the selected visual/audio designs rather than settling them before those designs exist. Update the same plan for the current part; leave unrelated inputs planned. Keep actual files/frames and metrics in the existing Manifest, and resolve their consuming interfaces before affected implementation.

In the existing resource inventory, connect each required visual/audio use to its owning design requirement, chosen representation and delivered file/frame when available. Record format, display scale, source/license or production route, and an authorized fallback for uncertain work. Choose production boundaries from required motion and state changes: parts that move, deform or change visibility independently must remain separately controllable, even if they share an atlas. Keep runtime-drawn effects and live text out of the static artwork they accompany; reference their existing implementation tasks. Carry these boundaries into image requests and delivered-art inspection; resolve conflicting design/production choices in the owning document before generation. A requirement is not automatically one image request.

Reference TECHNICAL_DESIGN.md for target/runtime and integration choices, and the owning UI/level designs for space and framing. Add resource-specific format, loading or feasibility constraints where needed; do not copy layout, camera or interface definitions into the asset plan. A prototype or calculation is needed only for a specific unresolved question, not document completion.

Projects using the BGS Scene/UI Editor keep its document locations in `content/index.json`; native engines retain their own scene/UI formats. BGS resource identity lives in `assets/asset-manifest.json`. BGS screen UI and Scene objects remain distinct editable models consumed by the runtime. Preserve these data contracts; an optional renderer's limits do not justify deleting valid source data.

For an uncertain resource family, sourcing or consequential cost choice, read the applicable [resource matching and cost examples](references/resource-selection.md). Acquire the resources for a useful complete composition and inspect them in the runtime before producing an uncertain family at scale; unrelated resource families need not block its implementation. Preserve the selected visual/audio intent and actual resource policy. A candidate list is not delivered resources, and a fallback is not permission to change a required appearance or behavior.

For a concrete resource-format or renderer feasibility question, or for acquiring, registering, importing and verifying actual files, read the relevant section of [production and integration](references/production-integration.md). It contains the supplied command usage, atlas/3D import details and saved-resource checks.
