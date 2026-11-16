# Screen Control Contracts

Profiles: [First person](#first-person-grounded) · [Third person](#third-person-follow-or-orbit) · [Top-down](#top-down-movement) · [Side-scroller](#side-scroller-platformer) · [Vehicle](#vehicle-forward-steer) · [Flight](#flight-and-six-dof) · [Touch](#mobile-touch).

Use these contracts for non-XR controls, adapting forward axes, handedness and units to the actual engine. Resolve the movement basis from confirmed design, control definitions and instructions, not camera mobility or a profile label. Infer it only where those sources determine the mapping. When several mappings remain valid, authorized first-time design may choose one in the existing control definition; diagnosis retains the unresolved expectation instead of substituting camera-relative movement. Existing behavior identifies the implementation, not its correctness. Profile examples below apply only to the corresponding chosen mapping.

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
- Use the chosen movement basis. For camera-relative movement, map forward/lateral input through the ground-plane camera basis.
- For tank controls, forward/back follows avatar heading and lateral input turns; other schemes retain their defined mapping.
- Camera orbit preserves those directional meanings rather than choosing a different basis.
- Camera pitch does not tilt ground movement.
- Camera collision or zoom must not invert controls.

Apply the chosen ground-plane basis and the strength-preserving calculation above. For a camera-relative scheme, a nearly vertical view can make projected forward degenerate; use its declared stable ground heading rather than normalizing zero. Check the applicable basis and analog magnitude after orbiting, not only the apparent camera pose.

## Top-Down Movement

For `top_down_movement`, input usually maps to the screen or world plane.

Contract:
- Map forward/back and lateral input through the chosen screen/camera-relative or world-relative plane.
- Camera-relative axes follow the projected view; world-relative axes retain their world basis whether the camera is fixed or rotates.
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
