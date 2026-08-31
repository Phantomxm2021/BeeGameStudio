# Task 3 report — World/Scene schema and graph guards

## Status

DONE. Base was `ca2edea5` (Phase 5 Task 2 complete). This task only adds the
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

Sol's review found one authority gap and three multi-cause mutation tests. The
route descriptor now owns `references.targetKinds: ['world-scene.node']` plus
`unique`/`sorted` metadata; route reference validation reads that metadata,
and relationship target kinds remain manifest-derived. The redundant
`EXTERNAL_KINDS` and `WORLD_KINDS` tables were removed. External target maps
are only resolution input; every used edge/reference is still admitted solely
through manifest target kinds, so a supplied Balance target reaches the exact
wrong-kind guard rather than being reported as dangling.

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
the exact guard message. The parent-cycle test first proves a rich legal
baseline, then changes only two non-root parent edges so the root remains
valid, and asserts `parent hierarchy contains a cycle`. The forbidden-target
test first proves its baseline, supplies an actual `balance.variable` target,
changes only the spawn edge target kind, and asserts `role entity has wrong
target kind`. Route metadata was likewise first removed temporarily to record
an assertion RED (`references` was `undefined` and legal routes then failed),
then restored.

The corrected fix-round GREEN is:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts
→ 16 pass, 0 fail, 56 expect() calls
(cd packages/agent-workflow-server && bun run typecheck)
→ tsc --noEmit passed
Biome check on both Task 3 TypeScript files → passed
git diff --check → passed
```

## Boundary decisions / self-review

- Reused `GameIrNode`, `GameIrReference`, `GameIrRelationshipEdge`, and
  `compareCodeUnits` from Core; no second role/cardinality authority exists.
- Only the four explicitly allowed Phase 4 Gameplay target kinds can be
  referenced/admitted through the manifest. A supplied non-Gameplay target is
  merely resolution input so a used wrong-kind edge gets the precise manifest
  role error; Balance, Presentation, Resource, and Implementation facts never
  enter the parsed module.
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
