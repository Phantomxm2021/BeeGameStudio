---
name: game-balance-designer-expert
description: Use when designing or auditing game balance, combat math, scaling curves, reward pacing, progression parameters, economy pressure, or quantitative tuning boundaries.
---

# Balance Designer Expert Skill Document

## 0. Overview

This skill focuses on **mathematical integrity and parameter stability**.

It ensures that combat, progression, and reward systems are:

- Predictable
- Scalable
- Tunable
- Resistant to exploits

Design decisions must be justified numerically.

---

## 1. Core Numerical Principles

### 1.1 Explicit Formula Requirement

All balance decisions must specify:

- Formula
- Variables
- Scaling logic
- Boundary conditions

No qualitative balancing is allowed.

---

### 1.2 Scaling Curve Discipline

Common curve types:

- Linear → Predictable, stable
- Exponential → Power fantasy, risky
- Logarithmic → Soft cap behavior
- Piecewise hybrid → Controlled late game

Exponential growth must always define control mechanisms.

---

## 2. Combat Formula Design

### 2.1 Damage Formula Structure

Must define:

- Base value
- Stat contribution
- Multipliers
- Mitigation layer
- Critical interaction

Avoid multiplicative stacking without cap.

---

### 2.2 Survivability Modeling

Balance must consider:

- Time-to-kill (TTK)
- Effective HP
- Burst window
- Sustain recovery

PvP and PvE require separate tuning baselines.

---

## 3. Progression Math

### 3.1 Power Curve

Define:

- Early growth acceleration
- Mid-game stabilization
- Late-game diminishing returns

Avoid infinite vertical scaling.

---

### 3.2 Reward Pacing

Rewards must:

- Match challenge difficulty
- Avoid exponential inflation
- Preserve milestone meaning

---

## 4. Sensitivity & Breakpoint Analysis

Each system must analyze:

- Stat dominance
- Optimal build threshold
- Overpowered breakpoints
- Underperforming dead zones

If one variable dominates > 70%, rebalance required.

---

## 5. Simulation & Validation

Simulate:

- Average player
- Optimized build
- Worst-case exploit build
- PvP mirror scenario

Check for:

- Degenerate strategies
- Infinite scaling loops
- Unintended synergy stacking

---

## 6. Agent Execution Logic

1. Parameter Discovery Phase
   - Identify all numerical variables
   - Extract formulas

2. Curve Modeling Phase
   - Select growth type
   - Define boundary constraints

3. Simulation Phase
   - Run extreme-case modeling
   - Detect breakpoints

4. Stability Validation Phase
   - Check inflation risk
   - Verify scaling sustainability

All outputs must include:
- Explicit formulas
- Curve reasoning
- Identified risk zones
- Suggested tuning levers

## Reference Files

Load only when the task needs extra detail:
- `references/scaling-curve-models.md` for growth function patterns and curve selection.
- `references/economy-balancing-spec.md` for currency sources, sinks, and inflation checks.
