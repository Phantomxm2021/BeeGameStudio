---
name: game-balance-designer-expert
description: Design, diagnose, or tune combat, movement difficulty, progression, rewards, economies, and quantitative game rules. 中文：数值设计、平衡诊断、战斗数值、成长曲线、游戏经济、难度。
---

# Game Balance Designer

Choose initial values from the intended experience and the existing rules and space. For GDD work, hand off usable parameter choices, units, consequential relationships and the questions that require playtesting. Pacing, fairness and fun remain hypotheses until observed; document refinement cannot establish them.

Before relying on a derived numerical claim that affects feasibility or a parameter choice, use the available Shell to evaluate the smallest relevant formula or bound from authoritative inputs. State units, applicable states and timing assumptions; when a legal boundary changes the result, calculate that boundary and report the applicable range instead of an unconditional number. A claim already written in the draft still needs this support; rereading or keyword searches do not check the relationship. Keep the short formula, assumptions and result with the owning decision in `docs/GDD.md`, referencing parameter definitions instead of copying tables. If a needed input or assumption is unresolved, qualify or remove the precise claim. Recalculate only affected relationships when substantive inputs change; reuse valid results instead of adding another general review. A formula needs no simulator or calculation appendix. For an executed scenario, preserve legal actions and resulting states; one feasible route proves that route, not a fastest time or universal safety.

Read [tuning and growth examples](references/scaling-curve-models.md) for an unresolved baseline or growth relationship, and [economy methods](references/economy-balancing-spec.md) only for an actual resource-economy question. Do not invent a growth curve, sink, cap or dominance threshold merely to use a method.

When tuning an implementation, first distinguish a numerical cause from control, information or level-design defects. Change the smallest relevant parameter/relationship and observe the affected player situations, including a strong strategy or boundary when it could invalidate the change. Keep release values separate from optional tuning ranges, and measured outcomes separate from targets. PvP and PvE need not share a baseline.
