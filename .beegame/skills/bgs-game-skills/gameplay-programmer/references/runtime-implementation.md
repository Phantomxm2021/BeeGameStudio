# Gameplay implementation and verification

Use for a concrete execution/timing/collision question or when implementing, debugging or testing gameplay.

## Execution and state

- Separate input sampling, legal action execution, simulation and presentation. Identify when commands take effect and who owns results. Prefer existing engine update/physics hooks; choose fixed/variable updates for actual constraints, not a universal loop architecture.
- Keep consequential units/clocks explicit: rates versus increments, elapsed/simulation time, pause and delayed work. Check frame-rate and long-frame outcomes; delta time alone does not ensure stable integration or collision accuracy. Correct demonstrated problems proportionately without unrequested replay/rollback/physics frameworks.
- Resolve held/pressed input, buffering, cancellation, recovery and transitions from design. Keep authoritative movement/contact distinct from smoothing; camera/animation must not change hit tests or input meaning accidentally.
- For contact defects, inspect shapes, coordinates, displacement and ordering. Use suitable collision queries/continuous detection when sampled overlaps can miss crossings. Distinguish new contacts, sustained overlaps and repeated notifications to avoid duplicate consequences.
- Apply simultaneous-outcome precedence from owning rules. Scoring, damage, spawning, destruction and completion consume the same confirmed event; presentation uses its actual subject/result. Missing consequential rules are design dependencies, not convenient code defaults.
- Resolve when a confirmed outcome ends simulation/input, how its required visual/audio response continues, and when the next screen or removal occurs. An immediate state change must not cancel feedback that the design requires; timing comes from that design, not a universal delay. Specify whether the original subject remains, changes or is replaced during its effect. Reset run-owned callbacks, effects and subscriptions on relevant restart/exit paths using existing lifecycle facilities.

## Runtime verification

Check affected behavior from initial, requested, constrained and resulting states. Use focused rule tests and target-runtime observations; timing/contact risks need representative elapsed-time, update-rate and interruption/boundary cases, not a full simulator. Distinguish driver failures from game defects. Builds and successful scripted routes do not establish subjective game feel.
