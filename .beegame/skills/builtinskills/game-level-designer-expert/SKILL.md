---
name: game-level-designer-expert
description: Use for gameplay spaces, traversal, encounters, level flow, mechanic teaching, and navigation readability. 中文：关卡设计、路线、遭遇、教学、空间布局。
---

# Game Level Designer

## 0. Overview

This skill focuses on **moment-to-moment gameplay experience**.

It optimizes spatial flow, tension rhythm, and player learning curves.

---

## 1. Spatial Flow Design

Design a space that produces the intended player experience, rather than attaching pacing labels to a map. Connect important decisions to their spatial causes: what the player can perceive, which routes or actions are available, what creates pressure, and where recovery or discovery happens. Distinguish an optional route from an order enforced by access or game rules; rewards placed in different regions do not by themselves guarantee collection order.

Use quiet space deliberately for orientation, contrast, exploration, or recovery rather than treating every gap as wasted space.
When planning a playable space, show the critical route and visual focal points in a small map, blockout or scene sketch before final placement. Distinguish intentionally simple teaching space from an unfinished-looking world; decide how the environment frames gameplay without adding obstacles or decoration merely to fill cells.
Give the space a readable identity through landmarks, silhouette, density, sightlines or contrasts appropriate to the game. Explain their navigational and compositional role; leave final materials, palette and asset treatment to art direction. A small arena need not acquire extra regions or decorative systems to achieve this.

---

## 2. Encounter Structuring

For an encounter-design task, consider:

- Setup
- Escalation
- Peak
- Resolution

Choose pacing to fit the genre; a contemplative or puzzle level need not have a combat-style peak.

---

## 3. Teaching & Skill Expression

When a game has a learning progression, introduce, combine, and test mechanics at a pace that fits its audience and structure. A short or non-linear game need not follow fixed early/mid/late stages.

---

## 4. Difficulty Curve

Avoid sudden spikes.

Required actions and hazards should be legible enough for the intended fairness, even when the game deliberately uses surprise.

For authored traversal, compare geometry against the actual movement and collision rules: jump height and reach, gap width, ledges, one-way surfaces, enemy paths, camera visibility, and checkpoints where applicable. A static layout that cannot be traversed under the implemented rules is not ready merely because its document validates.

Choose 2D grid/tile placement, free-form scene objects, or 3D spatial layout according to the mechanic and available resources. Preserve gameplay scale and coordinate conventions instead of assuming a single camera or perspective.

---

## 5. Practical approach

Establish what the player can do, place the critical route and affordances, then verify one representative traversal or encounter in the playable game. For an existing-level fix, check the affected route rather than redesigning the entire level.

For LEVEL_SCENE_DESIGN.md, describe every planned level or reusable scene's gameplay purpose, spatial arrangement, camera framing, entry/exit or completion path, and relevant encounter/teaching beats. Tie those decisions to the GDD's actual abilities and rules; state what still needs runtime verification.

Work from a concrete spatial representation: a grid, dimensioned blockout, region graph or placement specification suited to the game. Develop the playable arrangement there, then describe the experience it actually supports. For exact layouts, use the available computation tools to derive placements, counts and routes from that same representation; a small script or geometric calculation is often enough. Inspect the result before describing a route as open, a space as safe or a sequence as inevitable. Account for the relevant movement and obstacle rules: static connectivity alone does not establish safety or playability. Revise the arrangement when it does not support the intended experience, instead of preserving the design claim in prose.

For BGS Scene planning, content work and review/revision, use the project-local spatial calculator: `bun .beegame/delivery/check-content.mjs --layout-draft workspace-relative-scene-file width height` for a temporary `scene-2d` document. Read `.beegame/delivery/content-format.json` for the actual fields and coordinate units; no resource Manifest or content index is required. For orthographic or perspective camera framing, `--camera-draft workspace-relative-camera-file width height` takes the camera fields directly. It calculates framing, not 3D object visibility or XR comfort. Do not search host source or claim those untested properties from a framing result.

Use UI_UX_SPEC's selected game-view region as the camera viewport, not independently the full host window; retain its host offset. A full-host UI draft can supply it directly with `--layout-draft ui-file host-width host-height --game-view node-id --camera camera-file`, using the same project calculator. Do not independently maintain a second region-size table. Before UI is drafted, state gameplay visibility requirements and provisional space needs, then reconcile them when UI allocation is established. UI owns layout selection and screen allocation; Scene owns world coordinates, framing and safe overlay regions across gameplay states; technical design explains consumption and references these inputs/results, not another rectangle/offset table. Different screen shapes may use different UI arrangements without changing world scale or gameplay rules. Record the input reference and concise computed result with the design rather than adding a self-review report or a dedicated checker.

Keep the document focused on the resulting design and its reasons, not a long calculation transcript. Distinguish geometric distance, traversable distance and playtime assumptions; leave untested timing and game feel identified as such. Design-time calculations do not require implementing the game or building a new verification framework. Choose the method and representation freely; this is not a mandated file format or production stage.

Use only the relevant steps for the current request; prioritize player flow
without requiring a full level-design report for a focused fix.

## Reference Files

Load `references/encounter-design-patterns.md` when designing combat rhythm, safe zones, escalation, or tension spikes.
