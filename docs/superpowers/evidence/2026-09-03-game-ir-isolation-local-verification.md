# Stable protected workflow local verification

Date: 2026-09-03 (UTC)
Branch: `codex/game-ir-isolation-recovery`
Baseline: `d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6`
Task: 4 — complete local protected-workflow gate

## Scope and preconditions

- The worktree has an owned, non-symlink `node_modules` directory.
- `bun install --frozen-lockfile` was previously run in this worktree; it completed successfully and did not change tracked Git status.
- No model call or Chrome call occurred.
- No production code, existing test, prompt, contract, or fixture was modified by this task.
- The gate stopped at the first test failure as required by the task brief. Stage 3, Stage 4, Checklist/shared-runtime, and broad regression suites were not run.

## Commands and results

### Step 1 — dependency and Git checks

Read-only checks confirmed:

```text
node_modules=worktree-local
## codex/game-ir-isolation-recovery
```

The directory is not a symlink. `git status --short` was empty before the gate and remained empty after the failed test command.

### Step 2 — static gates

```text
Command: bun scripts/game-ir-isolation-boundary.ts
Start: 2026-09-03T08:22:04Z
End:   2026-09-03T08:22:05Z
Exit:  0
Output: game-ir isolation boundary: PASS
```

```text
Command: bun run typecheck
Start: 2026-09-03T08:22:09Z
End:   2026-09-03T08:22:31Z
Exit:  0
Output: tsc --noEmit
```

```text
Command: git diff --check
Start: 2026-09-03T08:22:36Z
End:   2026-09-03T08:22:36Z
Exit:  0
```

### Step 3 — Stage 2 authoring tests (stopped at first failure)

```text
Command: bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-author-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts packages/agent-workflow-server/src/beegame/document-authoring-metrics.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/beegame/session-manager-runtime-errors.test.ts
Start: 2026-09-03T08:22:59Z
End:   2026-09-03T08:23:00Z
Exit:  1
Result: 123 tests; 117 pass; 6 fail; 769 expect() calls.
```

The six failures are all in `native-cli-process-runner.test.ts` and have the same exact error:

```text
ENOENT: no such file or directory, access '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/bee-game-studio/.worktrees/game-ir-isolation-recovery/dist/cli-bun.js'
```

Failed tests:

1. `never resumes a first native process with the BGS routing identity`
2. `resumes only an explicit native UUID`
3. `does not replace the native document author tool inventory`
4. `disables native tools only for a foundation Markdown stream turn`
5. `exposes only Read, Edit and the native terminal tool to a revision worker`
6. `disables built-in tools for a StructuredOutput workflow turn while retaining its JSON schema`

The preceding tests in the same command passed, including document validation, document boundary/display/contracts, authoring batch, Markdown streaming, authority projection, readiness, receipts, metrics, and session runtime-error coverage.

## Failure diagnosis

The failure is an environment/build prerequisite, not a protected-workflow source regression:

- `dist/cli-bun.js` is absent from the current worktree.
- `git ls-tree -r --name-only d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6 | rg '^dist/'` returned no entries, so the executable is not part of the protected baseline tree.
- The current and baseline `native-runtime-process-path.ts` both resolve the default native runtime to `dist/cli-bun.js` and call `accessSync`, so the observed error is unchanged behavior when the ignored build output has not been produced.
- No production or test file was changed in response; the gate is intentionally left blocked pending the missing local build prerequisite.

## Skips

Because the first Stage 2 test failure was reached, the following commands were not run: all remaining Stage 2 tests not included before the failure, all Stage 3 Reviewer tests, all Stage 4 Revision tests, Checklist/shared-runtime tests, and the broad baseline server regression. No model or Chrome call occurred.
