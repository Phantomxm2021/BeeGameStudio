---
name: gameplay-programmer
description: Implement or debug real-time gameplay rules, movement, collision, action execution, update timing and runtime state. Use for gameplay code correctness, not UI layout or asset import alone. 中文：玩法程序、运动碰撞、碰撞穿透、更新时序、动作中断、帧率相关行为。
---

# Gameplay Programmer

Implement agreed player-visible rules in the chosen engine/framework. Read owning rule, balance, interaction and code sources; technical choices must not silently change win conditions, controls or collision outcomes.

## Execution and state

- Separate input sampling, legal action execution, simulation and presentation. Identify when commands take effect and who owns results. Prefer existing engine update/physics hooks; choose fixed/variable updates for actual constraints, not a universal loop architecture.
- Keep consequential units/clocks explicit: rates versus increments, elapsed/simulation time, pause and delayed work. Check frame-rate and long-frame outcomes; delta time alone does not ensure stable integration or collision accuracy. Correct demonstrated problems proportionately without unrequested replay/rollback/physics frameworks.
- Resolve held/pressed input, buffering, cancellation, recovery and transitions from design. Keep authoritative movement/contact distinct from smoothing; camera/animation must not change hit tests or input meaning accidentally.
- For contact defects, inspect shapes, coordinates, displacement and ordering. Use suitable collision queries/continuous detection when sampled overlaps can miss crossings. Distinguish new contacts, sustained overlaps and repeated notifications to avoid duplicate consequences.
- Apply simultaneous-outcome precedence from owning rules. Scoring, damage, spawning, destruction and completion consume the same confirmed event; presentation uses its actual subject/result. Missing consequential rules are design dependencies, not convenient code defaults.
- Reset run-owned state across relevant pause/restart/scene-change/exit paths, including stale references, callbacks and subscriptions. Prefer existing lifecycle facilities or local fixes over a general state/event framework.

## Integration and verification

Consume authored configuration and Scene/UI through actual contracts, without duplicating static layout in gameplay code. Describe consequential interfaces/execution choices separately from product rules; share confirmed simulation results with animation, audio and UI.

For BGS new games, complete TECHNICAL_DESIGN.md in the eight-document stage: approach, module responsibilities, interfaces, data consumption, lifecycle/failure behavior and verification. Mark unproduced inputs as planned; revise the same design from later visual/resource/Scene/UI outputs. Select implementation-planning guidance when useful; no task index is required. Document-only assignments do not authorize implementation.

Support consequential platform claims with the supplied contract or authoritative source and actual preconditions. Gather additional evidence only for a downstream constraint and within authorization; preserve provenance under the project contract. Missing evidence is not a remembered quotation or a reason to collect broad tutorials.

Check affected behavior from initial, requested, constrained and resulting states. Use focused rule tests and target-runtime observations; timing/contact risks need representative elapsed-time, update-rate and interruption/boundary cases, not a full simulator. Distinguish driver failures from game defects. Builds and successful scripted routes do not establish subjective game feel.
