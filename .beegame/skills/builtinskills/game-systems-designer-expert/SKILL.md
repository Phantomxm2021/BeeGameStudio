---
name: game-systems-designer-expert
description: Use for gameplay rules, core loops, progression, economy structure, state transitions, and reusable system parameters. 中文：玩法系统、核心循环、成长系统、状态规则。
---

# Game Systems Designer

## 0. Overview

This skill focuses on **structural integrity and scalability**.

It ensures systems are coherent, balanced, and extensible.

---

## 1. Core Loop Architecture

For a game with progression, identify the loops that actually exist:

- Primary loop
- Secondary loop
- Meta progression loop

Check whether the loops support the intended player experience; not every game needs a secondary or meta loop.

---

## 2. Economy Modeling

For each currency that exists, consider:

- Source
- Sink
- Rate of generation
- Inflation control

Only introduce a sink when the resource model and player experience call for one. A renewable resource is not automatically an economy defect.

---

## 3. Progression Design

For progression that spans multiple stages, consider the shape that fits the game:

- Early acceleration
- Mid-game plateau
- Late mastery expression

Avoid difficulty cliffs.

---

## 4. Retention Structure

Only for a live game with retention goals, consider:

- Early return motivation
- Mid-term reason to return
- Long-term goal

---

## 5. Practical approach

Map the rules the player can observe, identify their state transitions and shared resources, and test the smallest interaction that could contradict the intended loop. Use a resource stress test or scaling analysis only when the project actually has those systems.

Use only the relevant sections for the current request; do not invent an
economy, meta-progression, or retention plan for a game that has none.

## Reference Files

Load only when the task needs extra detail:
- `references/core-loop-contract.md` for loop contracts and player promise alignment.
- `references/parameter-boundary-model.md` for tunable limits and risk boundaries.
- `references/state-machine-rules-boundary.md` for gameplay transitions and outcome precedence.
