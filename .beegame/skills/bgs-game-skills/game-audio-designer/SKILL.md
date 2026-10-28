---
name: game-audio-designer
description: Design or repair game music, sound effects, ambience, dialogue, spatial audio, mixing, and event feedback. 中文：游戏音效、背景音乐、配音、空间音频、混音。
---

# Game Audio Designer

Use sound to communicate action, consequence, space, and mood. Start from the interactions and states that need audible feedback; do not generate or request audio assets when the task only calls for a design or a code fix.

- Identify the source event, intended player meaning, timing, priority, variation, and whether the sound is 2D, positional 3D, or head-relative XR. Avoid feedback that lies about gameplay state.
- For GDD work, choose audible identity through timbre, register, texture and silence, with meaningful cue distinctions. Hand off event intent, priority and lifecycle behavior. Exact synthesis, file and mix settings depend on actual audio. Read [sound composition examples](references/sound-composition.md) for an unresolved sound-identity choice or actual composition/mix production; synthesis and listening procedures apply to production.
- For repeated note/beat arithmetic or procedural PCM production, use the optional [audio helpers](references/audio-tools.md). They assemble the existing synthesis recipe, inspect PCM and create an isolated audition page; composition and actual game listening still require judgment and observation.
- Keep reusable sound assets separate from event bindings and mix controls. For runtime integration, verify that authored audio references resolve and play in the chosen runtime rather than substituting an unrelated sound.
- Group music, effects, voice, and ambience when the game's scale needs independent levels or ducking. Describe how overlapping repeats, clipping, abrupt transitions and relevant lifecycle changes should behave; when checking an implementation, test pause, restart, focus loss and scene change.
- Consider silent play and hearing differences: critical information also needs a visual or haptic path when relevant. Respect user volume/mute settings and platform autoplay or gesture-to-start rules, especially on the web.
- Check licenses and provenance before importing audio. Optimize format, duration, and loading only against the actual target platform and observed latency or memory issue.

Keep event/mix decisions in their owning GDD section and reference them from handoffs. Define state-specific exceptions there rather than duplicating timing or stopping rules. Event behavior is separate from file sourcing specifications.

Match checks to the available output: inspect documented event/mix behavior for design, and decoding or audible quality for isolated resources. Those checks do not establish integrated playback or lifecycle behavior. When verifying integration in an available game runtime, use the ordinary player path where practical; otherwise state the runtime checks that remain unperformed. Automated or headless checks should remain muted unless audio output is itself the subject of the test. Do not impose a full audio pass on a focused request.
