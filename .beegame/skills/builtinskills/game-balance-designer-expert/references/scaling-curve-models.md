# Scaling Curves

Use a curve to explain a specific player-facing progression, not because a genre supposedly requires one.

## Select the cause before the curve

| Observed problem | Parameter relationship to inspect | Comparison that helps distinguish the cause |
|---|---|---|
| Players repeatedly miss a landing | Horizontal reach, jump/control timing and actual collision shape | Compare reachable motion with the gap, then distinguish an unreachable landing from an unreadable or difficult input |
| An enemy feels slow to defeat | Legal hits to defeat, cadence, recovery, accuracy and approach time | Compare actual attack/contact intervals; damage alone does not describe the whole encounter |
| A resource purchase feels stalled | Acquisition rate, cost and alternative uses over the relevant window | Compare typical play with the claimed rate; an inaccessible route is not fixed by changing currency growth |

Numbers can guide a design before player observations exist, but label them as initial choices and hypotheses. Do not invent reactions from simulated players or fit a curve to hide a control, information or level defect.

### A deliberately small calculation

Illustrative assumptions, not release values: target health is 120 HP; each confirmed hit applies 30 HP; four hits occur at 0.0, 0.4, 0.8 and 1.2 seconds. With no travel, mitigation, misses or recovery, defeat occurs at 1.2 seconds, not `4 × 0.4 = 1.6`. State what is included before using that result to choose a parameter. A different first-hit policy or real encounter changes the conclusion.

Test the smallest relevant relationship and keep the actual runtime values authoritative. A useful reference is [Mindustry's unit definitions](https://github.com/Anuken/Mindustry/blob/master/core/src/mindustry/content/UnitTypes.java), where health, speed, weapon timing and effects coexist in real content. Inspect the actual runtime units/rules before drawing conclusions; copying its numbers does not establish balance for another game.

## Growth forms, only where progression exists

| Form | Useful property | Watch for |
| --- | --- | --- |
| Linear `a*x+b` | Predictable increments | Repetition or weak late milestones |
| Polynomial `a*x^n` | Adjustable acceleration | Surprising growth at large `x` |
| Exponential `a*b^x` | Rapid escalation | Compounding rewards or damage outrunning content |
| Logarithmic `a*log(x+1)` | Fast early change, slower later change | Too little payoff at high effort |
| Piecewise | Different behavior at meaningful thresholds | Visible discontinuities or awkward tuning |
| Saturating `a*x/(x+k)` | Diminishing returns | Effective cap arriving too early |

For the affected system, record the input range, units, expected player experience, and representative early/middle/late values. Check multiplier order and plausible extremes. A curve can be mathematically stable yet feel wrong; compare against play or telemetry before changing it. No universal growth multiple or fixed curve type is a pass/fail rule.
