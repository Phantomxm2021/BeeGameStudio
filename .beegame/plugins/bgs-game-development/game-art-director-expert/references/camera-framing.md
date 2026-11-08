# Diagnose the playable view

Read for an unresolved gameplay framing choice or an observed camera/visibility problem, not every art edit. Art owns the visual relationship; Level owns playable placement, UI its actual play-area allocation, and programming the selected engine's camera/input behavior. XR anchoring and comfort stay with the existing spatial Skills.

Start with the player's relevant decision: what must be visible before commitment, at the consequence and on return to control? Identify the actual camera mode, subject/world scale, viewport and UI allocation. A fixed view may already answer the task; do not add follow, orbit or cinematic motion merely because those systems are available. A deliberately restricted view can be valid when it serves the confirmed experience.

## Locate the cause before moving the camera

| Observed failure | Distinguish using the actual rendered situation | Directed correction |
| --- | --- | --- |
| Destination or threat becomes readable too late | Is it outside the displayed view, behind geometry, covered by UI, or merely low contrast? Observe before the action commits, not only at the authored camera's initial pose. | Adjust the responsible framing, occlusion treatment, composition or cue. Moving the world/collider is not a camera fix. |
| A subject is too small or depth is ambiguous | Inspect silhouette, perspective/orthographic scale, overlap and reference objects at the supported display size. More field of view can reveal space while reducing useful detail. | Preserve the important subject and spatial relationship, not an arbitrary zoom or subject-pixel count. |
| Following feels late, jittery or disorienting | Compare input/simulation target, displayed camera movement and projected subject during start, stop, reversal and a relevant boundary. Separate a noisy target from smoothing, frame-rate dependence or an unintended modifier. | Repair the affected target/update/constraint behavior; do not retune controls or add shake to conceal it. |
| Orbit, lock-on or a temporary effect breaks control | Examine target changes, collision/occlusion, input ownership, pause/retry/reset and return to the base framing. | Use the existing camera's lifecycle and bounds; do not build a second camera state machine. |

For 2D/fixed scenes, check the meaningful approach, landing/interaction region and edge of play. For 3D, include the relevant depth/occlusion or orbit situation; camera collision and input coordinates belong to the chosen engine's implementation. For a building/tabletop scene, judge the selected object together with its footprint, neighbours and confirmation cue. These are relevant situations to select, not tests required for every game.

Retain normal-scale screenshots for composition and a normal-speed passage for moving framing, including the consequential return/reset. Compare the same action, play-area allocation and available seed/save after the authorized correction. Geometry or a still of the starting pose cannot establish comfortable motion. Headless observations cannot establish XR comfort, physical device latency or representative player perception.

For XR, inspect the target platform's [existing spatial guidance](../../spatial-computing-game-expert/references/spatial-rule-architecture.md) and anchoring/input requirements. Do not apply desktop orbit, camera shake or forced head motion to the user's view; a flat screenshot cannot validate world stability or comfort on the device.

Source study: [build-game-camera-controls](https://github.com/satiricalguru/Agents-skills/blob/e049c10be3e23d37345b0c042502bb86ccafa7a1/skills/build-game-camera-controls.md) is a small Three.js-oriented guide covering framing, follow/occlusion and lifecycle checks. Its techniques and test situations are not universal engine requirements. The diagnostic distinctions above are BGS's original synthesis, not evidence that a camera has been validated.
