---
name: game-plan-execution
description: Executing plans for game implementation in the same project session, verifying playable slices. 中文：执行游戏实现计划、逐步落地、运行验证。
---

# Game Plan Execution

Use when a project already has an implementation plan. Execute it in the existing project session. The plan captures prior decisions; source documents, observed behavior, and the user's latest instruction remain authoritative when they conflict.

## Start or resume

1. Read the plan and the source documents needed for the next unfinished task. Inspect the current files and tests before changing them; a previous run may already have implemented part of the task.
2. Compare the plan's completed items with actual code, tests, and version history. Resume from the first genuinely unfinished behavior, not from a remembered chat summary. If the plan has no usable progress record, note completion and evidence in that same plan or the project's existing task list; do not create a parallel ledger.
3. Check interfaces between dependent tasks before using them: IDs, data types, coordinate units, asset references, and exported functions. Resolve a mismatch against the authoritative content and design, then update the plan if its assumption was wrong.

## Execute one coherent slice

For each task:

1. Read its sources and define the expected observable result. If a requirement is underspecified, investigate the existing project conventions and make a reasoned decision within the task's scope; record a consequential deviation rather than silently inventing a new design.
2. Implement the behavior in the owning code or content. For scene/UI delivery, consume the project's actual authored sources and resources without a second layout copy. Use native engine or framework sources when those are authoritative; no separate BGS JSON is required.
3. Run the task's focused check and read the result. For deterministic code, use a test that distinguishes old and new behavior when practical. For visual or interactive behavior, inspect the running game at relevant viewports and input modes. Capture the actual observation, not just a command exit code.
4. If the check fails, decide whether the code, the test, or the plan is wrong. Trace the cause; do not repeat the same failed command without changing the relevant condition. Identify the responsible source and apply a correction only within the current task's editing scope, then rerun the affected check. If the source is outside that scope, report the evidence, impact and needed correction rather than changing it or working around it.
5. Mark the task complete only with its evidence. Record any remaining gap and proceed to the next dependency-ready task without seeking routine approval after every slice.

Keep narration and repeated source reading economical. Independent work may be delegated or parallelized when it truly has separate files and interfaces; neither per-task subagents nor per-task reviews are required. Stay in the same project session, and integrate delegated output before accepting it.

## Finish the implementation

Run the relevant integrated build and tests, then inspect a representative playable path including the actual scene/UI, resource consumption, controls, responsive layout, and the requested end condition. Compare the result with the plan and source requirements. A unit-test pass is not proof of a complete game. Report passed evidence and remaining gaps; use `evidence-before-completion` when making the final claim.

This Skill gives the Agent a repeatable execution loop. It does not require a new worktree, fixed task duration, mandatory commits, or BeeGameStudio intervention in task choices.
