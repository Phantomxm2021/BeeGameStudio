# Screen Control Contracts

Use these contracts for non-XR game controls. Keep math engine-neutral, but declare the actual forward axis, handedness and angle units before mapping the example to an engine. The profile names describe common choices, not restrictions on other valid control schemes.

## First-Person Grounded

For `first_person_grounded`, separate body yaw from camera pitch.

Contract:
- Pointer or right stick horizontal input changes yaw.
- Pointer or right stick vertical input changes pitch.
- Constrain pitch according to the intended view and engine convention; any example angle is a tuning choice, not a universal requirement.
- `W` or forward input moves along current yaw forward.
- `S` moves along yaw backward.
- `A/D` or left stick X strafes along yaw right/left.
- Ground movement uses yaw only. Do not include pitch in horizontal movement.

Reference math for a +Z-forward, +X-right ground plane, with yaw in radians. These axes must be adapted to the project's actual coordinate system. Preserve analog input magnitude while bounding diagonal input; normalization of every non-zero input would turn a lightly tilted stick into full-speed movement. A deliberately fixed-speed scheme can choose that behavior explicitly.

```js
// forward/right are finite, unit-length, orthogonal ground-plane vectors.
function boundedPlanarMove(forward, right, inputForward, inputRight) {
  const gain = 1 / Math.max(1, Math.hypot(inputForward, inputRight));
  return {
    x: (forward.x * inputForward + right.x * inputRight) * gain,
    y: 0,
    z: (forward.z * inputForward + right.z * inputRight) * gain,
  };
}

const yaw = Math.PI / 2;
const forward = {x: Math.sin(yaw), y: 0, z: Math.cos(yaw)};
const right = {x: Math.cos(yaw), y: 0, z: -Math.sin(yaw)};
const move = boundedPlanarMove(forward, right, 0.1, 0);
```

The result is a requested direction/strength, not collision-resolved motion. Apply the designed speed, input dead zone and actual engine movement facility separately. Handle released input as zero. Do not fabricate a safe projection from a zero-length camera-forward vector.

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

Use a yaw-only ground basis and the same strength-preserving calculation above. If a camera looks nearly straight up/down, its projected forward can approach zero; use the declared stable ground heading rather than normalizing that degenerate vector. Check the basis and analog magnitude after orbiting, not only the apparent camera pose.

## Top-Down Movement

For `top_down_movement`, input usually maps to the screen or world plane.

Contract:
- Up/forward input moves visually upward or toward the declared world forward.
- Left/right input must not swap when the camera angle changes.
- If the camera can rotate, use camera-relative planar axes.
- If the camera is fixed, use stable world axes.
- Independent movement and aiming can use sticks, mouse, touch or another supported input when the design calls for it; the profile label does not determine permission.

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
- Choose rotation limits or damping from the intended control response, not the label "casual" alone.
- Do not use grounded yaw-only assumptions for flight profiles.

## Mobile Touch

For `mobile_touch_virtual_controls`:
- Map the actual touch scheme: for example, one virtual stick for movement and a separate drag/stick for look or aim when present. Do not require sticks for tap-to-move, swipes or direct manipulation.
- Touch zones must not overlap critical UI.
- Movement must remain stable under viewport resize and orientation changes.

For concrete implementation references, [Godot's platformer](https://github.com/godotengine/godot-demo-projects/blob/master/2d/platformer/player/player.gd) preserves axis input through its requested speed, and [Vector2.limit_length](https://docs.godotengine.org/en/stable/classes/class_vector2.html#class-vector2-method-limit-length) illustrates a magnitude bound rather than unconditional normalization. Use the actual engine/version, not its API names in another runtime.
