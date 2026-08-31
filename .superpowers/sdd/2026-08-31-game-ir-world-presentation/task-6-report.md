# Task 6 report — World/Scene producer wrapper

## Status

DONE. Task 6 is limited to the World/Scene producer wrapper, its focused
assertion-level tests, and this report. No schema, closure, route, store,
provider, Reviewer, Revision, publication, or Phase 7 code was changed.

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

## Implementation

- `buildWorldSceneSemanticPacket` derives all node kinds and relationship roles
  from `WORLD_SCENE_DOMAIN_MANIFEST` and delegates packet construction to
  `buildGameIrDomainSemanticPacket`.
- `admitWorldSceneSemanticResult` enforces the World/Scene packet identity and
  exact manifest-derived allow-lists, then delegates structural admission to
  `admitPhase5SemanticResult`.
- No claim parser, UTF-8 decoder, receipt digest, binding loop, Core parser,
  module merge, projection writer, or fallback was added.
- Tests cover the exact GDD/Level source closure, empty mechanical policy,
  manifest-derived kinds/roles, all ten World kinds, stale/relabelled packets,
  missing/ambiguous diagnostics and evidence crossover, a graph beyond the
  ordinary size, and shared replay coverage for transforms, geometry, route
  indexes, references, edges, UTF-8 ranges, and edge-role tampering.

## Verification

```text
bun test .../world-scene-producer.test.ts .../phase5-admission.test.ts
→ 33 pass, 0 fail, 183 expect() calls
(cd packages/agent-workflow-server && bun run typecheck)
→ tsc --noEmit passed
Biome check on both Task 6 TypeScript files
→ passed
git diff --check
→ passed
```

Task 7 was not started.
