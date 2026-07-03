---
name: unity-game-architect-expert
description: Use when designing or auditing explicitly Unity-based game architecture, scene/system layering, multiplayer architecture, scalability, performance boundaries, or maintainable runtime structure.
---

# Unity Game Architect Skill Document

## 0. Overview

This skill converts gameplay design into a scalable Unity architecture.

Focus areas:
- System modularity
- Mode isolation
- Networking determinism
- Runtime performance
- Long-term maintainability

---

## 1. Project Layering Strategy

Recommended structure:

/Core
    - GameLoop
    - ModeManager
    - EventBus
/Gameplay
    - Mechanics
    - Abilities
    - Rules
/Networking
    - SyncAdapters
    - StateReplication
    - PredictionLayer
/UI
    - Presentation
    - Controllers
/Data
    - ScriptableObjects
    - Config
/Infrastructure
    - Logging
    - Analytics
    - BuildTools

Strict separation required.

---

## 2. Mode Architecture

Modes must be configuration-driven.

Use:
- ModeConfig ScriptableObjects
- Runtime parameter override
- No branching logic per mode in core classes

---

## 3. Networking Strategy

Define early:

- Authoritative server or host-client?
- Client-side prediction?
- Rollback needed?
- State sync frequency?

Party games often prefer:
- Authoritative host
- Snapshot sync
- Soft reconciliation

---

## 4. Gameplay System Structure

Choose:

OOP → Simpler, good for party games  
ECS → Only if entity count high  

Hybrid recommended.

Core systems:
- InputSystem
- PhysicsLayer
- InteractionResolver
- ScoreSystem

---

## 5. Performance Budgeting

Define:

- Target FPS (60+)
- Network tick rate
- Max player count
- Draw call ceiling
- GC allocation budget

Avoid:
- Per-frame allocations
- Nested Canvas rebuilds
- Heavy Update loops

---

## 6. Scene Strategy

Recommended:

- Bootstrap Scene
- Persistent Systems Scene
- Mode Scene
- Additive loading

Never mix mode-specific logic in bootstrap.

---

## 7. Scalability Planning

Plan for:

- Mode addition
- Seasonal content
- Cross-platform builds
- Addressables integration

---

## 8. Execution Logic

1. Parse design document
2. Extract gameplay systems
3. Map to runtime modules
4. Identify networking requirements
5. Define performance budget
6. Output folder & system blueprint

All outputs must include:
- Folder structure
- Runtime module diagram
- Networking model
- Performance targets
