---
name: game-level-designer-expert
description: Use for gameplay spaces, traversal, encounters, level flow, mechanic teaching, and navigation readability. 中文：关卡设计、路线、遭遇、教学、空间布局。
---

# Game Level Designer

## 0. Overview

This skill focuses on **moment-to-moment gameplay experience**.

It optimizes spatial flow, tension rhythm, and player learning curves.

Use only the methods relevant to the current assignment. For an existing-level fix, inspect the affected route or encounter rather than redesigning the whole level or requiring a full design report. Follow the task's actual scope and responsibilities; a public example does not add mechanics, production stages or tool availability.

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

Avoid unintended or insufficiently communicated difficulty spikes that conflict with the intended experience. Deliberate escalation or surprise can be valid design choices.

Required actions and hazards should be legible enough for the intended fairness, even when the game deliberately uses surprise.

For authored traversal, compare geometry against the actual movement and collision rules: jump height and reach, gap width, ledges, one-way surfaces, enemy paths, camera visibility, and checkpoints where applicable. A static layout that cannot be traversed under the implemented rules is not ready merely because its document validates.

Choose 2D grid/tile placement, free-form scene objects, or 3D spatial layout according to the mechanic and available resources. Preserve gameplay scale and coordinate conventions instead of assuming a single camera or perspective.

BGS Scene retains objects/components and parent-local transforms; screen UI has a separate element tree/layout. Existing world-space Canvas/Image/Text can represent Scene labels and meters. Keep BGS units, top-left 2D coordinates and radians rather than importing Unity defaults. For overlapping Scene visuals, layer priority precedes node.zIndex; equal priorities retain source order. Check the chosen runtime's supported capabilities before treating static layout as rendering support.

---

## 5. Practical approach

For each planned level or reusable scene, relate its gameplay purpose, spatial arrangement, camera framing, entry/exit or completion path and relevant encounter/teaching beats to the actual player abilities and rules. Place the critical route and affordances, then check them against the documented movement and geometry. When a playable game exists and runtime verification is in scope, verify the relevant traversal or encounter there; otherwise state which observations remain unavailable.

Use a spatial representation suited to the task: a dimensioned description, grid, region graph or placement specification. Relate the intended route, challenge and pacing to that arrangement and the movement/obstacle rules. For new work, first record those spatial requirements in prose/sketches and work with art direction on actual Scene/prop visual designs. Inspect and link the selected pictures, then prepare corresponding resources. Only then author Scene JSON with those relationships, identities, logical sizes, collision geometry, Camera and actual resource bindings. Keep later corrections in that same linked source instead of translating a second map. Static connectivity does not establish runtime safety, traversal or pacing. Use a small route calculation or solver only for a consequential reachability or rule question it can actually answer; do not build a parallel game or universal simulator for routine planning.

For saved BGS Scenes, use `mcp__bgs-ui-layout__CheckSceneLayouts {}` for all saved Scene structure and static 2D Camera-reference checks. `{"detailsFor":"content/scenes/level.json"}` adds the selected source's parent/local/world/projected coordinates, Camera and unit context without narrowing checks. Use BGS file-editing tools to adjust the intended transforms, cells or Camera in the same source and recheck; no automatic Scene rearrangement is provided. Actual UI game-view framing uses CheckUiLayouts through the saved layoutCamera link. Missing bounds and 3D/XR geometry remain explicitly unverified. No Shell loops, report-file writes or JSON extraction are needed for these native calls.

For standalone diagnostics or when the native tool is unavailable, use the current supplied check-content entry with `--layout-draft workspace-relative-scene-file width height`, or `--camera-draft workspace-relative-camera-file width height` for framing only. Resolve its exact path from the active task's tools and read `--help`; do not guess a fixed delivery path or reuse an expired turn's adapter. Native engine/framework geometry uses its own actual representation and checks. Reuse the supplied contract or retrieve relevant fields together with `--format sceneDocument sceneVocabulary sceneVisibilityContract`; do not probe bundled implementation. Choose Scene data for a Scene question, not an invented UI allocation. Static XY inspection needs explicit visual size and scale; a collider does not prove visible sprite bounds. It does not establish occlusion, dynamic camera behavior, traversal, 3D visibility or XR comfort. Missing TileSet/resource bounds remain unverified and need the corresponding actual resource; guessed image sizes or extra calculation appendices do not close that gap. Draft inspection is not a reason to create Scene JSON before visual design.

Use the actual play-area allocation for camera framing, including host offset; BGS UI expresses this as game-view. Before UI's allocation exists, state visibility requirements and space needs rather than treating them as final. With linked Scene/UI inputs available, use the same Scene through layoutCamera and the shared calculator, including requiredVisibleNodeIds when applicable. Reconcile world scale and safe overlays; do not maintain another region-size or camera-offset table. Later resource binding must preserve logical geometry or identify a necessary owner revision. Different screen shapes can use different arrangements without changing gameplay scale or rules.

Keep the document focused on the resulting design and its reasons, not a long calculation transcript. Distinguish geometric distance, traversable distance and playtime assumptions; leave untested timing and game feel identified as such. Design-time calculations do not require implementing the game or building a new verification framework. Choose the method and representation freely; this is not a mandated file format or production stage.

## Reference Files

Read [spatial and teaching examples](references/encounter-design-patterns.md) when establishing a route, mechanic lesson or encounter. Its canal-crossing exercise connects player action, camera, environment resources and observation through explicit tradeoffs; use it for that reasoning question, not as a level template. Select the applicable example; combat escalation is not the default for puzzles or traversal.

For several connected activities, use the same reference's [two-room route exercise](references/encounter-design-patterns.md#worked-route-reasoning-two-rooms-and-a-return) to compare topology, information order, return travel and variation. A local geometry repair does not require reorganizing the whole level.
