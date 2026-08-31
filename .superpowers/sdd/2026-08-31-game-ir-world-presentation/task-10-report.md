# Task 10 report: branching/puzzle World + Presentation profile

## Delivered

Added the dedicated integration profile at
`packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-puzzle.integration.test.ts`.

The test owns a new eight-document READY authority with distinct puzzle source
bytes and no Task 9 imports or fixture helpers. It exercises:

- a rooted 2D lattice chamber plus an expanded echo chamber with shared hub
  waypoints, repeated visits on four routes, objective placements, triggered
  encounters, checkpoints, and camera regions;
- a multi-screen board/clue UI, action-driven glyph feedback, animation/VFX,
  spatial audio, music, and both solve and same-screen clue transitions;
- complete candidate-vs-closure node equality, owner bindings, eight-document
  source/index evidence, independently hardcoded packet and validation check-ID
  coverage, frozen output, deterministic replay, and explicit byte/projection
  digest equality for every assembled module;
- a no-cap expanded authority (30 World nodes and 25 Presentation nodes) plus
  factory re-signing of unrelated World/Presentation insertions while existing
  requirements, node order, and route derivations remain unchanged;
- baseline-first negative authorities for source bytes/ranges, mechanical
  ownership, typed literals, graph/numeric/UI/trigger/requirements, Phase 4
  identity, task identity, stale external projections, and forbidden resource
  targets.

The profile has no Resource/Delivery node and uses only public source, producer,
authority, validation, replay, and closure APIs.

## Verification

- Focused integration test: 8 pass, 0 fail, 1,015 assertions.
- Full Game IR suite: 340 pass, 0 fail, 4,003 assertions (2 snapshots).
- Root and package typechecks: passed.
- Biome check over `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir`: passed.
- `git diff --check`: passed.

## Assertion-level RED evidence

During fixture completion the expanded positive path first produced real
behavior RED: the second scene's root was rejected because its transform used
local rather than world space (`scene world.scene-echo root transform must use
world space`). After correcting that authority fact, exact count assertions
also exposed the actual expanded closure sizes (expected 28 vs received 30
World nodes, expected 24 vs received 25 Presentation nodes, and expected 10 vs
received 9 World node-kind nodes). The final assertions now encode those
observed counts; this was not an import or compile-only failure.
