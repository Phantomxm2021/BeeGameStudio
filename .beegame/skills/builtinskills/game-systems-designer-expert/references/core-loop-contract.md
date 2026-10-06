# Core Loop Contract

## Purpose

Use this reference to make the core gameplay loop explicit without binding to a specific engine or genre.

## Useful details for a full system specification

- Player promise: one sentence that states the repeatable value the player receives.
- Primary loop: goal, action, feedback, reward, failure state, and retry path.
- For a system being implemented: intent, governing gameplay rule, information the player needs and a way to observe whether it works. Identify unresolved dependencies rather than filling them with unsupported defaults. Use a table only when it makes several systems easier to compare.
- Scope boundary: identify what is in the first playable loop and what is intentionally excluded.

## Review Questions

- Can the responsible designers develop the core loop without inventing its goals, actions or gameplay outcomes?
- Are consequential unresolved decisions explicit rather than hidden in assumed defaults?
- Does every system serve the player promise?
- Are acceptance scenarios observable without reading hidden process notes?
