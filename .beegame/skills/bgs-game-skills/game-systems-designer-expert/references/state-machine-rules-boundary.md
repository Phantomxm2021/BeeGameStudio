# State Machine and Rules Boundary

## Purpose

Use this reference to describe gameplay-state outcomes and distinguish game rules from interface behavior and runtime execution.

## Relevant state relationships

- Identify the relevant gameplay states, semantic events, transition conditions and gameplay effects. Distinguish them from page navigation, focus, visual transitions and internal lifecycle states.
- Resolve precedence when simultaneous rules change the player's gameplay outcome, including discrete-turn ordering where it is itself a game rule. State the intended outcome separately from the update loop, event dispatch or collision algorithm used to realize it.
- Define the gameplay consequence of failure and recovery, such as retry, restart, resume or exit; distinguish that consequence from the control or screen used to request it.

## Review Questions

- Are failure paths explicit enough to prevent an implementation agent from inventing fallback behavior?
- Is gameplay-outcome precedence distinct from runtime execution order?
- Are gameplay transitions clear without confusing them with interface states?
- Does recovery behavior preserve the declared MVP scope?
