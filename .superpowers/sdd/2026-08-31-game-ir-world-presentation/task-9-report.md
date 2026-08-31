# Task 9 report: traversal World + Presentation profile

## Delivered

Rebuilt the dedicated integration test at `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-traversal.integration.test.ts` against rootfix `475ca065`.

The fixture is independent of the smaller Task 8 fixture and builds one eight-document READY authority, exact Section Index bytes, UTF-8 source ranges, source claims, Phase 4 replay, World/Scene graph, and Presentation graph. It covers:

- two rooted scenes with 2D and 3D transforms and zones;
- hierarchical scene nodes, player/enemy instances, routes, wave/repeat spawns, triggered/patrol encounters, checkpoint, and camera region;
- Gameplay condition/capability/effect/action/objective/outcomes plus entity/event/state;
- HUD/menu states, a real UI action invoking `gameplay.action`, an action-triggered transition, feedback, animation clip/state, VFX, spatial audio, music, and six exact requirements;
- exact node ordering, relationship target kinds, route waypoint indexes, requirement projections, owner bindings, projection digests, frozen output, and byte-identical replay;
- source bytes/ranges, mechanical ownership arrays, typed literals, World graph/numeric values, Presentation UI/trigger/requirement values, raw Phase 4 authority, task identity, and forbidden-target mutation rejection;
- packet-derived exact `requiredTargets`, validation `coveredTargets`, and manifest-owned `checkIds` checked independently;
- a profile factory that re-signs the complete source/index/semantic/fidelity authority for Gameplay, World, or Presentation node overrides, so schema mutations reach the domain parser and stale external validation is exercised against a legal upstream change.
- full canonical `{id, kind, value, references, edges}` equality from every original candidate node to the final Phase 4, World, and Presentation closure modules;
- exact error-instance/message assertions for every negative case, with all mutated authorities constructed before invoking the assembler.

There is one authority/profile path: all rich nodes are admitted into the authority and are assembled through `assembleWorldPresentationClosure`. No detached schema-only parser fixture, detached Gameplay action target, or empty-binding cast is used.

## Verification

- Focused integration test: 3 passed, 1,217 assertions.
- Full Game IR suite: 332 passed, 0 failed, 2,987 assertions.
- Root `bun run typecheck`: passed.
- `packages/agent-workflow-server` `bun run typecheck`: passed.
- Biome check over `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir`: passed.
- `git diff --check`: passed.

## RED/GREEN evidence

Before the fixture was corrected, the first exact action/objective closure expectation reached RED with the pre-filter assembler error `external target action.extract kind is forbidden by the World manifest`. Rootfix `475ca065` added manifest-derived external target filtering; the rebuilt rich authority then reached GREEN through the sole assembler, including objective placement and action-triggered Presentation transition. During the round-2 rebuild, graph, numeric, trigger, UI input, requirement, and forbidden-target mutations were kept source-bound by the profile factory and reached their exact domain-schema errors; legal Gameplay and World resignings with stale downstream validation reached the exact fidelity packet-digest guard. Round3 added full candidate-view equality and exact `Error.message` checks while moving every mutation construction outside assertion callbacks.
