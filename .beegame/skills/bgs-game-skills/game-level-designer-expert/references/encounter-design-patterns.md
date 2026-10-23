# Encounter Design Checks

An encounter can be combat, traversal, puzzle, stealth, conversation, or another meaningful player challenge. Identify its player goal, available actions, information, consequences, and recovery path. Setup, escalation, peak, and relief are useful pacing tools, not required phases.

Check that the player can perceive the needed affordances, perform the intended route under actual movement/physics rules, and understand success or failure. Use surprises, pressure, or quiet intentionally. For a focused encounter bug, verify that encounter rather than redesigning a whole campaign.

## Connect the lesson to space

| Task | Spatial arrangement worth considering | Failure to look for |
|---|---|---|
| Teach a traversal action | Let the player see the departure and landing, try the action with a suitable recovery path, then encounter a meaningful variation | The required landing is off-camera, or a first mistake prevents learning without an intended reason |
| Teach a puzzle rule | A small situation exposes one causal relationship; a later situation changes a relevant constraint | The solution works only under an undocumented action, or the explanation assumes that objects move differently from the actual rule |
| Build an encounter choice | Routes offer perceivable differences in exposure, access, effort or reward | Two routes are cosmetically different but play identically, or the supposedly optional route is required by the actual access constraints |

The examples are original design reasoning, not required sequential lessons or a combat template. A non-linear game may expose these relationships through exploration. Use a sketch, dimensions or a region graph to show the cause of the intended experience. For instance, `entry → visible decision → route A/B → shared goal` is a relationship, not proof that either route is traversable.

For reachability, use the real abilities, collision geometry and state-changing rules. A gap-width calculation can answer a narrow movement bound; a legal-action solver can answer a specific puzzle route. Neither proves camera readability, input usability or pacing. Record the assumption and supported conclusion rather than claiming the whole level is safe or optimal. Recompute when those inputs change; do not implement a second game just to create a design appendix.

