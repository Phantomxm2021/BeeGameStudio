---
name: game-level-designer-expert
description: Use for gameplay spaces, traversal, encounters, level flow, mechanic teaching, and navigation readability. 中文：关卡设计、路线、遭遇、教学、空间布局。
---

# Game Level Designer

Design spatial flow, tension and learning from the actual player abilities and rules. Scope a repair to the affected route or encounter; examples do not add mechanics or production requirements.

- Connect spatial choices to what players perceive, available actions/routes, pressure, discovery and recovery. Distinguish optional routes from order enforced by rules; reward locations alone do not enforce collection order.
- Make the critical route, affordances and focal points readable through a suitable dimensioned description, map or sketch. Use landmarks, sightlines, silhouette, density and quiet space deliberately. A small arena needs no extra regions or filler decoration; leave materials and palette to art direction.
- Fit teaching, encounter beats and difficulty to the audience and genre. Setup/escalation/peak/resolution can help an encounter, but neither combat peaks nor fixed early/mid/late lessons are universal. Communicate required actions and hazards sufficiently for the intended fairness.
- Check authored traversal against actual movement, collision, camera and checkpoint rules. Choose grid, free-form or 3D placement for the mechanic; preserve gameplay scale. Static connectivity or valid documents do not prove traversal, runtime safety or pacing.

For new work, record spatial requirements in prose/sketches, collaborate on actual visual designs, inspect selected pictures, retain their paths in existing implementation progress and author scenes in the chosen engine’s format from those designs. Use actual resources for bindings; preserve authored identities, logical sizes, collision geometry, Camera and resource bindings in the same source. Resource binding must preserve logical geometry or identify an owner revision.

Use actual UI play-area allocation, including host offset, for camera framing. Before allocation exists, state space/visibility needs as provisional. Linked BGS Scene/UI uses game-view and layoutCamera, with requiredVisibleNodeIds when applicable; reconcile world scale and overlays without another region-size or camera-offset table. Different screen arrangements must preserve gameplay rules and scale.

BGS Scene uses objects/components and parent-local transforms; screen UI uses a separate element tree/layout. When authoring or diagnosing saved Scene data, read [saved Scene layout checks](references/saved-scene-layouts.md) for coordinates, rendering limits and native checks; plain spatial prose does not need implementation details.

Use a small calculation only for a consequential reachability/rule question, not a parallel game or universal simulator. Keep design reasons and useful results, not calculation transcripts. Distinguish geometric distance, traversable distance and playtime assumptions. Verify affected traversal/encounters in the actual game when runtime verification is in scope; label unavailable observations and untested game feel.

Read the relevant [spatial/teaching example](references/encounter-design-patterns.md) for a route, lesson or encounter decision. The [canal crossing](references/encounter-design-patterns.md#worked-scene-reasoning-a-canal-crossing) connects action, camera and environment; the [two-room route](references/encounter-design-patterns.md#worked-route-reasoning-two-rooms-and-a-return) examines topology, information order and return travel. Their tradeoffs are examples, not level templates.
