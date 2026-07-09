# Scaling Curve & Growth Function Patterns

## 0. Overview

This document defines mathematical growth models used in game progression,
combat scaling, reward pacing, and long-term power systems.

All scaling decisions must explicitly state:

- Function type
- Parameters
- Boundary constraints
- Intended player experience

---

## 1. Linear Growth

### Formula

f(x) = a * x + b

### Characteristics

- Predictable
- Stable
- Easy to tune
- Low risk

### Use Cases

- Early-game progression
- Resource generation
- Basic stat scaling

### Risk

- Late game may feel flat
- Weak sense of power fantasy

---

## 2. Exponential Growth

### Formula

f(x) = a * b^x

### Characteristics

- Rapid late scaling
- Strong power fantasy
- Dangerous inflation potential

### Use Cases

- Idle mechanics
- Prestige systems
- Late-game vertical growth

### Mandatory Controls

- Soft cap
- Log dampening
- Tier reset
- Diminishing multiplier

Uncontrolled exponential growth will destabilize economy and PvP.

---

## 3. Logarithmic Growth

### Formula

f(x) = a * log(x + 1)

### Characteristics

- Strong early growth
- Natural late-game flattening
- Built-in soft cap behavior

### Use Cases

- Skill mastery bonuses
- Defensive mitigation
- Resistance systems

---

## 4. Polynomial Growth

### Formula

f(x) = a * x^n

### Characteristics

- Flexible scaling
- Can simulate mild exponential
- Tunable aggression

### Risk

- Hidden late-game explosion if n > 2

---

## 5. Piecewise Scaling

### Concept

Different functions applied at different ranges:

Example:

Level 1–20 → Linear  
Level 21–50 → Polynomial  
Level 51+ → Log dampened

### Use Case

- Controlled long-term RPG scaling
- Seasonal content resets

---

## 6. Diminishing Returns Model

### Example

EffectiveValue = Base * (Stat / (Stat + K))

### Characteristics

- Hard asymptotic cap
- Prevents stat dominance
- Encourages build diversity

Used in:
- Defense
- Critical rate
- Cooldown reduction

---

## 7. Time-to-Kill (TTK) Modeling

TTK ≈ HP / EffectiveDamagePerSecond

Scaling curves must consider:

- Early TTK (short, exciting)
- Mid TTK (strategic depth)
- Late TTK (not overly long)

Unbounded scaling often results in:
- Instant kills
- Damage sponge scenarios

---

## 8. Inflation Risk Modeling

For each curve, simulate:

- Max-level scenario
- Stacked multiplier scenario
- PvP mirrored case

If compounded multiplier growth exceeds:
> 10x baseline within short progression window

Rebalance required.

---

## 9. Curve Selection Guidelines

| Goal | Recommended Curve |
|------|-------------------|
| Stable progression | Linear |
| Power fantasy | Controlled exponential |
| Soft cap | Logarithmic |
| Flexible tuning | Polynomial |
| Long-term scalability | Piecewise hybrid |

---

## 10. Validation Checklist

- Does growth exceed content scaling?
- Does curve create dominant stat?
- Is late-game flattening intentional?
- Are boundaries mathematically provable?
- Are multiplier stacks capped?

All scaling systems must define:
- Maximum theoretical value
- Practical expected value
- Worst-case stacking scenario
