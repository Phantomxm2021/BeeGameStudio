# Core Loop Contract

## Purpose

Use this reference to make the core gameplay loop explicit without binding to a specific engine or genre.

## Useful details for a full system specification

- Player promise: one sentence that states the repeatable value the player receives.
- Primary loop: goal, action, feedback, reward, failure state, and retry path.
- For a system being implemented: intent, governing gameplay rule, information the player needs and a way to observe whether it works. Identify unresolved dependencies rather than filling them with unsupported defaults. Use a table only when it makes several systems easier to compare.
- Scope boundary: identify what is in the first playable loop and what is intentionally excluded.

## Why repeat the action?

Follow a concrete situation through action, constraint, outcome and the next situation. Identify what the player can learn, choose or express on repetition. Do not require strategic choices in a reflex game or uncertainty in a deliberately predictable puzzle.

| Loop | Weak description | Inspectable repeatable value |
|---|---|---|
| Timing action | Press a button, gain points, repeat | A visible opportunity changes; the player chooses timing, sees why the attempt succeeded or failed, and can improve the next attempt |
| Turn-based puzzle | Move objects until all goals are filled | Legal moves change available space; a move can help one objective while constraining another, with a usable recovery path where designed |
| Exploration | Walk to markers and collect rewards | Observations reveal a location, route or interaction; the player chooses where to investigate and understands what the discovery changes |

Test the described interaction rather than adding progression to compensate for an uninteresting action. If the next situation never changes, ask whether mastery, expression or deliberate repetition supplies the value; if none is intended, revise the core interaction within scope before adding currencies, upgrades or retention mechanics.

Keep rules and feedback connected: the attempt, legal execution and confirmed outcome can differ. The [Godot platformer example](https://github.com/godotengine/godot-demo-projects/blob/master/2d/platformer/player/player.gd) distinguishes jump eligibility and resulting movement/sound. Learn the connection between rule and feedback, not its double-jump feature or tuning values. A runnable example or model can establish execution, not enjoyment.

## Review Questions

- Can the responsible designers develop the core loop without inventing its goals, actions or gameplay outcomes?
- Are consequential unresolved decisions explicit rather than hidden in assumed defaults?
- Does every system serve the player promise?
- Are acceptance scenarios observable without reading hidden process notes?
