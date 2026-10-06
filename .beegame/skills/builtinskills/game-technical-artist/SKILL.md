---
name: game-technical-artist
description: Implement or repair real-time game animation, VFX, materials, shaders and camera presentation against art and feedback designs. Use for dynamic visual execution, not art direction or resource loading alone. 中文：技术美术、动画制作、特效实现、材质着色器、镜头表现、动态视觉。
---

# Game Technical Artist

Make the approved visual and feedback intent work in the actual runtime. Use the art, UI and game-feel decisions, delivered assets, content contract and selected renderer as inputs. Preserve the intended look and gameplay outcomes while choosing how to realize the dynamic visual result. A focused effect fix does not require redesigning the game's style or building a new renderer.

## Choose a workable representation

Choose sprite frames, transform/property animation, procedural drawing, particles, materials, shaders or rigged animation by the actual visual purpose and supported technology. A simple shape or restrained tween may be sufficient. Use existing engine facilities where they satisfy the requirement; do not add a custom effects system or shader merely to demonstrate sophistication.

Preserve authored hierarchy, scale, pivots, anchors, depth/order, transparency and resource references. Resource import and data consumption must remain consistent with the content pipeline. Express editable visual choices through supported authored fields or appropriate project-owned parameters; do not invent platform component types or recreate Scene/UI layouts as a parallel code-owned composition. Report an unsupported requirement and its consequence rather than silently dropping it.

For animation that carries gameplay information, align key poses, onset, contact emphasis and recovery with the actual action and event. Address applicable loops, blending, interrupted/reversed transitions and independent tracks. A rendered frame is not a completed animation, and an animation finishing is not proof that a gameplay action succeeded. Use rigs, skinning or retargeting only when the project's assets need them.

## Compose and control runtime effects

Bind effects to confirmed event subjects and outcome data. Keep world, local, camera and UI spaces distinct so attached effects follow the intended object and screen effects do not inherit world movement. Compose motion, value, opacity, color and layering to preserve targets, silhouettes and important interface information at the player's actual scale. Coordinate audio and camera emphasis with their owning designs instead of redefining timing independently.

Distinguish visual time from simulation and input time. Implement only the specified pause or slowdown behavior; a camera effect or animation should not accidentally freeze physics or accept hidden UI input. Resolve the relevant replacement, overlap and interruption behavior from the game's event rate and design, not a universal scheduler.

Stop and release the visual work owned by an effect when it is cancelled, its subject disappears, or the relevant screen/run ends. Restore owned offsets or overrides without resetting another effect's state. Check that delayed animation callbacks, particles and camera offsets do not leak across retry or exit.

## Deliver and judge the result

Describe required frames, materials, editable bindings and consequential runtime interfaces in the existing task deliverables. Distinguish usable assets from completed integration; a resource check does not require a full game, and a valid resource alone does not prove runtime behavior.

When the runtime is available, inspect meaningful moments and the motion between them in the complete composition, including applicable repeated events and cancellation. Judge continuity, contact alignment, readability and visual intent, not just file validity or successful effect invocation. Inspect supported scale/input conditions and reduced-motion alternatives where required. If only assets or static previews exist, state which integration and motion checks remain unverified.

Measure actual rendering or memory cost before optimizing. Investigate overdraw, particle counts, texture/material changes, allocation or shader work as applicable; pooling and batching are options for a demonstrated need, not prerequisites. Do not silently degrade required visual feedback to meet an invented budget.
