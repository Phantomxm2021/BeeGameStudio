---
name: beegame-interaction-contracts
description: Use for player controls, camera-relative movement, input mapping, touch, gamepad, or XR interaction across game perspectives. 中文：角色移动、镜头控制、手柄、触控、空间交互。
---

# BeeGame Interaction Contracts

Use the relevant guidance when implementing or modifying player interaction. BeeGame is a general game studio, so choose an interaction profile from product intent, not from platform keywords alone. This reference does not impose a delivery phase or a fixed report format.

## Choosing the relevant interaction model

1. Identify the interaction profile from the game spec:
   - `dimension`, `cameraPerspective`, `movementModel`, `inputScheme`, `primaryInteraction`, `targetDevice`, `xrMode`, or equivalent structured fields.
   - If fields are missing, infer from mechanics and camera behavior, then state the inferred profile in the implementation notes.
2. Read only the reference that matches the task:
   - Screen, keyboard, mouse, gamepad, touch, first-person, third-person, top-down, side-scroller, vehicle, or flight: read `references/screen-controls.md`.
   - VR, AR, MR, spatial computing, head/controller/hand input, teleport, snap turn, room-scale, anchors: read `references/xr-locomotion.md`.
   - For playability acceptance, read `references/interaction-acceptance.md`.
3. Implement the intended control semantics using the project's chosen engine or framework, then check the affected input path in play.

## Universal Contract

- Controls must match the active camera and movement model.
- Movement axes must be stable after camera rotation.
- Do not hard-bind behavior to one engine, framework, renderer, or platform.
- Do not use prompt text keyword matching as logic. Use structured metadata, gameplay intent, or explicit control configuration.
- Keep view orientation, player/body orientation, and movement direction as separate concepts when the profile needs them.
- For horizontal ground movement, remove vertical pitch/roll from the movement vector unless the profile explicitly supports flight or six-degree freedom motion.
- Define only the actions this game actually offers; verify the player's primary action, recovery path, and applicable pause/accessibility controls.

## Profile Selection

These profile names can help describe a control scheme; they are not a required output format:

- `side_scroller_platformer`
- `top_down_movement`
- `top_down_twin_stick`
- `third_person_follow`
- `third_person_orbit`
- `first_person_grounded`
- `vehicle_forward_steer`
- `flight_arcade`
- `six_dof_flight`
- `mobile_touch_virtual_controls`
- `xr_head_tracked_stationary`
- `xr_smooth_locomotion`
- `xr_teleport_locomotion`
- `xr_snap_turn`
- `ar_world_anchored`
- `mr_room_scale`

If multiple profiles apply, define the primary locomotion profile and secondary interaction profile separately.

## Failure Policy

If a control defect prevents the intended action—such as reversed movement, camera-relative drift, invalid teleport, or unstable anchor—treat that behavior as a playability bug. Do not broaden a focused control fix into unrelated content work.
