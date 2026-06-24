# State Machine and Rules Boundary

## Purpose

Use this reference to make game-state behavior deterministic for downstream implementation.

## Required Outputs

- State flow: name all player-visible states and the events that move between them.
- Transition contract: each transition must define source state, target state, event, condition, and effect.
- Rule ordering: define the order of operations for recurring update loops or discrete turns.
- Failure and recovery: every fail state must state whether the player retries, restarts, resumes, or exits.

## Review Questions

- Are failure paths explicit enough to prevent an implementation agent from inventing fallback behavior?
- Are update-order decisions canonical rather than buried in prose?
- Does recovery behavior preserve the declared MVP scope?
