# Stable workflow local verification — Task 4 failure evidence

Date: 2026-09-03 (UTC)  
Branch: `codex/game-ir-isolation-recovery`  
HEAD: `9d27dbe4a0bb570e8a6e6eb6b86003172da67df7`  
Baseline: `d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6`

This is failure evidence, not an acceptance receipt. No model or Chrome call occurred. No production code, existing test, prompt, contract, or fixture was changed. The gate stopped at the first substantive failure as required; broad regression was skipped.

## Gate results

| Command/group | Start (UTC) | End (UTC) | Exit | Tests | Assertions |
| --- | --- | --- | ---: | ---: | ---: |
| `bun run build:bun` | 2026-09-03T08:35:52Z | 2026-09-03T08:35:54Z | 0 | — | — |
| `bun scripts/game-ir-isolation-boundary.ts` | 2026-09-03T08:36:04Z | 2026-09-03T08:36:05Z | 0 | — | — |
| `bun run typecheck` | 2026-09-03T08:36:13Z | 2026-09-03T08:36:35Z | 0 | — | — |
| `git diff --check` | 2026-09-03T08:36:43Z | 2026-09-03T08:36:43Z | 0 | — | — |
| Stage 2 authoring (13 files) | 2026-09-03T08:37:07Z | 2026-09-03T08:37:07Z | 0 | 123 pass, 0 fail | 782 |
| Stage 3 Reviewer (19 files) | 2026-09-03T08:39:49Z | 2026-09-03T08:40:42Z | 0 | 205 pass, 0 fail | 1315 |
| Stage 4 Revision (7 files) | 2026-09-03T08:41:02Z | 2026-09-03T08:41:04Z | 0 | 97 pass, 0 fail | 278 |
| Checklist/shared-runtime (17 files) | 2026-09-03T08:41:52Z | 2026-09-03T08:41:58Z | 1 | 229 pass, 7 fail | 950 |

The Checklist/shared command was:

```text
bun test packages/agent-workflow-server/src/beegame/acceptance-checklist.test.ts packages/agent-workflow-server/src/beegame/checklist-authority-projection.test.ts packages/agent-workflow-server/src/beegame/checklist-candidate.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-display-message.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts packages/agent-workflow-server/src/beegame/runtime-observability.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-controller-resource-entry.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts packages/agent-workflow-server/src/__tests__/single-native-runtime-boundary.test.ts packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts
```

## Exact first failure output

The seven failures were:

```text
AtomicTaskPlanError: atomic task maps an unknown checklist item: CHECK-001
 code: "coverage"

      at assertCoverage (/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.ts:62:13)
      at validateAtomicTaskGraph (/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.ts:335:3)
      at buildAtomicTaskGraph (/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.ts:309:3)
      at applyAtomicTaskPlan (/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.ts:344:17)
      at handleTerminalUnlocked (/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts:1025:14)
      at async replayTerminal (/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts:1697:13)
      at async resumeUnlocked (/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts:1977:24)
(fail) delivery workflow recovery > atomic-task-planner keeps semantic dispatch count stable at terminal-accepted [56.25ms]
(fail) delivery workflow recovery > atomic-task-planner keeps semantic dispatch count stable at unit-accepted [52.91ms]

error: expect(received).toEqual(expected)

  [
-   "implementation-worker",
+   "atomic-task-planner",
  ]

      at /Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts:1767:62
(fail) delivery workflow recovery > implementation-worker keeps semantic dispatch count stable at before-dispatch [48.21ms]

error: expect(received).toBe(expected)

Expected: "implementation-worker"
Received: "atomic-task-planner"

      at /Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts:1780:45
(fail) delivery workflow recovery > implementation-worker keeps semantic dispatch count stable at open [48.28ms]

Expected: "implementation-worker"
Received: "atomic-task-planner"

      at /Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts:1780:45
(fail) delivery workflow recovery > implementation-worker keeps semantic dispatch count stable at terminal-accepted [44.76ms]

Expected: "implementation-worker"
Received: "atomic-task-planner"

      at /Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts:1780:45
(fail) delivery workflow recovery > implementation-worker keeps semantic dispatch count stable at unit-accepted [45.71ms]

(fail) workflow stage card history > freezes audit stage 3 before entering virtual revision stage 4 [0.43ms]

  7 tests failed:
  229 pass
  7 fail
  950 expect() calls
  Ran 236 tests across 17 files. [6.58s]
```

## Read-only baseline diagnosis

`git diff --stat d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6 --` for the failing test and production paths is empty; the current protected files are byte-identical to the admitted baseline. The failing behavior therefore reproduces in the restored baseline code, not in a Task 4 production edit.

- The two `atomic-task-planner` failures fail during `validateAtomicTaskGraph` because the recovery fixture supplies `CHECK-001`, which is absent from `facts.checklistIds`.
- The four `implementation-worker` failures observe `atomic-task-planner` as the resumed worker at the recovery boundary, rather than the fixture's expected implementation worker; these are the same recovery fixture path and occur before the expected worker checkpoint.
- The Stage 3/4 card-history failure is the independent `workflow-stage-card-history` assertion named above; no source file was edited or altered to investigate it.

No production or existing test changes were made in response. Stage 2, Stage 3, and Stage 4 were run; Stage 3 and Stage 4 passed. Checklist/shared-runtime failed, so broad server regression was skipped. No successful evidence commit was created.

## Final-gate rerun after admitted test-only corrections

The preceding seven-failure RED evidence is intentionally preserved. The correction commits changed only the two admitted test files recorded by the boundary manifest; no production source, prompt, or contract was changed.

Current rerun checkout: `2cc7f4c212c6d7e82019c850857a045d56cf2e69`.

Precondition: `node_modules` is a real worktree-local directory, not a symlink; `git status --short` was empty before the rerun.

Static gates (2026-09-03T09:08:00Z–2026-09-03T09:08:50Z): `bun scripts/game-ir-isolation-boundary.ts` exit 0 (`game-ir isolation boundary: PASS`); `bun run typecheck` exit 0 (`tsc --noEmit`); `git diff --check` exit 0.

Stage 2 authoring rerun: the existing 13-file command from the prior report completed with exit 0, 123 pass, 0 fail, 782 assertions.

Stage 3 Reviewer rerun was the first substantive failure:

```text
bun test [the same 19 protected foundation-audit/fact/semantic test files listed in the prior Task 4 report]
exit 1; 203 pass, 2 fail, 1309 assertions; 205 tests across 19 files; 52.59s
```

The failures were `claims document revision attempts durably beyond the former third-attempt cap` and `keeps unauthorized-section revision failure in the automatic retry loop`; both expected task status `running` but received `retryable`.

Read-only flakiness diagnosis: each failing test passed in isolation three consecutive times; the complete `foundation-fact-runtime.integration.test.ts` file passed serially (68 pass, 0 fail, 556 assertions), and the full Stage 3 set passed with `--max-concurrency 1` (205/205). The failure occurs only in the default multi-file run because the retry callback schedules `void resume` asynchronously and the test reads durable state immediately. This is a pre-existing baseline timing race, not a Task 4 source change. No other worktree process was terminated.

Per the brief, Stage 4, Checklist/shared-runtime, and broad regression were not run after the first substantive failure. No model or Chrome call occurred. This remains failure evidence, not an accepted local-gate receipt.
