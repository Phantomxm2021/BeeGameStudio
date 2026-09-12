# Foundation review convergence repair

## Scope

Implement the approved root-cause repair without starting paid workers, restarting the live service, or changing project artifacts. Preserve existing uncommitted changes. A safety stop is not a PASS.

## Implementation order

1. Introduce versioned, stable semantic obligations with explicit authority/dependency sections. Require complete per-obligation verdicts and evidence; a topic-level PASS alone must not satisfy the new policy. Preserve admission/replay of earlier policy receipts without silently upgrading them.
2. Bind findings to stable obligations and repair targets. Reconcile targeted versus final findings; classify repeated/conflicting judgments instead of laundering them into new issue identities. Do not discard legitimate regressions or infer equivalence from prose similarity.
3. Keep cross-document dependency closure in review/repair evidence. Verify the entire affected rule, not only the originally reported sentence. Do not grant Revision authority to edit unrelated sections.
4. Persist bounded orchestration progress. Stop with an actionable needs-action reason on exhausted rounds or repeated unchanged work; resume/poll/restart must not reset the guard or accidentally dispatch another repair.
5. Add negative, replay, regression, and lifecycle integration tests. Run targeted tests and the relevant foundation suites. Document what is proven offline and what still requires a separately authorized live acceptance run.

## Acceptance criteria

- Missing/duplicate/unknown obligation coverage cannot yield PASS under the new policy.
- Evidence must belong to the assigned frozen packet; obligations include authority and dependent views.
- Same semantic obligation/target retains a stable identity across candidate revisions.
- Conflicting judgments cannot silently create another automatic repair loop.
- Unresolved findings remain blocking; budget exhaustion never publishes candidate documents.
- Repeated polling and process reload preserve progress limits.
- No paid acceptance or live workflow mutation is performed by this implementation task.

## Status

Implementation and offline verification complete. No live service or paid worker was started.

## Implemented behavior

1. **Explicit rule coverage.** New journals use `complete-obligations.v2`. Ten specialists receive 32 service-owned obligations under `foundation-obligations.v1`, with explicit authority and dependent sections. Every obligation needs an outcome and exact quotations from its assigned evidence. Missing, duplicate, foreign, contradictory, or unbound receipts fail admission. All canonical document blocks are covered by at least one declared obligation. Production never synthesizes missing coverage.
2. **Stable findings and disagreements.** New semantic findings use `foundation-issue-basis.v2`. Their identity is the obligation plus the canonical repair-target set, independent of wording, selected source location, packet digest, and candidate bytes. Duplicate rule/target findings must be grouped by the worker. A whole-set finding that contradicts a targeted PASS stops for explicit adjudication, without publication or ordinary-resume redispatch. A different target remains a new blocking finding; no fuzzy prose equivalence is inferred.
3. **Complete read-only dependencies.** Published evidence, Revision packets, and targeted rechecks retain the obligation's authority/dependent sections and available related facts. Rebinding updates these references to the current candidate. The service validates the rule declaration and dependency closure. Additional evidence never becomes an editable section.
4. **Durable outer-loop limit.** The existing workflow sequence bounds automatic business repair rounds to six, including source-review resets. Repeated identical candidate documents stop before another review. Both stop reasons survive persistence, reload, ordinary resume, and repeated observation. Neither stop accepts candidate artifacts. No budget-renewal or automatic adjudication endpoint was added.
5. **Historical policy separation.** Recognized v1 journal receipts retain their original policy. Legacy initial summaries retain their original issue shape. Targeted summaries inherit their source policy; a fresh whole-set review records its actual policy. Already committed v1 final results can be reconstructed for read-only lookup using their historical IDs, without recreating or republishing that historical encoding. Legacy evidence is not presented as satisfying new obligation coverage.

## Verification

- Reviewer domain, admission, public handoff, publication, native-process, controller, billing, and restart tests.
- Revision complete suite, including independent public execution and cross-document read-only evidence.
- Workflow repair-budget, unchanged-candidate, reload/resume, public chain, and accepted-artifact tests.
- Package TypeScript check and `git diff --check`.

Final coverage: **668 unique test cases passed**, across partitioned suite runs and focused reruns after the last compatibility changes:

- Reviewer: 410 tests across 67 files. The full partitioned suite passed; the added legacy-lookup and rule-binding cases and affected publication/lifecycle tests also passed on rerun.
- Revision: 237 tests across 53 files, all passing in the final complete suite run.
- Workflow/publication boundary: 21 tests across 2 files, all passing.
- Final targeted lifecycle rerun: 9/9 passing, including disagreement, stop/resume, restart, and incomplete-publication recovery.
- `packages/agent-workflow-server`: `tsc --noEmit --pretty false` passed.
- `git diff --check` passed.

Earlier regression failures were corrected before this verification: obsolete source-only fixture expectations were updated to full dependency evidence; negative forgery tests still reach and assert their intended authority checks.

## Limits and rollout

- Exact quotation and explicit coverage establish provenance and checked scope, not the truth of an LLM judgment. This change does not promise a one-pass review or guaranteed semantic convergence.
- The six-round guard bounds outer business repair cycles. Existing stage-internal execution retry policies are not replaced by this guard.
- Existing journals are not silently migrated. A new audit must be created under the new policy to obtain the new coverage guarantees.
- A live restart, deployment, or paid acceptance run requires separate authorization. None was performed here; offline native fixtures use local processes and fake billing.
