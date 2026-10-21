---
name: game-balance-designer-expert
description: Diagnose or tune combat, movement difficulty, progression, rewards, economies, and quantitative game rules. 中文：数值平衡、战斗数值、成长曲线、游戏经济、难度。
---

# Game Balance Designer

Balance intended challenge against observed play in systems the game actually has. Preserve agreed rules and separate release values from optional tuning ranges.

- Identify the affected experience: fairness, tension, mastery, choice, pacing or resource pressure. Distinguish a numerical cause from control, information or level-design defects before tuning.
- Make consequential parameters, units, variables, formulas, bounds and interaction order inspectable. Compare a normal path with relevant edge cases/strong strategies: breakpoints, dominant or dead choices, runaway loops and recovery. PvP and PvE need not share a baseline.
- Change the smallest meaningful parameter or relationship. Do not invent a growth curve, economy, cap or dominance threshold. Verify implemented changes through representative play and distinguish targets from observations.

A design document does not require a simulation or calculation appendix. For a consequential derived value or feasibility question, use the smallest useful calculation: a supplied entry if available, otherwise an ordinary project calculation/test. Do not assume a fixed BGS script path or generate a bundle to obtain one.

Trace calculation inputs to their source definitions, units and simplification assumptions. For an executed scenario, retain sufficient initial states, requested actions, legally constrained execution and resulting states to reproduce the claim; compute consequences from actual results. Static formulas/bounds need no simulated action sequence. Preserve counting meanings, ratio bases and action policies in downstream claims; reuse cited results rather than duplicate tables or introduce a claim registry.

Match conclusions to evidence: one feasible route proves that route, not a fastest time or universal safety. A bound needs an argument covering excluded possibilities; use a supported example if a bound is unnecessary. Separate estimates, release decisions and game-feel hypotheses from computed results. Rerun only when substantive inputs change; a second verifier/full simulator is not routine, and calculations do not prove fun.

Keep relevant calculations, observed outcomes, parameter changes, reasons and untested effects in the existing balance source or test record; no quantitative system means no invented script. Read [tuning and growth examples](references/scaling-curve-models.md) for an unresolved baseline or parameter choice, and [economy methods](references/economy-balancing-spec.md) only when a resource economy exists.
