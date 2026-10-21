---
name: game-implementation-planning
description: Writing plans for multi-step game implementation from design and scene/UI content. 中文：依据文档和场景界面数据拆解实现任务。
---

# Game Implementation Planning

Use for a multi-step game implementation once the relevant design or feature requirements exist. A small localized fix can go straight to investigation and implementation. This is a working method for the Agent, not a new BeeGameStudio delivery phase.

## Establish the source of truth

1. For new games, complete TECHNICAL_DESIGN.md and necessary implementation guidance in the eight-document stage, before actual visual designs, resources and UI/Scene data. Define the technical approach, module responsibilities, interfaces, data consumption and verification methods. Mark unproduced inputs as planned dependencies with consumption contracts, not delivered files, IDs or evidence. Follow the project guide's production order; revise this same plan from actual outputs before implementation, without early layout JSON. Reuse valid existing work for follow-ups.
2. Read the confirmed requirements and relevant professional records, plus selected pictures, content, resources/audio, code and tests when available. Derive outcomes from these original sources; indexes alone can omit necessary work. Do not add content to fill a template or silently defer, drop or simplify confirmed outcomes.
3. Preserve the project's content authority: selected JSON/YAML, engine scenes/assets or framework source. Do not duplicate layouts in runtime code or invent a separate BGS data layer for a native engine or DOM project.
4. Reconcile missing or contradictory rules, interfaces and resources in their owning sources before planning consumption. Compare prose with selected pictures: correct pictures contradicting confirmed requirements; revise affected UI/art/Scene records, resource choices and task inputs/checks within current authority. Preserve unrelated content and IDs; otherwise identify the decision needed. If JSON contradicts the reconciled design, correct authored data; if JSON matches but runtime differs, inspect loading/consumption/rendering rather than rewriting valid data. Geometry/binding PASS does not establish visual agreement; missing observations remain unverified.

## Decompose the implementation

Keep implementation guidance in TECHNICAL_DESIGN.md; choose task structure and detail to suit the work, without a required machine index; professional records remain design sources, not separate development backlogs. Map owning files and shared interfaces once: producer/consumer, action or state names, inputs/outputs and consequential types/units. Reference these definitions rather than inventing a general event framework or specifying every function.

Split by an independently implementable and checkable result: a reusable foundation or a player-visible behavior are both valid. Modules may organize the plan, but their names alone do not define execution tasks. Group coupled work; split independently verifiable outcomes without prescribing a task count or one task per function/field. Fold scaffolding into its consumer. Order tasks by actual dependencies and name their needed outputs. A task need not launch a complete game independently; foundations and presentation need their applicable checks.

For work that benefits from explicit tasks, the following is an optional example. Include only what another implementer would otherwise have to guess:

```text
Task: <stable task ID and observable result, not “work on UI”>
Sources: <owner clauses/sections and available paths/IDs/pictures; identify unproduced inputs as planned>
Files/interfaces: <owning code, consumed data and shared interface references>
Behavior: <list the mandatory outcomes from this project's sources, including applicable trigger/state/feedback and boundary conditions>
Check: <for those outcomes: conditions/actions -> observable expected results, applicable test/inspection/runtime method and its coverage>
Depends on: <task IDs or existing capabilities, and actual outputs needed>
```

Use concise Behavior and Check points; reference original numeric tables and appearance definitions. One check may cover several mandatory points. Name a professional Skill only when a task needs its specialist decision. Interface names, source values and expected results must be usable without inventing product decisions; do not write full implementations into the plan.

For a consequential audiovisual uncertainty, plan a useful slice exposing the selected design, prepared resource, Scene/UI and action feedback together before repeating that treatment across content. This does not add a prototype/approval stage or replace final scope coverage.

Use focused tests for deterministic rules and actual running views for visual/interactive results. One current integration result may cover several tasks; do not require a separate build/browser session/screenshot for each. Preserve the chosen engine and test tools; state uncovered outcomes rather than mark them complete.

## Review the plan before using it

- Walk original requirements and applicable professional source sections, including selected designs and produced inputs. Map each mandatory outcome to a task's Behavior and Check; citing a whole document or output ID alone is not coverage. Check the reverse direction: task outcomes need an authorized source. Reference global constraints rather than copying them into each task. Keep omissions/unresolved inputs explicit; exclusions/deferments require authorization. Structural coverage cannot certify semantic completeness.
- Neighboring tasks agree on IDs, coordinates, units, types, resource paths, and interface names. No task assumes output that an earlier task does not produce.
- Each task has a meaningful completion check. Replace vague steps such as “handle edge cases” with the particular case and expected result.
- The plan is shorter than the work it guides. If it becomes a second set of eight documents or a transcript of code to type, consolidate it.

## BGS handoff

ReadDesignHandoff locates current documents and sections. ReadImplementationTask exposes an existing task index when present, otherwise the technical source; native reads cover other sources and pictures. No machine index, output mapping or finalize step is required for plain documents. Existing indexed projects can use the supplied --design help --details and finalize commands for metadata compatibility after authorized edits.

Before the implementation lock, update only affected tasks from produced designs, resources/frames and content; preserve still-valid work and task IDs. After locking, retain concise progress and result paths in the working conversation or an existing task list, not the technical document or another task database. A Todo tick is not a saved result; planning is not delivery. Required design changes follow current authorization.
