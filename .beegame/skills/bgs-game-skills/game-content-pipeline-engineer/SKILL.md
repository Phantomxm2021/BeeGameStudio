---
name: game-content-pipeline-engineer
description: Author ASSET_PLAN.md and choose resource representations from designed actions, state changes and composition; source, import or debug assets through Scene/UI into the runtime. Use the selected art/audio direction, not a new style. 中文：资源计划、设计行为到资源制法的选择、资源获取与导入、场景解析、运行时消费。
---

# Game Content Pipeline Engineer

Make authored content render and behave consistently in the selected game technology. This Skill concerns content production and consumption; it does not require BeeGameStudio to provide a game engine or prescribe which engine the Agent uses.

## Resource planning

Establish ASSET_PLAN.md among the eight design records with resource roles, representation choices and unresolved resource needs. From the confirmed brief and owning designs, describe how the game's resource groups fit together, such as characters, environments, UI, effects and audio, and which parts are shared or reusable. Refine this overall view as work develops; detail the current part and leave unavailable inputs planned. Select production methods from the selected visual/audio designs rather than settling them before those designs exist. Keep actual files/frames and metrics in the existing Manifest.

Choose resources from the required actions, state changes and composition, separating parts that move, change, are replaced or reused independently. For 2D, consider distinct poses, independently controlled parts/layers or runtime drawing. For 3D, plan compatible model parts, materials/textures and rigs/animations, with attachment points or scene-module joins where needed and a consistent scale. Whole-image transforms cannot supply missing poses or independently move baked-in parts. Preserve independent control even when artwork shares an atlas, and keep live text/effects separate from static art. Carry these choices into acquisition requests and inspect whether the delivered resources support them before integration. Record format, display scale, provenance and authorized fallbacks; resolve representation conflicts before production. Use existing sections without a second inventory or mandatory mapping schema.

Reference TECHNICAL_DESIGN.md for target/runtime and integration choices, and the owning UI/level designs for space and framing. Add resource-specific format, loading or feasibility constraints where needed; do not copy behavior, layout, camera or interface definitions into the asset plan. A prototype or calculation is needed only for a specific unresolved question, not document completion.

Projects using the BGS Scene/UI Editor keep its document locations in `content/index.json`; native engines retain their own scene/UI formats. BGS resource identity lives in `assets/asset-manifest.json`. BGS screen UI and Scene objects remain distinct editable models consumed by the runtime. Preserve these data contracts; an optional renderer's limits do not justify deleting valid source data.

For an uncertain resource family, sourcing or consequential cost choice, read the applicable [resource matching and cost examples](references/resource-selection.md). Before committing production to an unresolved choice, reuse relevant design research or use available web tools to search public references and assets for the concrete gap: composition/part separation, scale, formats or compatible 3D materials, rigs and animations. Inspect the source rather than rely on search snippets; use official format/runtime documentation for technical claims and verify reuse rights when acquiring files. Keep useful source links, conclusions and the production choices they inform in ASSET_PLAN.md. Research ends when the choice has enough support; new gaps or outdated facts justify another search, not each document or asset batch. If research is unavailable or inconclusive, retain the uncertainty without invented sources and continue work that does not depend on it.

Acquire the resources for a useful complete composition and inspect them in the runtime before producing an uncertain family at scale; unrelated resource families need not block its implementation. Preserve the selected visual/audio intent and actual resource policy. A candidate list is not delivered resources, and a fallback is not permission to change a required appearance or behavior.

For a concrete resource-format or renderer feasibility question, or for acquiring, registering, importing and verifying actual files, read the relevant section of [production and integration](references/production-integration.md). It contains the supplied command usage, atlas/3D import details and saved-resource checks.
