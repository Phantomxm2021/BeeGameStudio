# Core Loop Contract

Use this reference for an unresolved relationship between a player's action, its governing rule and the resulting situation. Explain the conditions, information and consequences needed to resolve that question, referring to existing definitions rather than restating them. Keep gameplay-defining quantities with their rule; implementation tuning follows actual runtime data.

Choose a representation that makes the relationship clear: prose for a simple rule, a table for alternatives or resource flows, or a small diagram for spatial dependencies and state transitions. Label what a connection means; an example route is not a forced sequence, and a dependency is not a chronological step.

## Why repeat the action?

When the open question concerns the value of repeating an action, a short walkthrough can connect the starting state and available information to a legal action, resulting state, feedback and next situation. Derive it from the owning definitions; it must not invent a convenient resource conversion, timing window or outcome. Use it to explain what the player can learn, choose or express on repetition, not as a second rule set. Do not require strategic choices in a reflex game or uncertainty in a deliberately predictable puzzle.

| Loop | Weak description | Inspectable repeatable value |
|---|---|---|
| Timing action | Press a button, gain points, repeat | A visible opportunity changes; the player chooses timing, sees why the attempt succeeded or failed, and can improve the next attempt |
| Turn-based puzzle | Move objects until all goals are filled | Legal moves change available space; a move can help one objective while constraining another, with a usable recovery path where designed |
| Exploration | Walk to markers and collect rewards | Observations reveal a location, route or interaction; the player chooses where to investigate and understands what the discovery changes |

Test the described interaction rather than adding progression to compensate for an uninteresting action. If the next situation never changes, ask whether mastery, expression or deliberate repetition supplies the value; if none is intended, revise the core interaction within scope before adding currencies, upgrades or retention mechanics.

Keep rules and feedback connected: the attempt, legal execution and confirmed outcome can differ. The [Godot platformer example](https://github.com/godotengine/godot-demo-projects/blob/master/2d/platformer/player/player.gd) distinguishes jump eligibility and resulting movement/sound. Learn the connection between rule and feedback, not its double-jump feature or tuning values. A runnable example or model can establish execution, not enjoyment.

For examples of relationship-focused documentation, see [Stone Librande’s SimCity one-page designs](https://www.stonetronix.com/gdc-2013/) and [Ron Gilbert’s puzzle dependency charts](https://www.grumpygamer.com/puzzle_dependency_charts/). Borrow a representation only when it answers the current design question; neither requires a fixed page count, diagram for every system or a new document.
