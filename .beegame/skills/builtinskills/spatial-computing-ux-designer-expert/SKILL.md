---
name: spatial-computing-ux-designer-expert
description: Use when designing or auditing XR, AR, MR, or spatial-computing interfaces involving depth layering, spatial gestures, cognitive load, comfort, or 3D interaction ergonomics.
---

# Spatial UX Designer Skill

## Core Mission

Design spatial interaction systems that feel natural, ergonomic, and cognitively clear.

Output must include:
- Interaction Model
- Depth Layer Structure
- Gesture Mapping
- Spatial Layout Rules
- Cognitive Load Constraints
- Safety & Comfort Guidelines

---

## 1️⃣ Interaction Model

Define primary control method:

- Gaze + Pinch
- Hand Tracking
- Controller-based
- Voice-assisted

Avoid mixing control paradigms without hierarchy.

---

## 2️⃣ Spatial Layout Zones

Divide space into:

- Near Zone (0.3m – 0.6m)
- Mid Zone (0.6m – 1.5m)
- Far Zone (1.5m+)

Rules:
- Critical UI → Mid Zone
- Temporary prompts → Near Zone
- Ambient info → Far Zone

Never anchor important UI too close to face.

---

## 3️⃣ Depth Layer Structure

Must define:

- Primary Interaction Layer
- Secondary Information Layer
- Background Context Layer

UI should not stack infinitely in Z-axis.

Max 3 active depth layers.

---

## 4️⃣ Gesture Mapping

Gestures must follow:

- Natural hand resting position
- Minimal sustained elevation
- No complex finger choreography

Avoid:
- Long hold gestures
- Precision micro-gestures

---

## 5️⃣ Movement & Stability

Avoid:

- Rapid UI movement
- Sudden depth shifts
- Floating UI drift

Use:
- World-anchored panels
- Subtle motion easing

---

## 6️⃣ Cognitive Load Control

Limit:

- Concurrent floating elements
- Bright flashing elements
- Competing spatial anchors

Rule:
One focal point at a time.

---

## 7️⃣ Comfort & Safety

Must consider:

- Arm fatigue
- Neck rotation angle
- Eye convergence distance
- Motion sickness triggers

Avoid:
- UI behind user
- Fast camera-driven movement

---

## 8️⃣ Platform Adaptation

If Vision Pro:
- Prefer gaze + subtle hand gesture
- Preserve real-world passthrough clarity

If Quest:
- Controller-first optional
- Clear hand pose detection feedback

If MR:
- Blend UI with real surfaces
- Use environmental anchors

---

## Execution Flow

1. Read product & gameplay
2. Define interaction paradigm
3. Map to spatial zones
4. Design depth hierarchy
5. Evaluate ergonomic stress
6. Output constraint-based spatial UX system

Never design flat UI in 3D space.
Always design interaction around body comfort.

## Reference Files

Load only when the task needs extra detail:
- `references/spatial-interaction-principles.md` for spatial input and interaction rules.
- `references/depth-layering-framework.md` for depth hierarchy and layout zones.
- `references/gesture-ergonomics-model.md` for gesture comfort and fatigue limits.
- `references/spatial-cognitive-load-system.md` for focus, attention, and load constraints.
