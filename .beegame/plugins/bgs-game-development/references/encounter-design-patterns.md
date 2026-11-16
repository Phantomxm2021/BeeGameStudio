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

## Worked scene study: an existing platformer

Use this study for a consequential relationship between player action, scene space and presentation. The [official Godot demo](https://github.com/godotengine/godot-demo-projects/blob/34fc99545fc41520a958248f607101e7d0b95b05/2d/platformer/README.md), its screenshot and source are from the same pinned revision. They are a reference to inspect, not a level or feature template for the current game.

![Official Godot platformer scene: a robot and enemy on warm grass-topped rock platforms against a cool distant sky](https://raw.githubusercontent.com/godotengine/godot-demo-projects/34fc99545fc41520a958248f607101e7d0b95b05/2d/platformer/screenshots/platformer.webp)

The picture makes different spatial roles readable: warm grass marks the tops of solid rock masses; cooler sky, clouds and distant forms sit behind the playable surfaces. The character and enemy meet those surfaces at their feet. Coins at different heights suggest regions to investigate, but the still cannot establish their reachability, movement timing or player understanding. This is one way to make a place recognizable while preserving action visibility, not a requirement for pixel art, floating islands or parallax.

### Follow the relationship into its implementation

| Question | Actual source to inspect | Supported conclusion and remaining observation |
| --- | --- | --- |
| How does the place retain independently controlled parts? | [Level scene](https://github.com/godotengine/godot-demo-projects/blob/34fc99545fc41520a958248f607101e7d0b95b05/2d/platformer/level/level.tscn) references tiles, props, moving platforms and a separate background scene | Inspect their actual hierarchy and contact relationships; the screenshot alone does not prove collision, layer motion or navigability |
| Does the visible pose follow what the actor is doing? | [Player code](https://github.com/godotengine/godot-demo-projects/blob/34fc99545fc41520a958248f607101e7d0b95b05/2d/platformer/player/player.gd), `get_new_animation()` and facing selection | Ground contact and velocity select the demonstrated poses, and horizontal velocity selects facing. Judge resulting cadence and transitions in a relevant passage, rather than copying the demo's action names or coefficients |
| Does sound describe a confirmed action? | The same player's `try_jump()` returns when the action is unavailable; accepted branches set vertical velocity and play the jump sound | The code connects a legal action and its cue. It does not prove the mix, physical latency or enjoyment in another runtime |

For the current assignment, preserve only the useful relationship: a readable action surface, the subject's contact/scale, a cue selected by actual state, or a consequence synchronized with its event. The [demo README](https://github.com/godotengine/godot-demo-projects/blob/34fc99545fc41520a958248f607101e7d0b95b05/2d/platformer/README.md) describes an invincible player, so it is not a difficulty or failure/retry benchmark. The current game's own rules still determine its actions, risks and required content.

During authorized implementation, combine the relevant scene, subject, interface and event response in the actual runtime before multiplying an uncertain treatment. During verification, reuse that evidence and observe the required outcomes not yet established. Resource previews, solver routes, screenshots and actual player observations support different conclusions; none alone proves that the complete experience works. This study requires no imported demo, new stage, extra gameplay or mandatory research pass.

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
