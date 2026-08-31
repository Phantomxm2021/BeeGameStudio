# Task 6 report — World/Scene producer wrapper (fix round 1)

## Status

DONE (fix round 1/5). Task 6 is limited to the World/Scene producer wrapper,
its focused assertion-level tests, and this report. No schema, closure, route,
store, provider, Reviewer, Revision, publication, or Phase 7 code was changed.

## RED / GREEN

The focused test was first run before the producer module existed:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts
→ Cannot find module './world-scene-producer'
```

After API wiring with a throwing stub, the focused assertions failed because
the packet/result behavior was not implemented:

```text
→ 4 fail, 1 pass; World/Scene semantic producer is not implemented
```

The minimal wrapper then turned the same assertions GREEN:

```text
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts
→ 7 pass, 0 fail, 33 expect() calls
```

The audit fix added a single-cause RED proving that a packet accessor is
rejected by the shared exact-key boundary before any World wrapper narrowing:

```text
→ 1 fail; received "raw packet read" instead of the shared admission error
```

After deleting the bespoke raw-packet pre-validation, it turned GREEN. Stale
packet digest and recomputed-digest relabel cases are now independent: the
former hits the shared stale digest guard, while the latter passes shared
structural admission and is rejected only by the wrapper's World identity
narrowing.

## Implementation

- `buildWorldSceneSemanticPacket` derives all node kinds and relationship roles
  from `WORLD_SCENE_DOMAIN_MANIFEST` and delegates packet construction to
  `buildGameIrDomainSemanticPacket`.
- `admitWorldSceneSemanticResult` calls `admitPhase5SemanticResult` first and
  only narrows the admitted result to World/Scene afterward.
- No claim parser, UTF-8 decoder, receipt digest, binding loop, Core parser,
  module merge, projection writer, or fallback was added.
- Tests cover the exact GDD/Level source closure, empty mechanical policy,
  manifest-derived kinds/roles, all ten World kinds, independent stale and
  relabel cases, raw accessor ordering, missing/ambiguous diagnostics and
  binding-evidence crossover, a complete 256-node admission/replay, and
  shared replay coverage for transforms, geometry, route indexes,
  references, edges, UTF-8 ranges, and edge-role tampering with complete
  owner-binding identity assertions.

## Verification

```text
bun test .../world-scene-producer.test.ts .../phase5-admission.test.ts
→ 36 pass, 0 fail, 198 expect() calls
(cd packages/agent-workflow-server && bun run typecheck)
→ tsc --noEmit passed
Biome check on both Task 6 TypeScript files
→ passed
git diff --check
→ passed
```

Task 7 was not started.
