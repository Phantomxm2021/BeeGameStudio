# Screen Control Contracts

Use these contracts for non-XR game controls. Keep math engine-neutral.

## First-Person Grounded

For `first_person_grounded`, separate body yaw from camera pitch.

Contract:
- Pointer or right stick horizontal input changes yaw.
- Pointer or right stick vertical input changes pitch.
- Clamp pitch, commonly between `-85` and `85` degrees.
- `W` or forward input moves along current yaw forward.
- `S` moves along yaw backward.
- `A/D` or left stick X strafes along yaw right/left.
- Ground movement uses yaw only. Do not include pitch in horizontal movement.

Reference math:

```ts
const forward = normalize(vec3(Math.sin(yaw), 0, Math.cos(yaw)));
const right = normalize(vec3(Math.cos(yaw), 0, -Math.sin(yaw)));
const move = normalize(forward * inputForward + right * inputRight);
```

Common failures:
- Using full camera quaternion for ground movement, causing look-up/look-down movement errors.
- Moving on world axes after the camera rotates.
- Swapping `A` and `D`.
- Updating the camera yaw visually but using stale yaw for movement.
- Applying pitch to the player body instead of the camera/head child.

## Third-Person Follow Or Orbit

For `third_person_follow` or `third_person_orbit`, the avatar and camera can have different orientations.

Contract:
- Movement intent is camera-relative unless the game explicitly uses tank controls.
- Forward input moves the avatar toward camera-planar forward.
- Lateral input moves or rotates according to the declared movement model.
- Camera orbit changes view direction without instantly corrupting movement axes.
- Camera pitch does not tilt ground movement.
- Camera collision or zoom must not invert controls.

Use yaw-only camera basis for grounded movement:

```ts
const cameraForwardFlat = normalize(projectOnGround(cameraForward));
const cameraRightFlat = normalize(projectOnGround(cameraRight));
const move = normalize(cameraForwardFlat * inputForward + cameraRightFlat * inputRight);
```

## Top-Down Movement

For `top_down_movement`, input usually maps to the screen or world plane.

Contract:
- Up/forward input moves visually upward or toward the declared world forward.
- Left/right input must not swap when the camera angle changes.
- If the camera can rotate, use camera-relative planar axes.
- If the camera is fixed, use stable world axes.
- Aiming and movement may be independent only when the profile is `top_down_twin_stick`.

## Side-Scroller Platformer

For `side_scroller_platformer`, controls are lane/plane constrained.

Contract:
- Left/right input changes horizontal velocity on the gameplay axis.
- Jump affects vertical velocity, not camera pitch.
- Camera following must not change left/right semantics.
- Character facing should follow intended movement or aim, not camera jitter.

## Vehicle Forward Steer

For `vehicle_forward_steer`, input controls throttle/brake and steering, not strafing.

Contract:
- Forward input increases throttle along vehicle forward.
- Back input brakes or reverses according to the design.
- Left/right input steers relative to vehicle heading.
- Camera orbit must not invert steering.
- Physics velocity and visual heading should converge unless drifting is intentional.

## Flight And Six-DOF

For `flight_arcade`, pitch can affect movement because the vehicle flies.

For `six_dof_flight`, translation and rotation can be fully independent.

Contract:
- State whether forward thrust follows vehicle nose, camera forward, or aim reticle.
- State whether roll affects steering.
- Clamp or damp rotation if the game is casual.
- Do not use grounded yaw-only assumptions for flight profiles.

## Mobile Touch

For `mobile_touch_virtual_controls`:
- Left virtual stick controls movement or steering.
- Right drag or stick controls look/aim when present.
- Touch zones must not overlap critical UI.
- Movement must remain stable under viewport resize and orientation changes.
