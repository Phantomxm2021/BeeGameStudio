---
name: game-implementation-planning
description: Write technical design and useful implementation guidance from agreed requirements and available design/content sources. 中文：技术设计、模块接口与实现任务规划。
---

# Game Implementation Planning

For a technical GDD assignment, choose the engine/platform approach, module and state ownership, resource-consuming interfaces and the first coherent implementation unit. Record these decisions and concrete unresolved dependencies in the single `docs/GDD.md`. The handoff lets implementation begin; it does not require a task-by-task plan, code, Scene/UI assembly or runtime evidence.

Use the confirmed brief, owning design sections and actual available content/code. Preserve the selected engine/framework and content authority; do not duplicate layouts or invent another data layer. Shared interfaces need producer/consumer, inputs/outputs and consequential units/types. Unavailable resource facts remain planned, without invented paths, IDs or evidence. Resolve a conflict in an interface being handed off in its owning section; this is not a whole-GDD review assignment.

For an uncertain or version-sensitive engine/API/format capability needed by the decision, reuse current research or consult official documentation for the selected version. Keep the conclusion and source with the decision, distinguishing documented support from local verification. An unavailable source leaves the affected assumption unresolved; it need not block independent work.

## Planning authorized implementation

A local fix can go directly to investigation and implementation. For multi-step work spanning a context reset or handoff, use the existing task/progress file, or `docs/TASKS.md` if none exists. Keep tasks out of the GDD; no machine index, extra design plan or function-by-function architecture is needed.

Group work around coherent player situations: action, rules and perceivable consequences. Define each task's outcome, source sections, needed inputs/interfaces and expected observations. Use selected visuals and real resource facts for composition; complete a representative situation and its states before propagating an uncertain treatment. Preserve remaining confirmed scope and unavailable dependencies. Independent work can use disjoint files and settled interfaces; shared design, Manifest/index, configuration and wiring stay with the integrating parent.

Plan checks for affected rules/interfaces and ordinary input through state transitions and feedback. Seeded tests can isolate rules but do not verify the delivered input path. Reuse valid evidence, and recheck affected inputs after changes. Builds, browser runs and screenshots are needed for the outcomes they establish, not for every task. Broader experience judgments remain user-playtest questions unless that investigation was requested.

ReadDesignHandoff locates GDD sections; ReadImplementationTask supplies optional existing task pointers. Use current sources, not navigation indexes as proof. Update progress with actual outcomes, evidence and remaining work at meaningful checkpoints. Keep delivered resource facts in the Manifest and product/numeric/appearance definitions in their owning GDD sections. A task tick is not delivery.
