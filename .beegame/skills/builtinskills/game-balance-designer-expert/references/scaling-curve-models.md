# Scaling Curves

Use a curve to explain a specific player-facing progression, not because a genre supposedly requires one.

| Form | Useful property | Watch for |
| --- | --- | --- |
| Linear `a*x+b` | Predictable increments | Repetition or weak late milestones |
| Polynomial `a*x^n` | Adjustable acceleration | Surprising growth at large `x` |
| Exponential `a*b^x` | Rapid escalation | Compounding rewards or damage outrunning content |
| Logarithmic `a*log(x+1)` | Fast early change, slower later change | Too little payoff at high effort |
| Piecewise | Different behavior at meaningful thresholds | Visible discontinuities or awkward tuning |
| Saturating `a*x/(x+k)` | Diminishing returns | Effective cap arriving too early |

For the affected system, record the input range, units, expected player experience, and representative early/middle/late values. Check multiplier order and plausible extremes. A curve can be mathematically stable yet feel wrong; compare against play or telemetry before changing it. No universal growth multiple or fixed curve type is a pass/fail rule.
