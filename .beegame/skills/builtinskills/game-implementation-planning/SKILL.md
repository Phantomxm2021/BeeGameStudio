---
name: game-implementation-planning
description: Writing plans for multi-step game implementation from design and scene/UI content. 中文：依据文档和场景界面数据拆解实现任务。
---

# Game Implementation Planning

Use for a multi-step game implementation once the relevant design or feature requirements exist. A small localized fix can go straight to investigation and implementation. This is a working method for the Agent, not a new BeeGameStudio delivery phase.

## Establish the source of truth

1. For new games, complete TECHNICAL_DESIGN.md and its implementation tasks/index in the eight-document design-record stage, before actual UI/Scene/prop visual designs, resources and UI/Scene data are produced. Define the technical approach, module responsibilities, interfaces, data consumption and verification methods. Follow the remaining project order: actual visual designs, corresponding resources, authored UI/Scene data, then code/runtime verification. Revise this same plan from produced inputs before implementation; do not defer the technical document or create early layout JSON. Reuse valid existing work for follow-ups. Read the user request and relevant source documents, plus existing content, resources, code and tests when available. Describe unproduced inputs as planned with their production dependencies and consumption contracts; do not invent delivered files, IDs or evidence. In BGS, use handoff.mjs --design draft TECHNICAL_DESIGN.md to read available owner requirements even before that file exists. Available pointers are planning inputs, not proof that the baseline is valid.
2. Collect implementation outcomes from the original confirmed requirements, professional records, selected visual designs, actual Scene/UI data and corresponding resources/audio. Cover the current authorized scope, including planned actions, states and feedback; indexes alone can omit necessary work. Do not add content to fill a template or silently defer, drop or simplify confirmed outcomes.
3. Mark ownership boundaries. Preserve the project's actual content authority: selected JSON/YAML, engine scenes/assets or framework source. Do not duplicate an existing layout or move its decisions into another runtime copy; do not invent a separate BGS data layer for a native engine or DOM project.
4. Check that the inputs agree. If a required interface, asset ID, screen, or rule is missing or contradictory, name the exact source and gap. Correct the authoritative artifact if the task permits; otherwise identify the decision needed. Do not plan code around a known inconsistency.

## Decompose the implementation

Consolidate implementation tasks in TECHNICAL_DESIGN.md and its existing implementationItems index during the eight-document stage; professional records remain their design sources, not separate development backlogs. Map the owning files and cross-task interfaces before listing tasks. Share interface definitions once: producer/consumer, action or state names, inputs/outputs and consequential types/units. Reference existing definitions rather than inventing a general event framework or specifying every function. Later visual/resource/Scene/UI production updates affected references and decisions in this plan from actual outputs; preserve unaffected task IDs and content.

Split by an independently implementable and checkable result: a reusable foundation or a player-visible behavior are both valid. Modules may organize the plan, but their names alone do not define execution tasks. Group coupled work; split independently verifiable outcomes without prescribing a task count or one task per function/field. Fold scaffolding into its consumer. Order tasks by actual dependencies and name their needed outputs. A task need not launch a complete game independently; foundations and presentation need their applicable checks.

For each task, record only what another implementer would otherwise have to guess:

```text
Task: <stable task ID and observable result, not “work on UI”>
Sources: <owner clauses/sections and available paths/IDs/pictures; identify unproduced inputs as planned>
Files/interfaces: <owning code, consumed data and shared interface references>
Behavior: <list the mandatory outcomes from this project's sources, including applicable trigger/state/feedback and boundary conditions>
Check: <for those outcomes: conditions/actions -> observable expected results, applicable test/inspection/runtime method and its coverage>
Depends on: <task IDs or existing capabilities, and actual outputs needed>
```

Use concise points within Behavior and Check to keep required details visible; share original numeric tables and appearance definitions by reference. Map each mandatory point to its source and a check covering it; one check may cover several points. Name the applicable professional Skill when a task needs a specialist decision, rather than listing every Skill for every task. Interface names, source values and expected results must be usable without inventing product decisions. Do not write full implementations into the plan.

For a consequential audiovisual uncertainty, let the next useful slice expose the actual resource, scene/UI and action feedback together before duplicating that treatment across similar content. Inspect the uncertainty while it is still cheap to correct, not only after bulk implementation. Use the selected designs and corresponding prepared resources; this does not add a prototype/approval stage or replace final scope coverage.

Keep code and checks proportional. Use focused tests for deterministic rules and actual running views for visual/interactive results. One current integration result may cover several tasks; do not require a separate build/browser session/screenshot for each. State uncovered outcomes rather than mark them complete. Preserve the chosen engine and test tools; a contract, source location and observable check are enough without full function bodies.

## Review the plan before using it

- Walk the original confirmed requirements and applicable professional source sections, including selected designs and produced inputs when available. Locate each mandatory outcome in a task's Behavior and Check; a task citing a whole document or output ID alone is not coverage. Check the reverse direction too: task outcomes come from an authorized source, not a template. Carry applicable global constraints across tasks without copying them into each one. Keep omissions and unresolved inputs explicit; exclusions/deferments require user authorization. Revise affected tasks as production inputs arrive. Structural coverage cannot certify semantic completeness.
- Neighboring tasks agree on IDs, coordinates, units, types, resource paths, and interface names. No task assumes output that an earlier task does not produce.
- Each task has a meaningful completion check. Replace vague steps such as “handle edge cases” with the particular case and expected result.
- The plan is shorter than the work it guides. If it becomes a second set of eight documents or a transcript of code to type, consolidate it.

Complete and finalize the technical document and index in the eight-document stage. Missing later production inputs remain planned dependencies, not a reason to leave the technical design as a draft. Produce them in workflow order and revise affected task inputs before execution; do not restart still-valid professional documents or treat a Todo tick as a saved result. After saving an owner document and index, explicitly use the existing handoff.mjs --design finalize DOCUMENT.md for host version metadata; do not add version headers by hand. Finalize does not certify design or runtime quality.

Keep the existing plan and index; do not create another delivery plan, checklist format or task database. In BGS, tasks point to concise technical-document sections and original owner requirements. Use ReadDesignHandoff `{}` for available inputs/issues and `{read:[{document:"GDD.md",sections:["Exact saved heading"]}]}` for selected original prose. ReadImplementationTask `{}` lists the existing task IDs/dependencies; `{"id":"actual-task-id"}` reads a task and its directly referenced owner section locations. Both keep readable inputs available despite unrelated gaps and never finalize or lock. Use native Read for additional sources and pictures. CheckResourcesAndBindings checks saved UI/Scene resource references against actual registered files; it does not certify runtime wiring or original scope completeness. Once the design is finalized/locked, execution progress belongs in the existing execution task list with the same task IDs and result paths, not appended to the technical document. Required design changes follow current authorization; planning alone does not certify delivery.
