---
name: spatial-computing-game-expert
description: Design or diagnose XR, AR, and MR gameplay involving body movement, room constraints, tracking, anchoring, or comfort. For interface layout alone, use spatial UX. 中文：空间计算、体感玩法、房间尺度、VR与AR游戏。
---

# Spatial Game Designer

Use spatial presence intentionally. An XR game may be embodied, controller-driven, or hybrid; do not force every action into a gesture or assume one room size, session length, or headset capability.

- Identify the real device, seated/standing/room-scale mode, tracking and input methods, and what the player's body can safely do. State assumptions if the product has not chosen them.
- Map the core action to physical position, reach, gaze, controllers, hands, voice, or conventional controls as appropriate. Account for occlusion, field of view, reaction time, boundaries, and tracking loss.
- Define a clear response and recovery path for a spatial action. Choose visual, spatial audio, haptic, and object-motion feedback according to the mechanic; not every event needs every channel.
- Consider fatigue, neck and arm posture, repeated turning, unexpected acceleration, and environmental collision. If artificial locomotion or turning is intentional, expose suitable comfort choices and test them on the target device.
- Verify anchors, world scale, collision, and movement in the actual spatial runtime when possible. A desktop preview does not establish physical comfort or safety.

For a focused fix, inspect the affected interaction only. Do not add a fixed safety radius or rewrite the game around an arbitrary embodiment rule.

The essential interaction principles are covered above. Read only the relevant optional reference: `references/spatial-rule-architecture.md` for spatial rules, `references/spatial-session-pacing.md` for active-session pacing, or `references/physical-safety-framework.md` for physical risk.
