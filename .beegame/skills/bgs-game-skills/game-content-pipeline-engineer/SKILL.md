---
name: game-content-pipeline-engineer
description: Author the resources/content chapter in docs/GDD.md and choose resource representations from designed actions, state changes and composition; source, import or debug assets through Scene/UI into the runtime. Use the selected art/audio direction, not a new style. 中文：资源计划、设计行为到资源制法的选择、资源获取与导入、场景解析、运行时消费。
---

# Game Content Pipeline Engineer

Make authored content render and behave consistently in the selected game technology. This Skill concerns content production and consumption; it does not require BeeGameStudio to provide a game engine or prescribe which engine the Agent uses.

## Resource planning

For a GDD handoff, choose resource families, representations, shared/independent parts and source/rights constraints needed to make the selected rules and presentation feasible. Reference the owning gameplay, art/audio, UI/level and technical sections; leave unavailable inputs planned. Actual file lists, frame counts, dimensions and production requests follow selected visual/audio designs. A separate inventory, prototype or sourcing exercise is not required for chapter completion.

Representations must support the required actions and independent changes: a translated still image does not replace changing character poses, and baked-in parts cannot move independently. For 2D, identify needed action/state sequences and reusable layers; for 3D, identify compatible models, rigs/animations and modular joins. Keep live text/state separate from static artwork. Resolve a concrete feasibility uncertainty before dependent production without copying rules, layout or interfaces into this chapter.

## Acquisition and integration

Honor explicit sources and suitable supplied assets. Follow the confirmed resource-library preference; otherwise choose suitable library, public, generated or procedural resources based on required representation, quality, rights and cost. Match required actions, readable cues, style and reuse rights. Incidental Agent-authored appearance details may adapt in their owning GDD section; confirmed gameplay and identities may not be dropped to fit assets. For a concrete sourcing, family or cost choice, read [resource selection](references/resource-selection.md), stopping when a usable match is found. Unavailable access is an evidence gap, not an empty catalog.

Acquire, inspect and register resources for a coherent player situation, then connect them to consumers and observe the required feedback before expanding during implementation. Saved resource-only assignments stop at their boundary. Keep actual files/frames, metrics and provenance in the Manifest; a candidate list or a final label is not delivered/verified content. Keep source choice distinct from runtime consumption: Canvas may play sprites without procedurally replacing their artwork.

For character animation production from any source, read [sprite animation](../game-technical-artist/references/ai-sprite-animation.md); use its AI-generation method only if selected. Inspect independently controlled parts, pose coverage and alignment against the selected design before integration. Reconcile consequential resource/design conflicts in their owning sections.

Sourcing or generation failure does not authorize dropping required appearance or behavior. Procedural resources are suitable when they meet the confirmed style and selected design; do not use them to disguise an unmet artwork requirement. Keep unmet inputs explicit and continue independent authorized work.

For a concrete resource-format or renderer feasibility question, or for acquiring, registering, importing and verifying actual files, read the relevant section of [production and integration](references/production-integration.md). It contains the supplied command usage, atlas/3D import details and saved-resource checks.