As references, [SuperTux's level guide](https://github.com/SuperTux/supertux/wiki/Level-Design) connects hazards, theme and fairness to level placement, and the [Godot platformer demo](https://github.com/godotengine/godot-demo-projects/tree/master/2d/platformer) supplies an actual scene with movement, camera bounds and input. Inspect the part relevant to the current game; their mechanics, dimensions and number of encounters are not universal requirements.

## Worked scene reasoning: a canal crossing

Use this example when relating spatial play, camera presentation and environment identity, not for every placement or binding fix. It is an original hypothetical design exercise, not a tested game, reference screenshot or production template.

### Start from the player's decision

Assume the brief already calls for a short side-view traversal through a disused canal, with existing run/jump controls and retry after a fall. The intended moment is to read one gap, choose a takeoff and commit, then regain orientation on landing. Do not add enemies, collectibles, new movement abilities or checkpoints to make the example feel complete.

The useful relationship is `approach → takeoff | gap | landing → continuation`. This describes a player action, not measured geometry. Derive the approach, gap, landing height and clear landing/stopping space from the actual controller and collider. A theoretical maximum reach is not a target gap width: running start, air control, collision clearance and the intended execution demand matter. Where those inputs do not exist yet, retain a spatial hypothesis rather than inventing a safe distance or changing physics to fit the picture.

### Choose between plausible treatments

| Decision | Plausible choice and cost | Choice for this brief, with its condition |
| --- | --- | --- |
| Camera | A wide fixed view shows both sides together but can make the player and edges too small. A close follow view preserves scale but may reveal the landing too late or move it during judgment | Prefer a stable view of this one crossing if both sides and the character remain readable at supported sizes. Otherwise use an available follow policy that reveals the landing before commitment; do not invent a new camera system |
| Approach and landing | Equal slabs at equal intervals are economical and regular, but can make the intended jump indistinguishable from background repetition. Several competing gaps add decisions the brief did not request | Give this crossing a recognizable approach and a readable landing surface; retain quiet space around its action. Repetition may still suit a deliberately rhythmic game, so it is not inherently wrong |
| Focal subject | A large distant gate creates a strong destination image, but can take attention away from the immediate landing. A luminous landing marker is obvious but may introduce a new game-state signal | Make the landing's usable top edge distinct in silhouette/value; let an existing exit or architectural opening support direction at lower emphasis. A gate is a visual possibility, not a new interaction requirement |
| Environment identity | Unique detail on every block supplies variety but costs assets and competes with collision edges. Uniform blank blocks preserve geometry but may not convey the requested canal identity | Repeat a small stone/slab family, put joints and wear below the usable top edge, and use a recessed wall or waterline to suggest the canal. Choose only the details that clarify material, scale or place; no universal texture or palette prescription |
| Depth and motion | Foreground rails or reeds can add depth but hide takeoff/landing; animated water can enliven the scene but compete with the player | Keep critical silhouettes clear during this action; quieter distant detail can carry atmosphere. Parallax and water animation are optional, not completion requirements |

The deliberate choice is not "more detail" or "maximum contrast everywhere": it is an identifiable place with an uncluttered action and enough context to judge distance. This is a design hypothesis. A deliberately disorienting or blind-jump game would need different choices and fairness expectations.

### Carry the relationships into the actual source

Author the same approach, collision edges, landing and camera relationships in the project's existing scene representation. Keep collision geometry distinct from decorative overhangs, sprite transparency and shadows: the visible support should communicate the real usable surface. Record logical size, pivots and layer relationships for the selected resource family so replacement art does not float above the collider, cover the gap or turn decoration into an apparent platform. Reuse available modules before commissioning variants; inspect a join or corner only when that assembly is uncertain.

Check camera framing in the UI's actual play-area allocation. If a compact host cannot show the crossing while retaining required readability, choose an allowed camera/layout adaptation or reconcile an authorized spatial revision; do not silently rescale the world or shrink the character. A moving camera needs actual displayed framing, not merely its authored initial position. Material/palette and runtime implementation remain with their actual owners; this exercise does not override approved art or add unsupported Scene fields.

### Observe the moment, not just its cover image

For an authorized runnable task, use existing preview/input/capture tools on the actual scene. Select the observations relevant to the uncertainty:

- **Approach:** can the intended departure and landing be seen before the player must commit, without the silhouette merging into the background? This checks an opportunity to perceive; it does not prove a new player understood it.
- **Flight and landing:** does the camera retain useful destination information, and does contact agree with the depicted usable edge? Check the action at normal speed, not just a paused frame with an attractive composition.
- **Failure/retry:** does the existing recovery restore the intended player and camera situation without stale offsets or obscuring effects? Inspect continued play after recovery, not only a reset counter.

If the landing appears too late, distinguish camera delay from placement or occlusion before editing. If the environment feels anonymous, examine one coherent material/shape treatment in the same play view rather than filling every quiet area. If art and collision disagree, correct the owning input or adapter instead of shifting unrelated geometry to hide it. Preserve valid requirements and change the affected relationship only. Successful execution establishes the observed behavior; understanding and visual appeal remain separate judgments, with missing observations disclosed.

### Method sources and limits

The [Level Design Book's metrics guidance](https://book.leveldesignbook.com/process/blockout/metrics) informs relating space to actual player capabilities. Its [composition discussion](https://book.leveldesignbook.com/process/blockout/massing/composition) distinguishes spatial organization from a selected camera image; its stronger positions are not universal aesthetic rules. [Godot's Camera2D documentation](https://docs.godotengine.org/en/stable/classes/class_camera2d.html) illustrates why smoothing/limits can make actual screen position differ from a node's position; use the installed engine/version's equivalent when applicable. These sources support the reasoning method, not the untested canal design or fixed dimensions, timings and asset counts.

## Worked route reasoning: two rooms and a return

Use for organizing several connected activities rather than fixing one collision edge. This is an original hypothetical exercise: the brief already requires two local puzzles, freely chosen order, an exit that needs both completed and a return to that exit. Assume existing movement and puzzle rules; do not add combat, a timer, collectibles or a new traversal ability.

### Choose a topology for the experience

| Arrangement | What it affords | Cost / condition |
| --- | --- | --- |
| Chain: `entry → A → B → exit` | Economical navigation and controlled information order | Enforces an order this brief leaves free; suitable only if the actual scope changes or the rules already require it |
| Hub: `entry/exit ↔ A`, `entry/exit ↔ B` | Exit stays an orientation anchor and progress can be read on each return | Repeated travel can become empty repetition; inspect actual path length and the reason for returning |
| Loop: `entry/exit ↔ A ↔ B ↔ entry/exit` | Either room can be visited first and the return can avoid retracing the same corridor | More connections require clear wayfinding and can expose information earlier; inspect whether the player can distinguish a useful connection from decorative space |

For this brief a compact hub may suffice when each return makes the remaining objective and exit state clear. A loop is worth choosing when continuous travel and alternate approach matter, not merely because loops sound sophisticated. Free order is agency, not automatically a strategic tradeoff: if ordering changes no relevant consequence, do not advertise different strategies. Check dependencies against the real puzzle rules; map arrows cannot make a gated room accessible.

### Arrange information and rhythm

Let the entry establish the exit's role and the available room destinations through existing affordances. Make each room recognizable by a relevant spatial relationship, silhouette or landmark rather than another mandatory label. On return, retain an orientation anchor and show the actual completed/remaining state through the agreed presentation. Solving a room should not require adding new decorations solely to prove something changed.

The two puzzles need not both repeat setup–peak–resolution at the same intensity. Reuse an existing rule with a meaningful change in space, information or constraint where the brief permits it; multiplying objects without changing the decision can create repetition rather than development. A connecting passage can provide orientation or contrast, but its duration comes from movement and path length, not a predetermined rest interval. A deliberately rhythmic or contemplative game may favor sustained repetition instead.

### Carry it through and observe

Save the chosen connections, entry/exit, identifiable regions and actual completion dependencies in the existing scene/rule source. Preserve world scale and applicable camera/UI visibility. Compare the intended route with actual player movement: detours, missed connections or repeated reorientation can indicate a problem, but could also be deliberate exploration. A shorter route is not inherently better.

When runtime observation is authorized, follow both allowed room orders and the return after completion. Check access, persistent solved state, exit behavior, orientation and the actual cadence of travel versus activity. A solver can establish a legal order under its modeled rules, not recognition, exploration value or satisfying rhythm. Keep unobserved experience hypotheses explicit; this exercise requires neither new route tooling nor a full-campaign flowchart.

Method sources: the Level Design Book's [flow](https://book.leveldesignbook.com/process/layout/flow) relates movement and connectivity to purpose, while [pacing](https://book.leveldesignbook.com/process/preproduction/pacing) discusses information, causality, repetition and variation. These inform the reasoning, not a requirement for branches, set pieces or a teach–test–twist sequence in every game.
