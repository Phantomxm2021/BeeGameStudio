---
name: beegame-interaction-contracts
description: "Choose or fix how keyboard, pointer, touch, gamepad or XR input maps to player actions and camera-relative movement. Use for control semantics and feasibility; collision and rule execution belong to the selected runtime implementation. 中文：设备到动作映射、镜头相对控制与输入可行性。"
---

# BeeGame Interaction Contracts

Use the relevant guidance for control implementation, diagnosis or a concrete input-feasibility question. Choose an interaction profile from product intent, not platform keywords alone. Resolve only the assigned question; this reference does not authorize implementation in a design-only task or impose a delivery phase/report format.

## Choosing the relevant interaction model

1. Identify the interaction profile from the game spec:
   - `dimension`, `cameraPerspective`, `movementModel`, `inputScheme`, `primaryInteraction`, `targetDevice`, `xrMode`, or equivalent structured fields.
   - If fields are missing, infer the relevant mapping from mechanics and camera behavior for the current control question.
2. Read only the reference that matches the task:
   - Screen, keyboard, mouse, gamepad, touch, first-person, third-person, top-down, side-scroller, vehicle, or flight: use [screen controls](references/screen-controls.md).
   - VR, AR, MR, spatial computing, head/controller/hand input, teleport, snap turn, room-scale, anchors: use [XR locomotion](references/xr-locomotion.md).
   - For an assigned control-path check, use [interaction observation](references/interaction-acceptance.md).
3. For a feasibility question, explain the relevant mapping constraint and evidence limits. When implementation is authorized, implement the intended semantics in the chosen engine/framework.

## Universal Contract

- Controls must match the active camera and movement model.
- Movement axes must be stable after camera rotation.
- Do not hard-bind behavior to one engine, framework, renderer, or platform.
- Do not use prompt text keyword matching as logic. Use structured metadata, gameplay intent, or explicit control configuration.
- Keep view orientation, player/body orientation, and movement direction as separate concepts when the profile needs them.
- For horizontal ground movement, remove vertical pitch/roll from the movement vector unless the profile explicitly supports flight or six-degree freedom motion.
- Define only the actions this game actually offers.

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
