# Task 9 report: traversal World + Presentation profile

## Delivered

Added the dedicated integration test at `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-traversal.integration.test.ts`.

The fixture is independent of the smaller Task 8 fixture and builds its own eight-document READY authority, exact Section Index bytes, UTF-8 source ranges, source claims, Phase 4 replay, World/Scene graph, and Presentation graph. It covers:

- two rooted scenes with 2D and 3D transforms and zones;
- hierarchical scene nodes, player/enemy instances, routes, wave/repeat spawns, triggered/patrol encounters, checkpoint, and camera region;
- HUD/menu states and transition, UI action invocation, feedback, animation clip/state, VFX, spatial audio, music, and six exact requirements;
- exact node ordering, relationship target kinds, route waypoint indexes, requirement projections, owner bindings, projection digests, frozen output, and byte-identical replay;
- source, mechanical ownership, typed literal, transition, task identity, and forbidden-target mutation rejection.

The rich World and Presentation profiles are parsed directly through their public schema boundaries. The closure path uses `assembleWorldPresentationClosure` and its currently accepted external-target slice.

## Verification

- Focused integration test: 3 passed, 103 assertions.
- Full Game IR suite: 331 passed, 0 failed, 1,872 assertions.
- Root `bun run typecheck`: passed.
- `packages/agent-workflow-server` `bun run typecheck`: passed.
- Biome check over `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir`: passed.
- `git diff --check`: passed.

## Boundary requiring follow-up

The current sole assembler cannot carry the entire rich profile through its closure: it passes every Phase 4 Gameplay node to World, although World rejects external `gameplay.action`/condition/effect kinds; it then passes every World node to Presentation, although Presentation rejects external route/spawn/encounter/checkpoint/objective kinds. Consequently, this test does not silently widen production contracts or fake a closure. A minimal assembler target-map filtering change is required before the rich route/action profile can be asserted as the final assembled closure rather than as direct schema coverage plus the assembler-supported closure slice.
