# XR Locomotion Contracts

Use these contracts for VR, AR, MR, spatial computing, head-tracked, controller, hand, gesture, or room-scale experiences.

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

Reference pattern:

```ts
const basisForward = flattenToGround(selectedBasis.forward);
const basisRight = flattenToGround(selectedBasis.right);
const move = normalize(basisForward * stickY + basisRight * stickX);
xrRig.position += move * speed * dt;
```

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
- Snap turn increments should be comfortable, commonly 30 or 45 degrees.
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

- Prefer teleport and snap turn for broad comfort unless smooth locomotion is specifically requested.
- Avoid forced acceleration, camera shake, roll, and uncontrolled vertical motion.
- Provide recenter/reset when feasible.
- Keep UI readable at comfortable distance and scale.
- Never require physical movement that could collide with real-world obstacles.
