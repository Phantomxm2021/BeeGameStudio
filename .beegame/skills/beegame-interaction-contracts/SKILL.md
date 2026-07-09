---
name: beegame-interaction-contracts
description: Use when designing, implementing, reviewing, or fixing BeeGame player interaction, camera, movement, locomotion, input mapping, touch controls, or XR interactions. Applies to screen games, mobile games, first-person/third-person/top-down/side-scroller controls, vehicle/flight controls, VR/AR/MR locomotion, controller rays, hands, gestures, and world-anchored spatial interaction.
---

# BeeGame Interaction Contracts

Use this skill before implementing or modifying player interaction. BeeGame is a general game studio, so choose an interaction profile from structured product intent, not from platform keywords alone.

## Workflow

1. Identify the interaction profile from the game spec:
   - `dimension`, `cameraPerspective`, `movementModel`, `inputScheme`, `primaryInteraction`, `targetDevice`, `xrMode`, or equivalent structured fields.
   - If fields are missing, infer from mechanics and camera behavior, then state the inferred profile in the implementation notes.
2. Load the relevant reference:
   - Screen, keyboard, mouse, gamepad, touch, first-person, third-person, top-down, side-scroller, vehicle, or flight: read `references/screen-controls.md`.
   - VR, AR, MR, spatial computing, head/controller/hand input, teleport, snap turn, room-scale, anchors: read `references/xr-locomotion.md`.
   - Acceptance/self-check requirements for any profile: read `references/interaction-acceptance.md`.
3. Implement against the chosen contract. Do not invent ad hoc control math when a contract applies.
4. Self-check the generated game using the acceptance checklist for that profile before declaring it playable.

## Universal Contract

- Controls must match the active camera and movement model.
- Movement axes must be stable after camera rotation.
- Do not hard-bind behavior to one engine, framework, renderer, or platform.
- Do not use prompt text keyword matching as logic. Use structured metadata, gameplay intent, or explicit control configuration.
- Keep view orientation, player/body orientation, and movement direction as separate concepts when the profile needs them.
- For horizontal ground movement, remove vertical pitch/roll from the movement vector unless the profile explicitly supports flight or six-degree freedom motion.
- Every controllable game must define expected behavior for forward/back, lateral movement or steering, rotation/look, jump/vertical action if present, and pause/restart/accessibility basics.

## Profile Selection

Prefer these profile names in implementation notes and acceptance metadata:

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

If a generated game has reversed movement, camera-relative movement drift, swapped lateral controls, pitch-contaminated ground movement, XR rig/camera confusion, invalid teleport targets, or drifting AR/MR anchors, treat it as a blocking playability bug and fix the control contract before polishing content.
