# Task 3 Report: Project Foundation READY receipt

## Status

Complete. Commit: `3b1ba9ba` (`feat: project Foundation READY receipt`).

## Modifications

- Added `projectFoundationReadyReceipt(input)` in `game-ir/foundation-ready-adapter.ts`.
- Added adapter tests using parsed `audit_ready` and `revision_ready` Foundation states.
- The adapter parses the incoming Foundation state, accepts only `state`, `projectId`, and `confirmedBriefDigest`, requires an empty issue summary, verifies all eight canonical document digests, checks current Section Index and derived bindings, projects review authority for `audit_ready`, and projects committed publication authority for `revision_ready`.
- Revision authority document digests and publication revision/authority/Registry bindings are checked before receipt creation.
- Exported the existing contracts `receiptDigest` helper without changing its canonicalization or digest behavior, allowing the adapter to use the single canonical helper.
- No Foundation production files, controller, types, schema, recovery, or downstream Game IR files were modified.

## TDD and verification

- RED: the specified adapter test failed because `foundation-ready-adapter.ts` did not exist.
- GREEN: adapter + boundary tests pass (9 tests, 69 expectations, 0 failures).
- Full isolated Game IR contracts + adapter + boundary tests pass (16 tests, 113 expectations, 0 failures).
- `bunx tsc --noEmit -p packages/agent-workflow-server/tsconfig.json` — PASS.
- Biome check for adapter, adapter tests, and contracts — PASS.
- `git diff --check` — PASS.

## Concerns

The contracts helper required a minimal export-only change because it was previously private; its implementation is unchanged.

## Review fix round 1

- `audit_ready` now requires `derived.sectionIndexPath === state.sectionIndexPath` and projects the current state path.
- `revision_ready` now obtains the sole active bundle through `activeFoundationRevisionBundle` and requires publication `baseRevision` to equal both `roundBefore.documentRevision` and the active bundle `baseDocumentRevision`.
- Added parser-valid Section Index path tampering and parser-valid round-before/active-bundle lineage tampering negatives; each fails at the adapter's exact invariant.
- Verification: adapter + contracts + boundary tests pass (19 tests, 119 expectations); TypeScript, Biome, and `git diff --check` pass.
