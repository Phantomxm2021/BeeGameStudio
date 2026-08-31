# Task 3 report — World/Scene schema and graph guards

## Status

DONE. The original base was `ca2edea5` (Phase 5 Task 2 complete); this fix
round is based on `ba39d91c` (round 1). This task only adds the
World/Scene schema and its tests; no Reviewer, Revision, Foundation,
provider, route, persistence, or other production behavior was changed.

## Implemented

- Added the single `WORLD_SCENE_DOMAIN_MANIFEST` authority with exactly the
  ten approved World/Scene kinds, strict value fields, typed target kinds, and
  conditional volume/trigger cardinality metadata.
- Added `parseWorldSceneModule` with immutable normalized output, exact closed
  values, finite/positive/safe numeric guards, 2D/3D convention and transform
  validation, all six zone geometries, typed external Gameplay targets,
  hierarchy/scene closure, route reference/index validation, encounter,
  checkpoint, camera, objective, duplicate-edge, and cross-scene guards.
- Repeated route indexes are accepted as traversal revisits and never become
  synthetic graph edges. No fixed scene/node/route limit is imposed.

## TDD evidence

### RED

After API wiring (exported types, empty manifest, and throwing parser), ran:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts
```

Assertion-level RED was observed: the manifest assertion expected 10 keys but
received 0, and the minimal-scene behavior assertion received
`invalid World/Scene module: parser not implemented`. The zero-quaternion /
non-positive-scale assertion passed because the stub throws for those inputs;
that was not treated as behavior coverage for the eventual guards.

### GREEN

After implementation, the same focused command passed:

```text
16 pass
0 fail
50 expect() calls
Ran 16 tests across 1 file.
```

Coverage includes all ten kinds, every geometry, 2D/3D conventions and axis
rules, transform/quaternion/scale/finite boundaries, exact values, root and
hierarchy closure, cycles/orphans/cross-scene edges, route repeats and index
usage, all encounter modes, numeric boundaries, camera anchor typing,
objective/checkpoint closure, duplicate edges, dangling targets, and forbidden
Balance targets.

## Verification

- `(cd packages/agent-workflow-server && bun run typecheck)` — passed.
- `./node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts` — passed.
- `git diff --check` — passed.

## Fix round 1 audit corrections

Sol's round 1 review found one authority gap and three multi-cause mutation
tests. Round 1 moved route `targetKinds`, `unique`, and `sorted` into manifest
metadata and removed the redundant `EXTERNAL_KINDS` and `WORLD_KINDS` tables,
but it did not yet close the route index/coverage metadata or the strict
local/external boundary. Its cycle and Balance tests also still changed more
than one causal input, so round 1 was not treated as final evidence.

The original pre-implementation zero-quaternion RED above was not valid
behavior evidence: the throwing parser made that assertion pass for the wrong
reason. It is retained as historical wiring evidence only. For correction, a
temporary local reversal of the quaternion guard (`norm <= 0` → `norm < 0`)
was run against the legal-3D-baseline single mutation:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts -t "rejects a zero quaternion"
→ assertion RED: expected "rotation quaternion must be non-zero", received no throw
```

The guard was restored immediately. The corrected test now first proves the
legal 3D baseline parses, changes only the quaternion to all zero, and asserts
the exact guard message. The round 1 cycle test still changed two parent edges
and the Balance test changed both the edge and external target; those are
explicitly corrected below. Route metadata was likewise first removed
temporarily to record an assertion RED (`references` was `undefined` and legal
routes then failed), then restored.

The corrected fix-round GREEN is:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts
→ 16 pass, 0 fail, 56 expect() calls (round 1 snapshot)
(cd packages/agent-workflow-server && bun run typecheck)
→ tsc --noEmit passed
Biome check on both Task 3 TypeScript files → passed
git diff --check → passed
```

### Fix round 2 evidence

Before implementing the round 2 changes, the newly wired assertions were run
against the round 1 implementation (assertion-level RED, with no compile or
import failure involved):

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts -t "exposes the closed ten-kind manifest|external World targets|malformed external kinds|forbidden external kind"
→ 4 fail: route metadata lacked minTraversalLength/requireAllReferences;
  an external World target was accepted; malformed kind leaked
  `node.kind.startsWith is not a function`; Balance reached the edge
  wrong-kind guard instead of the forbidden external-kind guard.
```

Round 2 then made `validateReferences` consume the current kind's complete
reference metadata, including route traversal minimum and coverage policy. The
allowed external set is now derived from all manifest relationship/reference
target kinds minus `NODE_KINDS`; there is no prefix heuristic. External maps
reject local World kinds, malformed kinds, and non-manifest kinds before graph
resolution, while local World targets are resolved only from local nodes.
The cycle regression now has a legal root-plus-two-non-root baseline and
changes only one parent target to form the two-node cycle. The Gameplay
regression keeps the legal external entity ID and edge unchanged and changes
only that target node's kind to `balance.variable`.

After implementation, the focused suite passed:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts
→ 19 pass, 0 fail, 60 expect() calls
(cd packages/agent-workflow-server && bun run typecheck)
→ tsc --noEmit passed
Biome check on both Task 3 TypeScript files → passed
git diff --check → passed
```

## Commit

The three files in this report are intended to ship together as one
independent reviewable commit (`fix: enforce world scene target boundaries`);
the final commit hash is returned in the handoff.

## Boundary decisions / self-review

- Reused `GameIrNode`, `GameIrReference`, `GameIrRelationshipEdge`, and
  `compareCodeUnits` from Core; no second role/cardinality authority exists.
- External target kinds are derived from the manifest and the local
  `NODE_KINDS` set. The four Gameplay kinds admitted by this manifest are
  accepted; local World kinds supplied through `externalTargets` and
  non-manifest kinds such as Balance are rejected with controlled schema
  errors. World targets are always resolved from the local module node map.
- Transform `space` remains the closed `local | world` value; the parser
  requires world space for scene roots and leaves source-supported non-root
  choices to the source-bound admission layer because this API has no separate
  source-support marker.
- No full repository test suite was run; the requested focused suite, server
  typecheck, Biome checks, and diff check are green.

## Files

- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts`
- `.superpowers/sdd/2026-08-31-game-ir-world-presentation/task-3-report.md`
