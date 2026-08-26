# Task 1 report: authority and authoring contract

## Changes

- Extended the shared `GameDocumentOutputPolicy` with explicit rules for an `authority_index` Executive Summary, `derived_compact_views` Production Materials, owner-only references, and the single-owner/no-copied-totals mutable-fact policy.
- Updated the shared Foundation author instruction so every author treats the Executive Summary as an index and Production Materials as derived owner-referenced views without independently maintained mutable facts or totals.
- Made the parallel-draft upstream instruction conditional: a present upstream path must be used as committed authority and cannot be described as unavailable; the unavailable-assumption instruction remains only for an actually absent path.
- Added the corresponding authority rules to `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`.
- Added focused contract and prompt tests for all of the above and updated the existing output-policy expectation.

## TDD evidence

RED (before implementation):

```text
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
18 pass
3 fail
415 expect() calls
```

The three failures were the missing output-policy fields/value and the two absent author-prompt rules, confirming the tests failed for the intended missing behavior.

GREEN (after the minimal implementation):

```text
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
21 pass
0 fail
425 expect() calls
```

Additional verification:

```text
/Users/nswell/.bun/bin/bun run typecheck   # tsc --noEmit; passed
git diff --check                            # passed with no output
```

## Self-review

- The policy is defined once and shared by every Foundation document; no document-specific keyword rules were added.
- Prompt behavior is shared across initial and parallel Foundation authors; only the existing upstream-path branch is conditional.
- No compatibility field, second audit/revision flow, fixed business limit, or UI change was introduced.
- The authority wording keeps mutable facts owned by canonical sections and makes summary/material content referential rather than independently authoritative.

## Concerns

None identified for Task 1. The new output-policy literals are intentionally part of the shared contract surface and should be consumed by later derived-block work.
