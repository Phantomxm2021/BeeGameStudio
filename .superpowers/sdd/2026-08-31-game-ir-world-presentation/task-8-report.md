# Task 8 report — sole World/Presentation closure assembler

## Implemented

- Added the sole `assembleWorldPresentationClosure` writer with the exact
  authority and closure DTOs from the approved Phase 5 contract.
- Validates the authority shape before dispatch, then always replays the raw
  Gameplay/Balance authority through `assembleGameplayBalanceModules`.
- Replays World/Scene source, mechanical receipt, semantic receipt, schema,
  and fidelity result in order; only an admitted `PASS` produces a frozen
  World projection.
- Replays Presentation against the freshly rebuilt Gameplay projection and
  freshly admitted World projection, then admits only an exact fidelity
  `PASS` and derives the frozen Presentation projection.
- Checks one task, Foundation revision, READY receipt, compile request, and
  complete authority Section Index identity across all four source envelopes;
  checks cross-module global ID disjointness and delegates typed graph rules
  to the existing schema boundaries.
- Projection and closure digests are service-derived and exclude only their
  own digest field. No candidate, publication, route, store, provider,
  fallback, detached projection authority, or future-stage code was added.

## TDD evidence

The original focused run preceded the assembler module and failed at module
resolution:

```text
bun test .../world-presentation-assembler.test.ts
→ Cannot find module './world-presentation-assembler'
```

That was a missing-module setup failure, not behavioral RED. In this fix round,
a complete legal Phase 4/World/Presentation baseline was built first. Two
assertion-level RED cases then proved that the assembler accepted a legal
World node relabeled to the real Balance node ID and a legal Presentation node
relabeled to that ID. The assembler now derives Balance IDs from the replayed
Phase 4 projection and rejects both collisions while retaining all other
Gameplay/World/Presentation pair checks.

After the exact authority-shape, ordering, digest, identity, freeze, and
namespace tests were added, the focused test passed:

```text
bun test .../world-presentation-assembler.test.ts
→ 10 pass, 0 fail, 128 expect() calls
```

## Verification

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
→ 299 pass, 0 fail, 2 snapshots, 1680 expect() calls

bun run typecheck
→ tsc --noEmit passed

(cd packages/agent-workflow-server && bun run typecheck)
→ tsc --noEmit passed

./node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
→ 39 files checked, no errors

git diff --check 5fd5a8a9..HEAD
→ passed
```

## Files

- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts`
- `.superpowers/sdd/2026-08-31-game-ir-world-presentation/task-8-report.md`
