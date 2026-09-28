---
name: game-implementation-planning
description: Writing plans for multi-step game implementation from design and scene/UI content. 中文：依据文档和场景界面数据拆解实现任务。
---

# Game Implementation Planning

Use for a multi-step game implementation once the relevant design or feature requirements exist. A small localized fix can go straight to investigation and implementation. This is a working method for the Agent, not a new BeeGameStudio delivery phase.

## Establish the source of truth

1. Read the user request and the relevant project documents. Inspect the real resource manifest, scene/UI index and documents, code, and tests that the implementation will consume. Do not plan from a chat summary when the source files are available.
2. List concrete outcomes: what the player can do, what the authored scene/UI data must show, and which devices or input modes matter. Keep the requested first release small; do not invent more levels, screens, or assets to fill a template.
3. Mark ownership boundaries. Authored JSON/YAML defines content, layout, IDs, transforms, and resource references; the selected game technology loads and interprets it. The plan must not silently move those authored decisions into hard-coded runtime layout.
4. Check that the inputs agree. If a required interface, asset ID, screen, or rule is missing or contradictory, name the exact source and gap. Correct the authoritative artifact if the task permits; otherwise identify the decision needed. Do not plan code around a known inconsistency.

## Decompose the implementation

Map the files and interfaces likely to change before listing tasks. Follow the project's existing structure. Split at a boundary where a behavior can be implemented and checked independently; fold scaffolding into the task that needs it. Order tasks by dependencies, not by a universal game-development checklist.

For each task, record only what another implementer would otherwise have to guess:

```text
Task: <observable result, not an activity such as “work on UI”>
Sources: <specific requirement and authored data files/IDs>
Files/interfaces: <existing or intended code files; input/output contract>
Behavior: <exact result, including relevant edge cases>
Check: <test command or playable/editor observation and expected outcome>
Depends on: <earlier task, if any>
```

For example, “render the first authored scene” can consume its scene document and atlas-frame references, produce a scene loader/renderer interface, and be checked by a frame-selection test plus an actual first-screen inspection. That is one useful slice. “Create folders” is not.

Keep code and checks proportional: deterministic gameplay or parser logic should have focused tests; visual composition, responsive UI, controls, and animation need a representative running view. Do not prescribe a test framework or engine that the project has not chosen. Avoid drafting full function bodies when a contract, file location, and observable check are enough.

## Review the plan before using it

- Every requirement in the relevant design/content sources has an implementing task, an explicitly deferred decision, or an explained out-of-scope status. A green build is not a substitute for playable coverage.
- Neighboring tasks agree on IDs, coordinates, units, types, resource paths, and interface names. No task assumes output that an earlier task does not produce.
- Each task has a meaningful completion check. Replace vague steps such as “handle edge cases” with the particular case and expected result.
- The plan is shorter than the work it guides. If it becomes a second set of eight documents or a transcript of code to type, consolidate it.

Save or update one plan in the project's normal working-doc location when a durable plan is useful. If one already exists, amend it rather than duplicating it. The Agent may revise the plan as evidence changes; planning alone does not certify delivery.
