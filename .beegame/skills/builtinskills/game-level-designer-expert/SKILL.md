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

For a level-layout task, consider the relevant parts of:

- Player entry point
- Safe zones
- Combat arenas
- Exit hooks

Use quiet space deliberately for orientation, contrast, exploration, or recovery rather than treating every gap as wasted space.
When planning a playable space, show the critical route and visual focal points in a small map, blockout or scene sketch before final placement. Distinguish intentionally simple teaching space from an unfinished-looking world; decide how the environment frames gameplay without adding obstacles or decoration merely to fill cells.

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

Use only the relevant steps for the current request; prioritize player flow
without requiring a full level-design report for a focused fix.

## Reference Files

Load `references/encounter-design-patterns.md` when designing combat rhythm, safe zones, escalation, or tension spikes.
