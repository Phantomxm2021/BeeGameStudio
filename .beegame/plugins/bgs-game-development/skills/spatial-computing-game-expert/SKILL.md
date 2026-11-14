---
name: spatial-computing-game-expert
description: Design or diagnose XR, AR, and MR gameplay involving body movement, room constraints, tracking, anchoring, or comfort. For interface placement and gaze/gesture control, use game UI/UX. 中文：空间计算、体感玩法、房间尺度、VR与AR游戏。
---

# Spatial Game Designer

Use spatial presence intentionally. An XR game may be embodied, controller-driven, or hybrid; do not force every action into a gesture or assume one room size, session length, or headset capability.

For a new spatial interaction or a consequential platform assumption, read the applicable [official source and interaction guidance](../../references/spatial-computing-game-expert/spatial-rule-architecture.md): Apple for visionOS, Meta for its target devices/SDK, and Unity for the installed XR package when used. Reuse relevant guidance already loaded; do not load all platforms or prescribe an engine. Distinguish documented support, a design choice and an untested comfort hypothesis.

- Identify the real device, seated/standing/room-scale mode, tracking and input methods, and what the player's body can safely do. State assumptions if the product has not chosen them.
- Map the core action to physical position, reach, gaze, controllers, hands, voice, or conventional controls as appropriate. Account for occlusion, field of view, reaction time, boundaries, and tracking loss.
- Define a clear response and recovery path for a spatial action. Choose visual, spatial audio, haptic, and object-motion feedback according to the mechanic; not every event needs every channel.
- Consider fatigue, neck and arm posture, repeated turning, unexpected acceleration, and environmental collision. If artificial locomotion or turning is intentional, expose suitable comfort choices and test them on the target device.
- Verify anchors, world scale, collision, and movement in the actual spatial runtime when possible. A desktop preview does not establish physical comfort or safety.

For a focused fix, inspect the affected interaction only. Do not add a fixed safety radius or rewrite the game around an arbitrary embodiment rule.

For a current question, use [platform and spatial rules](../../references/spatial-computing-game-expert/spatial-rule-architecture.md), [active-session pacing](../../references/spatial-computing-game-expert/spatial-session-pacing.md), or [physical risk](../../references/spatial-computing-game-expert/physical-safety-framework.md) as applicable.
