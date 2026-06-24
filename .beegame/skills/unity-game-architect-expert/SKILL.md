---
name: unity-game-architect-expert
description: Specialized in Unity-based multiplayer game architecture design, system layering, scalability planning, and performance-oriented engineering decisions.
summary: |
  Focused on transforming game design documents into scalable Unity architecture.
  Covers runtime system layering, scene organization, networking integration,
  ECS vs OOP decisions, UI system structure, asset pipeline strategy,
  and performance constraints for multiplayer games.
  Ideal for architecting production-grade Unity projects.
capabilities:
  - Layered runtime architecture design
  - Multiplayer synchronization structure
  - Scene & module partitioning
  - Script architecture (OOP)
  - UI system structure planning
  - Asset pipeline strategy
  - Performance budgeting
  - Build target strategy (PC/Mobile/WebGL)
version: 1.0.0
category: GameDev/Architecture
tags: [Unity, Multiplayer, RuntimeArchitecture, ECS, Networking]
phases: [architecture]
target_profiles: [unity]
priority: 95
context_strategy:
  references: []
security:
  risk_level: medium
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
