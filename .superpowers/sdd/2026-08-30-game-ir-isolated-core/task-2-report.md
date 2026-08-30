# Task 2 Report: Define strict cross-stage DTOs

## Modifications

- Added `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.ts` with the four exact readonly DTO types, strict Zod schemas, parser functions, exclusive `review | revision_publication` authority union, canonical receipt digest verification with `receiptDigest` omitted, safe IDs/paths, SHA-256 validation, and deep freezing of parsed values.
- Added `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts` covering valid DTO shapes and every required rejection category.
- Extended `stage-boundary.test.ts` to verify the contracts seam imports the shared types only and does not import Foundation internals, controller, schema, or recovery.
- No Foundation production files, controller, schema, types, or recovery files were modified.

## TDD evidence

- RED: the specified Bun test command failed because `contracts.ts` did not exist; the new boundary check also failed with the expected missing-file error.
- GREEN: the same command passed after the minimal implementation (11 tests, 90 expectations, 0 failures).

## Verification

- `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts` — PASS (11 tests, 90 expectations, 0 failures).
- `bunx tsc --noEmit -p packages/agent-workflow-server/tsconfig.json` — PASS.
- `node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts` — PASS.
- `git diff --check` — PASS.

## Self-review

- Foundation ready receipts require all eight canonical document paths exactly once and reject unknown/missing paths.
- Authority variants are discriminated and strict, so mixed fields are rejected.
- Receipt digests are SHA-256 over recursively key-sorted canonical JSON without the `receiptDigest` field, preventing self-hashing.
- Task/publication IDs, relative artifact paths, digest values, source-binding ordering, and nested strict records are validated at the parser boundary.
- Parsed roots, nested objects, records, and arrays are frozen.

## Concerns

None.

## Review fix round 1

- Corrected the authority-mutant test to omit `receiptDigest` before recomputing the canonical digest, so the strict mutually exclusive union is the exercised failure.
- Corrected missing/extra canonical document digest mutants the same way, ensuring keyset validation is not masked by an unrelated stale receipt digest.
- Added fresh strict-schema negatives for unknown fields at the compile-request root, defect-report root, and defect-report target object.
- Added root `Object.isFrozen` assertions for `GameIrCompileRequest`, `FoundationDefectReport`, and `GameIrReadyReceipt`.

## Review-fix verification

- `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts` — PASS (11 tests, 96 expectations, 0 failures).
- `bunx tsc --noEmit -p packages/agent-workflow-server/tsconfig.json` — PASS.
- `node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts` — PASS.
- `git diff --check` — PASS.

## Review-fix self-review

- Every mutated Foundation receipt used to test authority/document-key strictness now carries a digest computed from the exact mutated payload with only `receiptDigest` omitted.
- The new unknown-field cases exercise their intended strict object level without relying on receipt digest behavior.
- Production contract implementation was not changed in this fix round.

## Review fix round 2

- Changed the mixed-authority strictness mutant to use `validFoundation` unchanged as its base and retain its original valid `receiptDigest`; only `baseRevision` and `authorityDigest` are added to the authority object.
- Changed the extra canonical document-path mutant to retain `validFoundation.receiptDigest` while adding only the extra path.
- Changed the Foundation receipt root unknown-field mutant to retain `validFoundation.receiptDigest` while adding only the root field.
- Kept the missing-document-key mutant on the isolated path: it removes the key and recomputes the digest after omitting `receiptDigest`.
- No production contract semantics were changed.

## Review-fix-round-2 verification

- `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts` — PASS (11 tests, 96 expectations, 0 failures).
- `bunx tsc --noEmit -p packages/agent-workflow-server/tsconfig.json` — PASS.
- `node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts` — PASS.
- `git diff --check` — PASS.
