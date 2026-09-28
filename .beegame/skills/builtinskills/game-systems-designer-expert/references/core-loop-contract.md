# Core Loop Contract

## Purpose

Use this reference to turn a concept into an implementation-ready gameplay loop without binding to a specific engine or genre.

## Useful details for a full system specification

- Player promise: one sentence that states the repeatable value the player receives.
- Primary loop: goal, action, feedback, reward, failure state, and retry path.
- For a system being implemented: intent, player-facing behavior, governing rule, relevant tunable parameters, and a way to observe whether it works. Use a table only when it makes several systems easier to compare.
- Scope boundary: identify what is in the first playable loop and what is intentionally excluded.

## Review Questions

- Can an implementation agent build the core loop without inventing rules?
- Does every system serve the player promise?
- Are acceptance scenarios observable without reading hidden process notes?
