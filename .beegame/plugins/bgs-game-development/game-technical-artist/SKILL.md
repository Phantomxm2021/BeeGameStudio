---
name: game-technical-artist
description: "Implement or repair animation playback, VFX, materials and camera presentation from adopted visual goals. Use for missing dynamic behavior, frame/state playback, effect lifetime or rendering defects; asset sourcing and file preparation use the content pipeline. 中文：动画播放、动态表现、材质与镜头实现修订。"
---

# Game Technical Artist

Make the approved visual and feedback intent work in the actual runtime. Use the art, UI and game-feel decisions, delivered assets, content contract and selected renderer as inputs. Preserve the intended look and gameplay outcomes while choosing how to realize the dynamic visual result. A focused effect fix does not require redesigning the game's style or building a new renderer.

## Choose a workable representation

Start from the intended visible result and delivered resources. If an implementation needs new or changed artwork, use [artwork production](../game-content-pipeline-engineer/references/artwork-production.md) for its acquisition and preparation; with suitable resources already present, work on the affected runtime behavior. Keep file facts in existing resource records. For actual 3D material/texture or mesh repairs, use [mesh/material production](../game-content-pipeline-engineer/references/mesh-material-production.md); routine 2D work does not need it.

Choose the representation from the intended visible change and the selected renderer, rather than the material category. Static regions, state variants, frame sequences, transforms, particles, materials and rigs serve different needs. Transform/property animation can supply a required rigid change but cannot create missing drawn detail or deformation. Simulation still owns movement and gameplay outcomes. Use existing engine facilities where they satisfy the requirement; do not add a custom effects system or shader merely to demonstrate sophistication.

For a spritesheet/atlas consumption or frame-preparation question encountered in this work, use the shared [sheet method](references/spritesheet-production.md). For character-specific identity or pose construction, use [character animation](references/ai-sprite-animation.md); effect construction uses the VFX reference below. These methods apply only to the affected material and do not assign every resource job to technical art.

For an uncertain 2D motion representation, read the relevant [implementation comparisons](references/motion-implementation.md). When constructing VFX or repairing their appearance, use the relevant [VFX craft and diagnosed cases](references/vfx-craft.md): representation, shape change, value and timing, texture sequences or a matching visual defect. These are production methods, not a mandatory effect recipe or a separate review workflow.

Preserve authored hierarchy, scale, pivots, anchors, depth/order, transparency and resource references. Resource import and data consumption must remain consistent with the content pipeline. Keep hierarchy and editable visual parameters in the selected runtime's existing scene, material or configuration sources. Report an unsupported requirement and its consequence rather than silently dropping it.

For animation that carries gameplay information, align key poses, onset, contact emphasis and recovery with the actual action and event. Address applicable loops, interrupted/reversed transitions and independent tracks. A rendered frame is not a completed animation, and an animation finishing is not proof that a gameplay action succeeded. When producing or integrating 3D skeletal clips, or repairing their transitions, use [skeletal animation handoff](references/skeletal-animation-handoff.md) for bind compatibility, movement ownership and contact-phase continuity.

## Compose and control runtime effects

Bind effects to confirmed event subjects and outcome data. Keep world, local, camera and UI spaces distinct so attached effects follow the intended object and screen effects do not inherit world movement. Compose motion, value, opacity, color and layering to preserve targets, silhouettes and important interface information at the player's actual scale. Coordinate audio and camera emphasis with their owning designs instead of redefining timing independently.

Distinguish visual time from simulation and input time. Implement only the specified pause or slowdown behavior; a camera effect or animation should not accidentally freeze physics or accept hidden UI input. Resolve the relevant replacement, overlap and interruption behavior from the game's event rate and design, not a universal scheduler.

Stop and release the visual work owned by an effect when it is cancelled, its subject disappears, or the relevant screen/run ends. Restore owned offsets or overrides without resetting another effect's state. Check that delayed animation callbacks, particles and camera offsets do not leak across retry or exit.

## Presentation diagnosis

For a concrete motion or appearance problem, [visual comparison](../game-playtest-performance/references/play-capture.md#visual-comparison) explains relevant viewing conditions. Preserve required reduced-motion alternatives.

Measure actual rendering or memory cost before optimizing. Investigate overdraw, particle counts, texture/material changes, allocation or shader work as applicable; pooling and batching are options for a demonstrated need, not prerequisites. Do not silently degrade required visual feedback to meet an invented budget.

For a measured bottleneck or consequential representation-cost choice, read [runtime cost tradeoffs](references/runtime-cost-tradeoffs.md): static reuse, update frequency, fill/filter cost, resource lifetime and comparable observation. A routine visual fix needs no profiling stage.
