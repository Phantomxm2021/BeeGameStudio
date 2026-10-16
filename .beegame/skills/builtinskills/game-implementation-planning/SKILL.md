---
name: game-implementation-planning
description: Writing plans for multi-step game implementation from design and scene/UI content. 中文：依据文档和场景界面数据拆解实现任务。
---

# Game Implementation Planning

Use for a multi-step game implementation once the relevant design or feature requirements exist. A small localized fix can go straight to investigation and implementation. This is a working method for the Agent, not a new BeeGameStudio delivery phase.

## Establish the source of truth

1. For new game implementation, follow the project order: written design, selected actual UI/Scene/prop visual designs, corresponding resources, authored UI/Scene data, final implementation tasks, then code/runtime verification. Early technical notes may identify approach and risks; they do not replace those inputs or authorize early layout JSON. Reuse valid existing work for follow-ups. Read the user request and the relevant project documents. Inspect the actual content, resource references, code and tests that the implementation will consume, including manifests or Scene/UI indexes when the project uses them. Do not plan from a chat summary when the source files are available. In BGS, use handoff.mjs --design draft TECHNICAL_DESIGN.md to read available owner requirements even before that file exists. Available pointers are planning inputs, not proof that the baseline is valid.
2. Collect implementation outcomes from the original confirmed requirements, professional records, selected visual designs, actual Scene/UI data and corresponding resources/audio. Cover the current authorized scope, including planned actions, states and feedback; indexes alone can omit necessary work. Do not add content to fill a template or silently defer, drop or simplify confirmed outcomes.
3. Mark ownership boundaries. Preserve the project's actual content authority: selected JSON/YAML, engine scenes/assets or framework source. Do not duplicate an existing layout or move its decisions into another runtime copy; do not invent a separate BGS data layer for a native engine or DOM project.
4. Check that the inputs agree. If a required interface, asset ID, screen, or rule is missing or contradictory, name the exact source and gap. Correct the authoritative artifact if the task permits; otherwise identify the decision needed. Do not plan code around a known inconsistency.

## Decompose the implementation

Consolidate implementation tasks in the existing technical plan; professional records remain their design sources, not separate development backlogs. In BGS, finalize tasks in TECHNICAL_DESIGN.md and its existing implementationItems index after selected visual designs, corresponding resources and Scene/UI inputs exist. Map the owning files and actual cross-task interfaces before listing tasks. Share interface definitions once: producer/consumer, actual action or state names, inputs/outputs and consequential types/units. Reference existing definitions rather than inventing a general event framework or specifying every function.

Split by a result that can be implemented and checked: a reusable foundation or a player-visible behavior are both valid. Do not bundle all UI/gameplay into one task or split every function/field. Fold scaffolding into the task needing it. Order tasks by actual dependencies and name the outputs each consumer needs. A task need not launch a complete game independently; code checks can establish a foundation while visual/interaction completion needs integration observations.

For each task, record only what another implementer would otherwise have to guess:

```text
Task: <stable task ID and observable result, not “work on UI”>
Sources: <actual paths, clauses/sections, content/resource IDs and selected design pictures as applicable>
Files/interfaces: <owning code, consumed data and shared interface references>
Behavior: <trigger, state change and relevant failure/repeat/reset boundaries>
Check: <focused check or runtime observation, expected result and what it covers>
Depends on: <task IDs or existing capabilities, and actual outputs needed>
```

For example, “restart a run” consumes the restart rule, initial configuration and result-screen action binding, calls the shared new-run initialization and clears applicable old timers/listeners/callbacks. Its check observes restarting after an ended run and repeating that action without old-state effects. Name initialization and action-wiring dependencies. A shared Scene loader can be a separate foundation when several tasks need it; “create folders” is not an implementation outcome.

For a consequential audiovisual uncertainty, let the next useful slice expose the actual resource, scene/UI and action feedback together before duplicating that treatment across similar content. Inspect the uncertainty while it is still cheap to correct, not only after bulk implementation. Use the selected designs and corresponding prepared resources; this does not add a prototype/approval stage or replace final scope coverage.

Keep code and checks proportional. Use focused tests for deterministic rules and actual running views for visual/interactive results. One current integration result may cover several tasks; do not require a separate build/browser session/screenshot for each. State uncovered outcomes rather than mark them complete. Preserve the chosen engine and test tools; a contract, source location and observable check are enough without full function bodies.

## Review the plan before using it

- Compare the task set back to the original confirmed scope and all applicable selected inputs, not just registered output IDs. Every necessary behavior, screen/state, Scene, resource use and sound treatment needs an implementing task. Existing exclusions/deferments must trace to user authorization; unresolved inputs remain explicit gaps before use. Structural coverage cannot certify semantic completeness.
- Neighboring tasks agree on IDs, coordinates, units, types, resource paths, and interface names. No task assumes output that an earlier task does not produce.
- Each task has a meaningful completion check. Replace vague steps such as “handle edge cases” with the particular case and expected result.
- The plan is shorter than the work it guides. If it becomes a second set of eight documents or a transcript of code to type, consolidate it.

Keep early technical notes as drafts. Missing UI/Scene sources call for authoring those sources before final implementationItems; do not restart still-valid professional documents or treat a Todo tick as a saved result. After saving an owner document and index, explicitly use the existing handoff.mjs --design finalize DOCUMENT.md for host version metadata; do not add version headers by hand. Finalize does not certify design or runtime quality.

Keep the existing plan and index; do not create another delivery plan, checklist format or task database. In BGS, tasks point to concise technical-document sections and original owner requirements. Read them through the current handoff and native file tools. Once the design is finalized/locked, execution progress belongs in the existing execution task list with the same task IDs and result paths, not appended to the technical document. Required design changes follow current authorization; planning alone does not certify delivery.
