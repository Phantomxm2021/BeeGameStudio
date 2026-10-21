# XR Locomotion Contracts

Use these contracts for VR, AR, MR, spatial computing, head-tracked, controller, hand, gesture, or room-scale experiences.

Choose the actual platform and runtime first. Read the applicable [Apple, Meta and Unity source guidance](../../spatial-computing-game-expert/references/spatial-rule-architecture.md); those platforms' input APIs, permissions and locomotion facilities are not interchangeable.

## XR Rig Model

Separate these transforms:
- `world/root`: stable app or scene coordinate space.
- `xrRig/origin`: virtual locomotion root.
- `head/camera`: tracked headset pose.
- `leftController` and `rightController`: tracked controller poses.
- `hands`: tracked hand joints or gestures.

Do not rotate or translate the tracked camera directly for locomotion. Move or rotate the rig/root according to the selected locomotion profile.

## Head-Tracked Stationary

For `xr_head_tracked_stationary`:
- User physical head pose controls view.
- App should not add artificial camera yaw/pitch.
- Interactions happen through gaze, controller rays, hands, or near-field grabs.
- Keep comfort high: no forced camera movement without explicit design.

## Smooth Locomotion

For `xr_smooth_locomotion`, state the movement basis:
- head-yaw-relative
- controller-forward-relative
- rig-forward-relative

Contract:
- Ground movement should use horizontal yaw only unless the experience intentionally supports flying.
- Do not include head pitch in walking direction.
- Acceleration, maximum speed, and turn rate should be comfort-aware.
- Moving while looking down must not move the player into the floor or reverse direction.

Use a finite orthonormal ground basis and a strength-preserving input bound, as illustrated in [screen controls](screen-controls.md). Looking vertically can make a projected basis degenerate; use the declared stable heading rather than normalizing zero. Fixed-speed or quantized locomotion is an explicit design choice, not an accidental consequence of normalization. Apply requested motion through the runtime's actual collision and locomotion facility, not an unchecked direct rig translation. For Unity XRI, consult the installed package's providers and XR Origin handling.

## Teleport Locomotion

For `xr_teleport_locomotion`:
- Controller ray or gaze selects a destination.
- Validate target surface, bounds, slope, collision clearance, and gameplay area.
- Show preview arc/marker before committing.
- Teleport moves the rig/origin, not the tracked camera.
- Preserve or explicitly set post-teleport facing direction.
- Never teleport through locked geometry or outside the play area.

## Snap Or Smooth Turn

For `xr_snap_turn` or smooth turn:
- Rotate the rig/origin around the current head position projected to the floor.
- Do not rotate only the camera.
- Choose snap increments and repeat/cancellation behavior from the target experience and user options; an example angle is not a comfort guarantee.
- Smooth turn needs tunable speed and should be optional if comfort matters.

## Room-Scale MR

For `mr_room_scale`:
- Physical user movement and virtual rig movement are separate.
- Interactables should respect safe reach zones.
- Do not place required interactions outside likely play bounds unless locomotion is available.
- Room anchors and detected surfaces should be treated as dynamic and revalidated.

## AR World Anchors

For `ar_world_anchored`:
- Virtual objects must remain stable relative to detected planes, anchors, images, or geospatial anchors.
- Do not parent world-anchored objects to the camera.
- Reconcile tracking loss gracefully without snapping objects unexpectedly.
- Touch/ray interactions should preserve anchor transforms unless the user intentionally moves the object.

## XR Comfort And Safety

- Consider teleport and snap turn as comfort options under the relevant platform guidance, while preserving the agreed game interaction and user preferences. They do not guarantee comfort and can introduce disorientation.
- Avoid forced acceleration, camera shake, roll, and uncontrolled vertical motion.
- Provide recenter/reset when feasible.
- Keep UI readable at comfortable distance and scale.
- Never require physical movement that could collide with real-world obstacles.
