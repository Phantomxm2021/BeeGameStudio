---
name: game-balance-designer-expert
description: Diagnose or tune combat, movement difficulty, progression, rewards, economies, and quantitative game rules. 中文：数值平衡、战斗数值、成长曲线、游戏经济、难度。
---

# Game Balance Designer

Balance is the relationship between intended challenge and observed play, not a mandate to produce formulas for every feeling. Work on the systems the game actually has.

- Define the affected player experience first: fairness, tension, mastery, choice, pacing, or resource pressure. Check player observations as well as numbers.
- For an initial quantitative baseline or an experience-driven adjustment, use the applicable [tuning examples](references/scaling-curve-models.md). Identify the parameter that could cause the observed problem and a comparison that distinguishes it from a control, information or level-design defect; do not default to a growth curve.
- When a rule depends on math, make its units, variables, bounds, and interaction order inspectable. For combat this may mean damage, mitigation, effective health, burst and recovery; for platforming it may mean movement speed, jump arc, reachable distance, and timing windows.
- Compare a normal path with plausible edge cases or strong strategies. Test breakpoints, dominant choices, dead options, runaway loops, and recovery after failure only where they matter.
- Tune the smallest meaningful parameter or relationship. Avoid arbitrary dominance thresholds, universal curve shapes, and adding a currency sink or cap without a demonstrated need.
- When tuning an implemented game, verify the change through representative play and distinguish targets from observations. Use a simulation only when it answers a concrete numerical question. If both PvP and PvE exist, do not assume they share a baseline.

Make goals, initial tunable parameters, units, formulas and assumptions inspectable. Preserve the agreed gameplay rules and separate optional tuning ranges from release configuration. A design document does not require a model, simulation or calculation appendix. Use the smallest executable calculation when a consequential derived value or feasibility question needs it; use an actually supplied calculation entry when available. Otherwise a normal project calculation or test can answer the same scoped question; do not assume a fixed BGS balance-script path or generate a delivery bundle to obtain one.

For a calculation actually used, trace its inputs to source definitions and state extraction or simplification assumptions. Static formulas and bounds need no simulated action sequence. If the claim is an executed scenario, show meaningful initial states, requested actions, constrained execution and resulting states; compute consequences from those actual states rather than desired inputs. Retain only the inputs/results needed to reproduce the consequential claim. Independent review compares them with their sources; a second verifier or full simulator is not a routine requirement. Reuse cited results instead of maintaining duplicate derived tables.

For computed claims, preserve units, counting meanings, ratio bases and the relevant initial conditions/action policy in labels or limitations. Downstream prose must keep that scope; no separate claim registry is needed.

Match the claim to the evidence. One feasible route establishes that route, not a fastest time or universal safety. A bound needs an argument for why excluded possibilities cannot violate it. When such an argument is unnecessary for selecting release values, use the supported example instead. Separate estimates and experience targets from computed results; do not add nominal proofs for every possible risk.

Base reasoning on upstream facts and legal actions, not just consistent arithmetic. Identify missing release decisions separately from game-feel hypotheses. Rerun existing calculations only when their substantive inputs change. Actual saved configuration/content and the runtime establish implemented balance and playability; a small calculation does not prove fun.

For a narrow bug, explain the relevant calculation and its observed outcome; do not redesign the whole progression system. For a full tuning pass, report the parameters that changed, why, and what remains untested. If no derived quantitative rules exist, state that rather than inventing an empty script or numerical system.

Read `references/scaling-curve-models.md` for long-term growth and `references/economy-balancing-spec.md` only when the game has a resource economy.
