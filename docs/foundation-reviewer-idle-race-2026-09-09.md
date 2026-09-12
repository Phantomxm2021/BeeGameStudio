# Final Reviewer idle-exit race — 2026-09-09

## Scope and current result

The user requested analysis and a fix, then explicitly selected code-only verification: no service restart and no further paid model calls. All work in this follow-up is source changes, offline tests, and read-only inspection. No document, accepted result, attempt counter, execution lease, or workflow journal was rewritten.

The immediate blocker is a controller scheduling defect, not another Revision/candidate handoff rejection. The deployed process has not been restarted with this fix, and overall document acceptance remains unverified.

## Evidence from the actual run

- Workflow request `foundation:a1e928e5-0cf9-4753-bd78-f74632697429:6`, Reviewer handle `8cd1286d-ec9a-4f56-884d-6871fa7abf37`, stopped progressing at `2026-09-09T09:09:24.110Z` with `needs_action`, billing settled, and `resumable: true`.
- The displayed reason was only `Final whole-document consistency review is incomplete; candidate PASS is withheld.`
- Its full-review child journal is `e3bfc99274bc3db0c5ad9ef3f50a3874e994a286041501a746becaff110f1fb9`. Read-only replay shows all ten semantic source tasks completed: eight PASS, one ISSUES, one UNDECIDABLE. There is no lifecycle failure or occupied execution lease.
- Event 60 at `09:08:45.833Z` accepted semantic-9's UNDECIDABLE response and thereby created `semantic-9:confirmation`. That strong task is **pending, attempt 0, with no dispatch**. The next event seals usage; there is no confirmation claim. The semantic phase remains `semantic_review`, not `semantic_staged`.
- Read-only evaluation of the repaired idle policy returns runnable work and permits normal continuation of the same journal. It does not reset any completed task or retry budget.

## Root cause

`semantic-controller.ts` reads the journal asynchronously into a loop snapshot. A native worker can finish its terminal append after that snapshot was taken, enqueue a strong confirmation, and remove itself from the in-memory worker map. The loop then sees no pending task in its older snapshot and an empty worker map, and exits without reading the newly appended task.

This interleaving matches the durable state: all source receipts are accepted, the last receipt creates pending work, but the execution owner exits and seals billing. The lifecycle correctly refuses to publish PASS; its generic message obscures the scheduling failure.

`fact-controller.ts` had the same exit pattern, potentially losing a newly retryable fact task. `targeted-controller.ts` already re-read state at this boundary; that protection had not been applied to the shared full-review controllers. Existing strong-model tests commonly trigger confirmation from the first specialist, so later source work keeps the scheduler alive and does not reliably exercise the final-worker boundary.

## Fix

Both fact and semantic controllers now re-read the journal after observing an empty worker map and continue when that fresh state contains runnable pending/retryable work. A shared code-owned predicate preserves stopped, failed, blocked, and completed states; it cannot expand retry caps or turn an undecidable verdict into PASS.

Final-review status now distinguishes unstarted full review, explicit stop, lifecycle failure, blocked tasks, pending strong confirmations (including check ID), and a strong confirmation that still requires design clarification. It does not copy raw model output or exception text into the status message.

Regression coverage models the exact pre-terminal/post-terminal boundary, verifies only the new confirmation executes while all ten source receipts remain identical, detects a fact retry appearing after a stale snapshot, and checks stop/failure/undecidable guards. Existing lifecycle suites cover ownership, cleanup, billing, restart lookup, publication, and retry limits.

## Separate document findings — not overridden

The accepted semantic-7 source result identifies an audio/UI mismatch: the audio matrix permits mute-triggered cues in paused/frozen/end states where the UI state table does not list mute as available.

The semantic-9 source result identifies conflicting victory rules within GDD: “all third-wave enemies killed” versus “the final enemy killed with base health remaining.” These differ when an earlier third-wave enemy reaches the base without destroying it and the final enemy is killed. This is an accepted **UNDECIDABLE source result**, not a completed strong confirmation or a published final issue set. The pending independent confirmation must still run under normal authority. No gameplay choice, document edit, or PASS has been fabricated to remove this blocker.

## Verification

Final verification: **39 tests passed, zero failures, 216 assertions across five files**, plus TypeScript (`tsc --noEmit`) and `git diff --check`. The lifecycle/fact group passed 29 tests; the final semantic-controller group passed 10. Local fixture processes stand in for model workers; no paid provider was called.

The first test run exposed a test-fixture concurrency mistake (claiming all fact tasks simultaneously); the fixture was corrected to complete prior tasks sequentially before exercising the final retry boundary. This did not require a production-policy change.

Logs: `/private/tmp/reviewer-idle-race-lifecycle-tests.log`, `/private/tmp/reviewer-idle-race-final-semantic-tests.log`, and `/private/tmp/reviewer-idle-race-final-typecheck.log`. The live workflow remains at its original blocked state; deploying the fix and running the unstarted confirmation are intentionally deferred by the user's instruction.
