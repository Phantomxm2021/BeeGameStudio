# Scene behaviour migration

`scene-mono-migration.ts` is a one-time, fail-closed conversion for the
pre-closed scene vocabulary. It is intentionally a data migration, not a
runtime compatibility layer.

## Current consumer evidence

The shipped Moonlight runtime currently reads `mono-behaviour` in
`src/game/model.ts` (`behaviourData`) and `src/game/render.ts`
(`horizontal-drift`). Therefore the migrated `node.data.behaviors` entries must
be consumed by the implementation stage/runtime before the old scene is
published. This repository does not invent a gameplay-logic document DSL for
that purpose.

## Mapping

| legacy script | migrated behavior | owner |
| --- | --- | --- |
| `horizontal-drift` | `motion.horizontal-drift` | visual node behavior |
| `vertical-bob` | `motion.vertical-bob` | visual node behavior |
| `bush-hide-zone` | `cover.bush` | gameplay node behavior |
| `tree-canopy` | `occlusion.tree-canopy` | gameplay node behavior |
| `decorative-only` | `collision.decorative` | gameplay node behavior |
| `letter-pickup` | `pickup.letter` | gameplay node behavior |
| `mailbox-delivery` | `objective.mailbox-delivery` | gameplay node behavior |
| `player-controller` | `actor.player-controller` | gameplay node behavior |
| `guard-ai` | `actor.guard-patrol` | gameplay node behavior |
| `guard-vision` | `sensing.guard-vision` | gameplay node behavior |
| `world-prompt-anchor` | `world-prompt.anchor` | presentation node behavior |
| `audio-director` | `director.audio` | audio node behavior |

Every migrated entry receives a stable ID and retains its complete authored
configuration under `config`. Unknown scripts abort the migration. No old
`mono-behaviour` component is emitted.

## Verified Moonlight inventory

The current `forest_night.json` contains 77 nodes, 152 components, and 37
legacy behaviours. The tool converts all 37 (12 script IDs), generates 115
stable component IDs, and discovers the undeclared audio cue resource
`RES-SFX-BANK`, which is added to `assetRefs` so the resource declaration is
closed. The migration does not infer ground contact from coordinates or
background art: structural validation owns coordinate semantics, while the
rendered-preview review owns art-dependent placement quality.

The camera receives the contract's logical-pixel metadata
(`coordinateSpace: "logical-pixels"`, `viewport: {width: 1280, height: 720}`,
`pixelsPerUnit: 100`, and `orthographicSize: 3.6`). `caught_fade` stops using a
1280×720 Transform scale and receives explicit `rect-transform` and
`canvas-renderer` components. Its Canvas ancestor also receives a
`rect-transform` component with full-screen layout (`anchorMin: [0,0]`,
`anchorMax: [1,1]`, `sizeDelta: [0,0]`).

## Running the migration

```text
bun packages/agent-workflow-server/src/beegame/scene-mono-migration-cli.ts \
  <legacy-scene.json> <migrated-scene.json> \
  --manifest <asset-manifest.json>
```

The CLI refuses to overwrite an existing output unless `--force` is supplied.
The source project is never modified implicitly.
