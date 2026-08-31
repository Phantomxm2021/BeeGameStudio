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
- Derives each schema parser's local and allowed external target kinds directly
  from its domain manifest; filters only the temporary parser target maps while
  retaining complete Gameplay/Balance/World/Presentation projections for
  namespace checks and fidelity packets.
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
→ 40 pass, 0 fail, 218 expect() calls
```

Rounds 2–4 extend the legal-baseline-first matrix with independent Gameplay and
Balance mechanical/semantic receipt tampering, raw Map/digest-only/detached
Phase 4 branches, complete mixed task/revision/READY/compile/index identities,
source-level Section Index tamper, all six global ID pairs, precise dual-failure
ordering, source-bound schema-invalid and wrong-kind graphs and forbidden
targets, admitted
incomplete/PASS/FAIL/AMBIGUOUS fidelity, evidence crossover, and stale external
Gameplay→World and World→Presentation validation packets. The shared
`expectMutation` helper assembles a complete baseline before constructing each
mutation; ordering tests intentionally construct two failures after their
successful baseline. The ordering cases use distinct downstream failures:
Phase 4 receipt before World receipt/fidelity, World semantic receipt before
Presentation FAIL, World schema before Presentation fidelity, and World
fidelity before Presentation receipt. The Section Index mismatch test stops at the source
validator because its canonical digest is coupled to the Foundation compile
receipt; it does not claim an independent cross-index identity guard. No new
production change was needed in rounds 2–4. Altered output digest assertions
are mechanical recomputation checks; the assembler does not accept a closure
reader input. The root-fix RED used a fully admitted rich Gameplay/World
authority containing action/condition/effect/objective and route/spawn/encounter/
checkpoint/objective-placement kinds that downstream contracts do not reference;
the pre-fix closure failed on a forbidden temporary external target, while the
manifest-derived filter now accepts it. Existing forbidden and wrong-kind
negative cases still fail at their schema guards. This is the only production
change in the root-fix.

## Verification

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
→ 332 pass, 0 fail, 2 snapshots, 1873 expect() calls

bun run typecheck
→ tsc --noEmit passed

(cd packages/agent-workflow-server && bun run typecheck)
→ tsc --noEmit passed

./node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
→ 39 files checked, no errors

git diff --check 28830442..HEAD
→ passed
```

## Files

- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts`
- `.superpowers/sdd/2026-08-31-game-ir-world-presentation/task-8-report.md`
