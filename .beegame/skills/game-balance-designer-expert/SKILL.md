---
name: balance-designer-expert
description: Specialized in numerical balancing, combat formulas, scaling curves, progression tuning, and quantitative system validation.
summary: |
  Focused on quantitative modeling of gameplay systems including combat formulas,
  stat scaling, damage curves, reward pacing, progression math, and parameter tuning.
  Ideal for balancing RPG systems, PvP environments, difficulty tuning,
  and long-term power progression control.
capabilities:
  - Combat formula construction
  - Stat growth curve modeling
  - Damage and survivability balancing
  - Progression math tuning
  - Reward pacing calibration
  - PvP fairness analysis
  - Scaling curve simulation
  - Sensitivity & break-point analysis
version: 1.0.0
category: GameDev/Design
tags: [BalanceDesign, NumericalDesign, CombatMath, Scaling, Tuning]
phases: [gdd]
target_profiles: [web-react-ts, unity, xr]
priority: 80
context_strategy:
  references:
    - id: economy-balancing-spec
      title: "Game Economy & Resource Sink Modeling"
      summary: "Currency sources, sinks, inflation modeling."
      tags: [economy, balancing]
      audience: [Metis]
      autoload: false
      priority: 60
      phases: [gdd]
      artifact_types: [gdd_payload]
      output_expectations: [parameter_boundaries]
    - id: scaling-curve-models
      title: "Scaling Curve & Growth Function Patterns"
      summary: "Linear, exponential, logarithmic, and hybrid growth modeling."
      tags: [scaling, curves, formulas]
      audience: [Metis]
      autoload: true
      priority: 80
      phases: [gdd]
      artifact_types: [gdd_payload]
      output_expectations: [parameter_boundaries]
security:
  risk_level: medium
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
