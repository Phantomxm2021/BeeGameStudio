---
name: game-balance-designer-expert
description: Diagnose or tune combat, movement difficulty, progression, rewards, economies, and quantitative game rules. 中文：数值平衡、战斗数值、成长曲线、游戏经济、难度。
---

# Game Balance Designer

Balance is the relationship between intended challenge and observed play, not a mandate to produce formulas for every feeling. Work on the systems the game actually has.

- Define the affected player experience first: fairness, tension, mastery, choice, pacing, or resource pressure. Check player observations as well as numbers.
- When a rule depends on math, make its units, variables, bounds, and interaction order inspectable. For combat this may mean damage, mitigation, effective health, burst and recovery; for platforming it may mean movement speed, jump arc, reachable distance, and timing windows.
- Compare a normal path with plausible edge cases or strong strategies. Test breakpoints, dominant choices, dead options, runaway loops, and recovery after failure only where they matter.
- Tune the smallest meaningful parameter or relationship. Avoid arbitrary dominance thresholds, universal curve shapes, and adding a currency sink or cap without a demonstrated need.
- Verify the change through a representative play scenario or simulation, and distinguish a documented target from an assumption. If both PvP and PvE exist, do not assume they share a tuning baseline.

For BALANCE_DESIGN.md, provide implementable release values and explain the player experience they are intended to produce. Keep optional tuning ranges separate from the current configuration; derive reachable states and dependent limits from that configuration and the actual content. Preserve agreed gameplay rules rather than changing them to fit a calculation.

For a consequential calculation, make the reasoning traceable: upstream facts → modeled situation → calculation → supported design decision. Reuse source data where practical; if it is transcribed or simplified, check the relevant facts against the source before relying on the result. Show the actions or event sequence needed to reproduce the situation. Tools are optional; a script with assumed answers is not independent evidence.

Match the claim to the evidence. One feasible route establishes that route, not a fastest time or universal safety. A bound needs an argument for why excluded possibilities cannot violate it. When such an argument is unnecessary for selecting release values, use the supported example instead. Separate estimates and experience targets from computed results; do not add nominal proofs for every possible risk.

Base consequential reasoning on the upstream facts and legal actions, not just internally consistent arithmetic. Remaining implementation-blocking decisions need an explicit handoff; game-feel hypotheses can await playtesting. No document self-review, independent checker, mandatory simulator or runtime implementation is required by this Skill.

For a narrow bug, explain the relevant calculation and its observed outcome; do not redesign the whole progression system. For a full tuning pass, report the parameters that changed, why, and what remains untested.

Read `references/scaling-curve-models.md` for long-term growth and `references/economy-balancing-spec.md` only when the game has a resource economy.
