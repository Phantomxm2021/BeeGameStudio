---
name: unity-performance
description: Use when optimizing or auditing explicitly Unity performance, profiling bottlenecks, reducing garbage collection, improving frame rate, pooling objects, or tuning rendering, physics, memory, or script cost.
---

# Unity Performance Optimization

## Core Philosophy

1. Measure first (Profiler)
2. Remove allocations in hot paths
3. Cache everything expensive
4. Replace Instantiate/Destroy with Pooling
5. Prefer event-driven over polling

---

## 1️⃣ Caching Strategy

**Never in Update():**

* GetComponent
* Find
* string concatenation
* new List/Array
* Raycast (unless required)

### Rule

* Cache Transform
* Cache GetComponent in Awake
* Cache layerMask
* Cache WaitForSeconds
* Cache Material reference

---

## 2️⃣ Object Pooling Pattern

Use pooling for:

* Bullets
* Enemies
* UI elements
* Effects
* AudioSources

Pattern:

* Prewarm
* Activate/Deactivate
* No Destroy in runtime loop

---

## 3️⃣ GC Reduction

Avoid allocations in:

* Update
* FixedUpdate
* Coroutines

Replace:

| Bad                | Replace With        |
| ------------------ | ------------------- |
| new List()         | Reused list + Clear |
| string + int       | StringBuilder       |
| ToArray()          | Direct iteration    |
| new WaitForSeconds | Cached instance     |

---

## 4️⃣ Update Loop Strategy

Replace:

* Frame polling → Event-driven
* Per-frame checks → Timed checks
* Always-active Update → Conditional Update

Prefer:

* InvokeRepeating
* Coroutine loops
* Event callbacks

---

## 5️⃣ Physics Optimization

* Use Layer Collision Matrix
* Use LayerMask in Raycast
* Disable unnecessary collisions
* Let Rigidbody sleep

---

## 6️⃣ Profiling Workflow

1. Identify spike
2. Drill into call stack
3. Record baseline
4. Optimize
5. Re-measure

Target (60 FPS):

| System    | Budget |
| --------- | ------ |
| Rendering | 6ms    |
| Scripts   | 4ms    |
| Physics   | 2ms    |
| UI        | 1ms    |

---

## 7️⃣ Platform Focus

### Mobile

* Reduce draw calls
* Lower texture resolution
* Disable heavy shadows
* Reduce particle count

### PC

* Maintain 60 FPS baseline
* Monitor VRAM
* Test on minimum spec
