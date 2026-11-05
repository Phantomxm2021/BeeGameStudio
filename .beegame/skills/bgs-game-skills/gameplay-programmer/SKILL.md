---
name: gameplay-programmer
description: "Implement, debug or verify gameplay rules, controls and state transitions in the chosen runtime, including engine/React integration and focused browser checks. Use for execution behavior rather than general GDD writing. 中文：玩法执行、碰撞时序、状态归属与宿主集成。"
---

# Gameplay Programmer

Implement agreed player-visible rules in the chosen engine/framework. Read owning rule, balance, interaction and code sources; technical choices must not silently change win conditions, controls or collision outcomes.

## Technical design

Identify input, simulation and presentation ownership, consequential clocks/units, simultaneous-outcome precedence and lifecycle boundaries. Use the agreed rules and actual target constraints; no universal loop architecture or speculative state framework is required.

## Integration and verification

Consume authored configuration and Scene/UI through actual contracts, without duplicating static layout in gameplay code. Describe consequential interfaces/execution choices separately from product rules; share confirmed simulation results with animation, audio and UI. When a player-facing cue communicates where an action is possible, safe, risky or confirmed, give its presentation owner the existing condition, subject and result that determine the cue; presentation may clarify those facts but must not invent a different rule or boundary.

For assigned technical-design work, record consequential execution decisions in the owning design definitions. During implementation, keep code-level interfaces and ownership with their code/configuration. A general GDD platform choice does not require a module/function plan or task index. GDD-only assignments do not authorize implementation.

## Runtime verification

- Choose focused scenarios for the current required behavior or concrete defect, including the affected target inputs and recovery/safety conditions. Derive expected outcomes from the owning requirement and its permitted alternatives, independently of the implementation. Additional presentation preferences remain follow-up work when the requirement is already satisfied.
- Reuse a suitable existing script. For repeated or multi-scenario browser checks, retain the runnable batch and its expected/observed results in ordinary project verification artifacts so later work and compaction can reuse them; no prescribed filename or report format is needed. Through the available browser script tool, establish each scenario's current state, delivered inputs, bounded waits and observations together, and return the batch results before changing game code. Assert deterministic outcomes. Preserve earlier results if a scenario fails; dependent scenarios remain unexecuted with the cause, while independent ones may start from a valid state.
- Distinguish game defects from driver/environment failures. Repair concrete game defects together, then rerun affected scenarios from the retained script. Reuse passed results when their behavior and conditions are unchanged, including across unrelated edits or compaction. When the required outcomes are established and no concrete defect remains, finish verification; optional refinements are not unfinished delivery work. Missing required observations remain explicit, not passed.
- Return state and measurements for behavior questions; capture necessary visual/motion evidence within the script before transient feedback disappears. A recovery check observes restored activity after relevant delayed effects and through a subsequent action, not just a reset counter. Hooks can isolate rules but do not replace delivered-input checks. Stills support static claims; timing and sound need their corresponding observations, and a successful route does not establish player enjoyment.

Support consequential platform claims with the installed runtime and authoritative sources. For initial dependency setup or a concrete version mismatch, use the shared [runtime dependency selection](references/runtime-dependencies.md) rather than selecting a version from memory. Reuse established choices for unchanged work.

For concrete timing/contact/lifecycle implementation or debugging, read [runtime implementation](references/runtime-implementation.md). For requested player-experience studies, deeper audiovisual investigation or measured performance work, use [game playtest](../game-playtest-performance/SKILL.md). For a React-hosted Phaser instance, state bridge or DOM HUD problem, use [React host integration](references/react-host-integration.md); it covers lifecycle and binding, not another simulation architecture.
