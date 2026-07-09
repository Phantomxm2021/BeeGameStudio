# Interaction Acceptance Checks

Use these checks before declaring a BeeGame playable. Pick the checks matching the selected profile.

## General

- The player can start, move/interact, recover from mistakes, and restart or continue.
- Controls match displayed instructions.
- Input remains stable after camera rotation, viewport resize, pause/resume, and scene reset.
- Controls are not inverted unless the game exposes an intentional inversion setting.
- No required action depends on a hidden developer-only key.

## First-Person Grounded

- At yaw `0`, forward input moves along the declared forward direction.
- After yaw `90` degrees, forward input moves along the new view direction.
- After yaw `180` degrees, forward input moves backward relative to the original direction but forward relative to current view.
- Looking up or down, then pressing forward, does not fly upward, sink, or reverse.
- Lateral input moves left/right relative to current view.

## Third-Person

- Rotating the camera does not swap movement axes.
- Forward input moves toward the camera-planar forward.
- Avatar facing, movement, and camera follow remain coherent.
- Camera collision or zoom does not invert controls.

## Top-Down

- Up/down/left/right inputs match the visual plane.
- If the camera rotates, movement follows the declared camera-relative or world-relative rule consistently.
- Aiming and movement are independent only for twin-stick profiles.

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
