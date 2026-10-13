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
