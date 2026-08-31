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
→ 30 pass, 0 fail, 170 expect() calls
```

Round 2 extends the legal-baseline-first matrix with independent Gameplay and
Balance mechanical/semantic receipt tampering, raw Map/digest-only/detached
Phase 4 branches, complete mixed task/revision/READY/compile/index identities,
all six global ID pairs, precise dual-failure ordering, rebuilt wrong-kind and
forbidden-target graphs, admitted incomplete/PASS/FAIL/AMBIGUOUS fidelity,
evidence crossover, and stale external Gameplay→World and World→Presentation
validation packets. Every negative starts from a successful baseline and uses
one mutation except the explicitly labelled ordering double-fault tests. No
new production change was needed in round 2. Altered output digest assertions
are mechanical recomputation checks; the assembler does not accept a closure
reader input.

## Verification

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
→ 319 pass, 0 fail, 2 snapshots, 1722 expect() calls

bun run typecheck
→ tsc --noEmit passed

(cd packages/agent-workflow-server && bun run typecheck)
→ tsc --noEmit passed

./node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
→ 39 files checked, no errors

git diff --check 802f3a16..HEAD
→ passed
```

## Files

- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts`
- `.superpowers/sdd/2026-08-31-game-ir-world-presentation/task-8-report.md`
