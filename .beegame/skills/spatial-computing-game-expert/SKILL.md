---
name: spatial-computing-game-expert
description: Use when designing or auditing XR, AR, MR, or spatial-computing gameplay involving embodied interaction, room-scale constraints, physical safety, ergonomic pacing, or spatial rules.
---

# Spatial Game Designer Skill

## Core Mission

Design gameplay systems that are built around body movement,
real-world space constraints, and spatial interaction logic.

Never design screen-first mechanics.
Always design body-first systems.

Output must include:
- Core Embodied Loop
- Spatial Rule System
- Movement Envelope
- Interaction Reach Model
- Session Structure
- Safety Constraints

---

## 1️⃣ Embodied Core Loop

Define loop in physical terms:

Observe → Reach → Manipulate → Feedback → Reset

NOT:
Click → Cooldown → UI update

Each step must map to a physical gesture or spatial action.

---

## 2️⃣ Spatial Rule Architecture

Rules must account for:

- Player physical position
- Object distance
- Field of view limits
- Real-world obstacles

Avoid rules that require:
- Instant 180° reaction
- Behind-the-back interaction
- High-speed forced camera motion

---

## 3️⃣ Movement Envelope

Define:

- Standing-only or seated?
- 180° or 360° interaction?
- Required room size?
- Minimum safe play area?

Never assume large free space.

Must support constrained environments.

---

## 4️⃣ Interaction Reach Model

Define interaction zones:

- Near Reach (0.3–0.6m)
- Comfortable Reach (0.6–1.2m)
- Extended Reach (1.2m+)

Core interaction must occur within comfortable reach.

Avoid repeated overhead actions.

---

## 5️⃣ Physical Cost Budget

Define:

- Max sustained arm lift time
- Max repetition frequency
- Required body rotation per minute

Gameplay intensity must respect fatigue thresholds.

---

## 6️⃣ Spatial Session Pacing

Spatial sessions should:

- Include micro-rest moments
- Avoid constant high engagement
- Use spatial calm zones

Recommended:
5–15 minute loops for active gameplay.

---

## 7️⃣ Feedback System

Feedback must include:

- Spatial audio direction
- Depth-based highlight
- Physical object reaction

Avoid heavy UI overlays.

Feedback must feel physically grounded.

---

## 8️⃣ Safety Framework

Must evaluate:

- Collision risk
- Rapid head movement
- Depth discomfort
- Motion sickness triggers

Never:
- Force player locomotion artificially
- Snap camera aggressively

---

## 9️⃣ Platform Adaptation

If Vision Pro:
- Minimal forced locomotion
- Use gaze-based targeting

If Quest:
- Support controller fallback
- Clear boundary detection

If MR:
- Anchor gameplay to real surfaces
- Respect environmental geometry

---

## Execution Flow

1. Read product definition
2. Define embodied interaction loop
3. Define spatial constraints
4. Design movement envelope
5. Validate ergonomic cost
6. Output constraint-based gameplay system

Never port flat mechanics directly.
Always redesign around body and space.

## Reference Files

Load only when the task needs extra detail:
- `references/spatial-interaction-principles.md` for embodied interaction rules.
- `references/spatial-rule-architecture.md` for spatial gameplay rule systems.
- `references/spatial-session-pacing.md` for fatigue-aware session pacing.
- `references/physical-safety-framework.md` for collision, comfort, and safety checks.
