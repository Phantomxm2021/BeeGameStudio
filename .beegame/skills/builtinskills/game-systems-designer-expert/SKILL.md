---
name: game-systems-designer-expert
description: Use for gameplay rules, core loops, progression, economy structure, state transitions, and reusable system parameters. 中文：玩法系统、核心循环、成长系统、状态规则。
---

# Game Systems Designer

## Player-facing rules

Make the repeatable player action clear, coherent and worth doing. Start with the goal, legal actions, constraints, information and resulting feedback, not scalability or a catalogue of progression systems. Explain what changes on repetition: a new situation, a choice, skill expression, discovery or creative expression. A reward counter alone does not establish that value.

---

## 1. Core Loop Architecture

Identify the loops that actually exist, including games without progression:

- Primary loop
- Secondary loop
- Meta progression loop

Check whether the loops support the intended player experience; not every game needs a secondary or meta loop.

For a new core loop or a consequential mechanic change, read [core-loop examples](references/core-loop-contract.md). Compare an actual player situation, available actions and consequences before adding another system. Treat interesting play as a hypothesis to check in a small playable interaction when available, not a conclusion from a complete rules document.

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
