# Task 2 report — foundation audit artifacts

## Result

Implemented post-authoring deterministic Section Index and Fact Store derivation. Derivation is gated on exactly eight canonical foundation documents with durable `committed` checkpoints, reads the committed Markdown locally, performs no model dispatch, and writes revision-bound artifacts beneath:

`.beegame/audit/foundation/<revision>/derived/`

The temporary unavailable cutover was replaced with one strict `foundationAuditState` binding the revision, all eight document digests, manifest digests, and project-relative artifact paths. Persisted workflow schema advanced from version 28 to 29. Recovery now validates the same state against the committed document and artifact bytes before preserving it. Review-copy remains a review-only copy operation and does not derive audit state.

## RED evidence

Before implementation:

```text
bun test .../foundation-section-index.test.ts .../foundation-fact-store.test.ts .../foundation-audit-artifacts.test.ts .../foundation-audit-state.test.ts
0 pass
4 fail
4 errors
Cannot find module './foundation-section-index'
Cannot find module './foundation-fact-store'
Cannot find module './foundation-audit-artifacts'
Cannot find module './foundation-audit-state'
```

The original implementation's review-copy hook was rejected because it synthesized committed checkpoints. Correction RED behavior was exercised against the rejected architecture: traversal revisions were accepted, incomplete artifact sets were eligible for overwrite, canonical unknown/missing section markers were not admitted against contracts, and recovery projection dropped a stored state. The pre-implementation RED also exercised missing modules:

```text
0 pass
4 fail
Cannot find module './foundation-section-index'
Cannot find module './foundation-fact-store'
Cannot find module './foundation-audit-artifacts'
Cannot find module './foundation-audit-state'
```

## GREEN evidence

- Focused Task 2 and correction tests: **20 pass, 0 fail**.
- Delivery-workflow suite: **54 pass, 0 fail**.
- Affected BeeGame server suite: **215 pass, 0 fail**.
- Restored recovery suite plus resource-entry boundary: **90 pass, 0 fail**.
- Review-copy and route tests: **6 pass, 0 fail**.
- Root `bun run typecheck`: exit 0.
- Targeted formatting check for all eight new source/test files: exit 0.
- `git diff --cached --check`: clean.

## Files

Created:

- `foundation-audit-artifacts.ts` and test
- `foundation-section-index.ts` and test
- `foundation-fact-store.ts` and test
- `foundation-audit-state.ts` and test

Modified as required for integration and recovery:

- `types.ts`, `schema.ts`, `controller.ts`
- temporary audit boundary and recovery projection paths
- recovery projection and focused cutover/recovery/schema-evolution tests
- review-copy tests reverted to the review-only behavior

Protected authoring files were not modified: `foundation-authoring-batch.ts`, `game-document-contracts.ts`, `document-stage.ts`, and the canonical Markdown contracts.

## Boundary checks

- No legacy reviewer/candidate/projection/synthesis/B-numbering references remain in production source scan.
- Review-copy retains its existing needs-action boundary and does not derive audit state.
- No model or worker dispatch is called by artifact derivation.
- Revision reuse with changed document bytes is rejected rather than overwriting a bound artifact set.

## Commit

Initial implementation: `8bf92fb7`.

Correction commit: report and implementation land together in the final fix commit; provenance is the range `8bf92fb7..HEAD` rather than a self-referential hash.
