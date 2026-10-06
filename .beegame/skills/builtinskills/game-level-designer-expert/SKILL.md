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
When planning a playable space, make the critical route and visual focal points clear through a dimensioned description, map or sketch as useful. Distinguish intentionally simple teaching space from an unfinished-looking world; decide how the environment frames gameplay without adding obstacles or decoration merely to fill cells.
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

Establish what the player can do, place the critical route and affordances, and check them against the documented movement rules and geometry. When a playable game exists and runtime verification is part of the task, verify a representative traversal or encounter there; otherwise identify what still needs runtime observation. For an existing-level fix, check the affected route rather than redesigning the entire level.

For each planned level or reusable scene, describe its gameplay purpose, spatial arrangement, camera framing, entry/exit or completion path, and relevant encounter/teaching beats. Tie those decisions to the actual abilities and rules; state what still needs runtime verification.

Use a spatial representation suited to the task: a dimensioned description, grid, region graph or placement specification. Relate the intended route, challenge and pacing to that arrangement and the movement/obstacle rules. Static connectivity does not establish runtime safety or playability. Formal Scene Content later realizes the placement and the actual game establishes traversal and pacing; document completion does not require a temporary scene or route simulator.

For a concrete consequential geometry uncertainty that needs resolution before production, the project-local calculator supports `bun .beegame/delivery/check-content.mjs --layout-draft workspace-relative-scene-file width height` with only the relevant geometry, or `--camera-draft workspace-relative-camera-file width height` for camera framing. Retrieve the actual relevant fields and vocabulary together with `--format sceneDocument sceneVocabulary sceneVisibilityContract`; do not filter the source with head/pipes or probe the bundled implementation. Reuse the retrieved contract. This is an optional focused calculation, not a required Scene deliverable; choose a Scene input for a Scene question, not an invented UI allocation before UI owns it. It does not establish 3D object visibility or XR comfort.

Use the selected game-view allocation for camera framing, including host offset. Before UI's allocation exists, state visibility requirements and space needs rather than treating them as final. Reconcile world scale and safe overlays with that decision. Formal Content connects authored Scene and UI through the shared calculator; only a concrete unresolved question warrants a smaller draft calculation. Do not maintain a second region-size or offset table. Different screen shapes can use different arrangements without changing gameplay scale or rules.

Keep the document focused on the resulting design and its reasons, not a long calculation transcript. Distinguish geometric distance, traversable distance and playtime assumptions; leave untested timing and game feel identified as such. Design-time calculations do not require implementing the game or building a new verification framework. Choose the method and representation freely; this is not a mandated file format or production stage.

Use only the relevant steps for the current request; prioritize player flow
without requiring a full level-design report for a focused fix.

## Reference Files

Load `references/encounter-design-patterns.md` when designing combat rhythm, safe zones, escalation, or tension spikes.
