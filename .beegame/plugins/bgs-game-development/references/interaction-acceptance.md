# Interaction diagnosis

Use the relevant [control contracts](screen-controls.md) and their movement-basis conditions to diagnose the assigned problem.

## General

- Controls match displayed instructions.
- For camera, viewport or lifecycle-related input faults, inspect the mapping across the affected change.
- When analog strength is part of the design, a light stick input remains weaker than full input, diagonal input respects the intended limit, and release stops the requested movement. Test camera headings and degenerate planar projections where applicable.
- Controls are not inverted unless the game exposes an intentional inversion setting.
- No required action depends on a hidden developer-only key.

## First-Person Grounded

- At yaw `0`, forward input moves along the declared forward direction.
- After yaw `90` degrees, forward input moves along the new view direction.
- After yaw `180` degrees, forward input moves backward relative to the original direction but forward relative to current view.
- Looking up or down, then pressing forward, does not fly upward, sink, or reverse.
- Lateral input moves left/right relative to current view.

## Third-Person

- Forward/back movement and lateral movement/turning match the chosen control basis across relevant camera poses.
- Avatar facing, movement, and camera follow remain coherent.
- Camera collision or zoom does not invert controls.

## Top-Down

- Directional input matches the chosen planar basis across relevant camera poses, rather than an assumed screen-relative mapping.
- Independent aiming and movement follow the actual declared input scheme; mouse, touch and other valid schemes are not rejected because of a profile name.

## Side-Scroller

- Left and right are stable regardless of camera follow.
- Jump does not depend on camera orientation.
- Landing, ledge, and slope behavior do not flip horizontal intent.

## Vehicle Or Flight

- Steering remains vehicle-relative after camera orbit.
- Throttle and brake semantics are consistent.
- Flight thrust follows the declared basis: vehicle nose, camera, or reticle.

## XR

- Head pose controls view; locomotion moves the rig/root, not the tracked camera directly.
- Smooth locomotion uses the declared basis and flattens walking movement to the ground.
- Snap turn rotates around the user/head floor position.
- Teleport validates target and preserves/sets facing direction intentionally.
- AR/MR anchored objects remain stable when the camera moves.
- Comfort defaults avoid forced roll, shake, uncontrolled acceleration, and unexpected camera motion.
