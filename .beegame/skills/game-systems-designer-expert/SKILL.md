---
name: game-systems-designer-expert
description: Specialized in systemic gameplay architecture, economy modeling, balancing, and scalable progression systems.
summary: |
  Focused on building structured gameplay systems including core loops,
  progression architecture, economy balance, and retention modeling.
  Ideal for mid-to-late stage system stabilization and long-term scalability.
capabilities:
  - Core & Meta loop structuring
  - Resource flow modeling
  - Economy balancing
  - Progression pacing design
  - Retention metric alignment
  - Risk & scaling analysis
version: 1.0.0
category: GameDev/Design
tags: [SystemsDesign, Economy, Progression, Retention]
phases: [gdd]
target_profiles: [web-react-ts, unity, xr]
priority: 85
context_strategy:
  references:
    - id: core-loop-contract
      title: "Core Loop Contract"
      summary: "Primary loop, player promise, and acceptance-ready system boundaries."
      tags: [core-loop, systems, contract]
      audience: [Metis]
      autoload: true
      priority: 95
      phases: [gdd]
      artifact_types: [gdd_payload]
      output_expectations: [system_table, player_promise, acceptance_criteria]
    - id: state-machine-rules-boundary
      title: "State Machine and Rules Boundary"
      summary: "State transitions, rule ordering, failure, and recovery requirements."
      tags: [state-machine, rules, failure]
      audience: [Metis]
      autoload: true
      priority: 90
      phases: [gdd]
      artifact_types: [gdd_payload]
      output_expectations: [state_failure_recovery, system_table]
    - id: parameter-boundary-model
      title: "Parameter Boundary Model"
      summary: "Implementation-facing parameters with value, unit, scope, and tunable boundaries."
      tags: [parameters, tuning, boundaries]
      audience: [Metis]
      autoload: true
      priority: 85
      phases: [gdd]
      artifact_types: [gdd_payload]
      output_expectations: [parameter_boundaries]
security:
  risk_level: medium
---

# Systems Designer Expert Skill Document

## 0. Overview

This skill focuses on **structural integrity and scalability**.

It ensures systems are coherent, balanced, and extensible.

---

## 1. Core Loop Architecture

Define:

- Primary loop
- Secondary loop
- Meta progression loop

All loops must reinforce each other.

---

## 2. Economy Modeling

Every currency must define:

- Source
- Sink
- Rate of generation
- Inflation control

No infinite loop without sink.

---

## 3. Progression Design

Define:

- Early acceleration
- Mid-game plateau
- Late mastery expression

Avoid difficulty cliffs.

---

## 4. Retention Structure

Design must specify:

- D1 Hook
- D7 Anchor
- Long-term goal

---

## 5. Agent Execution Logic

1. System Mapping
2. Loop Validation
3. Resource Stress Test
4. Scaling Risk Analysis

All outputs must emphasize **system stability over feature novelty**.
