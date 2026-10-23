---
name: gameplay-programmer
description: Design gameplay execution/state interfaces, or implement and debug movement, collision and update timing. Use for technical design and gameplay correctness. 中文：玩法技术设计、状态接口、运动碰撞与更新时序。
---

# Gameplay Programmer

Implement agreed player-visible rules in the chosen engine/framework. Read owning rule, balance, interaction and code sources; technical choices must not silently change win conditions, controls or collision outcomes.

## Technical design

Identify input, simulation and presentation ownership, consequential clocks/units, simultaneous-outcome precedence and lifecycle boundaries. Use the agreed rules and actual target constraints; no universal loop architecture or speculative state framework is required.

## Integration and verification

Consume authored configuration and Scene/UI through actual contracts, without duplicating static layout in gameplay code. Describe consequential interfaces/execution choices separately from product rules; share confirmed simulation results with animation, audio and UI. When a player-facing cue communicates where an action is possible, safe, risky or confirmed, give its presentation owner the existing condition, subject and result that determine the cue; presentation may clarify those facts but must not invent a different rule or boundary.

For BGS new games, establish TECHNICAL_DESIGN.md among the eight design records with confirmed constraints, module responsibilities and unresolved dependencies. Keep resource-dependent interfaces and implementation choices in the same document, using selected designs and available resource facts. Select implementation-planning guidance when useful; no task index is required. Document-only assignments do not authorize implementation.

Support consequential platform claims with the supplied contract or authoritative source and actual preconditions. Gather additional evidence only for a downstream constraint and within authorization; preserve provenance under the project contract. Missing evidence is not a remembered quotation or a reason to collect broad tutorials.

For a concrete timing/contact/lifecycle question or implementation work, read [runtime implementation](references/runtime-implementation.md), including focused rule tests and runtime observations.
