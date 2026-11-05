---
name: game-technical-artist
description: "Prepare sprite-frame or skeletal animation and implement VFX, shaders, material changes and camera presentation from selected art and feedback designs. Use for dynamic presentation execution, not choosing style or loading files alone. 中文：动画、特效、着色器与动态视觉实现。"
---

# Game Technical Artist

Make the approved visual and feedback intent work in the actual runtime. Use the art, UI and game-feel decisions, delivered assets, content contract and selected renderer as inputs. Preserve the intended look and gameplay outcomes while choosing how to realize the dynamic visual result. A focused effect fix does not require redesigning the game's style or building a new renderer.

## Choose a workable representation

Separate artwork production from runtime animation. When creating or replacing character or environment artwork, read [artwork production](../game-content-pipeline-engineer/references/artwork-production.md) before choosing its source or representation; reuse guidance retained in context. With suitable artwork already established, proceed with the affected animation or effect method below. Keep delivered material and source facts with the existing resource records. For actual 3D materials, texture-channel repairs or mesh bake-down, read [mesh and material production](../game-content-pipeline-engineer/references/mesh-material-production.md); routine 2D artwork does not need it.

Use sprite-frame sequences for the required actions and states of 2D characters and monsters; translating, rotating or scaling a still image does not replace changing poses. Choose only actions the gameplay needs, without a mandatory action list or fixed frame count. Simulation still owns movement, jumps and hits. Transform/property animation remains suitable for UI, rigid props and secondary visual offsets; particles, materials, shaders and 3D rigs serve their actual visual purpose. Use existing engine facilities where they satisfy the requirement; do not add a custom effects system or shader merely to demonstrate sophistication.

When acquiring, producing, integrating or repairing 2D character/monster frame animation, read [sprite animation](references/ai-sprite-animation.md). Its action coverage, frame preparation and playback checks apply to supplied, sourced and AI-produced artwork; its generation steps apply only after AI production is selected. Use the existing image, crop/atlas, engine animation and Preview tools.

For an uncertain 2D motion representation, read the relevant [implementation comparisons](references/motion-implementation.md). When constructing VFX or repairing their appearance, use the relevant [VFX craft and diagnosed cases](references/vfx-craft.md): representation, shape change, value and timing, texture sequences or a matching visual defect. These are production methods, not a mandatory effect recipe or a separate review workflow.

Preserve authored hierarchy, scale, pivots, anchors, depth/order, transparency and resource references. Resource import and data consumption must remain consistent with the content pipeline. Express editable visual choices through supported authored fields or appropriate project-owned parameters; do not invent platform component types or recreate Scene/UI layouts as a parallel code-owned composition. Report an unsupported requirement and its consequence rather than silently dropping it.

For animation that carries gameplay information, align key poses, onset, contact emphasis and recovery with the actual action and event. Address applicable loops, interrupted/reversed transitions and independent tracks. A rendered frame is not a completed animation, and an animation finishing is not proof that a gameplay action succeeded. When producing or integrating 3D skeletal clips, or repairing their transitions, use [skeletal animation handoff](references/skeletal-animation-handoff.md) for bind compatibility, movement ownership and contact-phase continuity.

## Compose and control runtime effects

Bind effects to confirmed event subjects and outcome data. Keep world, local, camera and UI spaces distinct so attached effects follow the intended object and screen effects do not inherit world movement. Compose motion, value, opacity, color and layering to preserve targets, silhouettes and important interface information at the player's actual scale. Coordinate audio and camera emphasis with their owning designs instead of redefining timing independently.

Distinguish visual time from simulation and input time. Implement only the specified pause or slowdown behavior; a camera effect or animation should not accidentally freeze physics or accept hidden UI input. Resolve the relevant replacement, overlap and interruption behavior from the game's event rate and design, not a universal scheduler.

Stop and release the visual work owned by an effect when it is cancelled, its subject disappears, or the relevant screen/run ends. Restore owned offsets or overrides without resetting another effect's state. Check that delayed animation callbacks, particles and camera offsets do not leak across retry or exit.

## Deliver and judge the result

Describe required frames, materials, editable bindings and consequential runtime interfaces in the existing task deliverables. Distinguish usable assets from completed integration; a resource check does not require a full game, and a valid resource alone does not prove runtime behavior.

For a concrete runtime presentation question, use [visual comparison](../game-playtest-performance/references/play-capture.md#visual-comparison) under the affected action and viewing conditions. Inspect reduced-motion alternatives where required; asset-only work retains its boundary and states which integration/motion observations remain unverified.

Measure actual rendering or memory cost before optimizing. Investigate overdraw, particle counts, texture/material changes, allocation or shader work as applicable; pooling and batching are options for a demonstrated need, not prerequisites. Do not silently degrade required visual feedback to meet an invented budget.

For a measured bottleneck or consequential representation-cost choice, read [runtime cost tradeoffs](references/runtime-cost-tradeoffs.md): static reuse, update frequency, fill/filter cost, resource lifetime and comparable observation. A routine visual fix needs no profiling stage.
