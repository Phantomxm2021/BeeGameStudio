---
name: game-audio-designer
description: Design or repair game music, sound effects, ambience, dialogue, spatial audio, mixing, and event feedback. 中文：游戏音效、背景音乐、配音、空间音频、混音。
---

# Game Audio Designer

Use sound to communicate action, consequence, space, and mood. Start from the interactions and states that need audible feedback; do not generate or request audio assets when the task only calls for a design or a code fix.

- Identify the source event, intended player meaning, timing, priority, variation, and whether the sound is 2D, positional 3D, or head-relative XR. Avoid feedback that lies about gameplay state.
- Keep reusable sound assets separate from event bindings and mix controls. When an authored scene names an audio source or asset, verify that the reference resolves and plays in the chosen runtime rather than substituting an unrelated sound.
- Group music, effects, voice, and ambience when the game's scale needs independent levels or ducking. Prevent overlapping repeats, clipping, and abrupt transitions; test pause, restart, focus loss, and scene change behavior.
- Consider silent play and hearing differences: critical information also needs a visual or haptic path when relevant. Respect user volume/mute settings and platform autoplay or gesture-to-start rules, especially on the web.
- Check licenses and provenance before importing audio. Optimize format, duration, and loading only against the actual target platform and observed latency or memory issue.

For AUDIO_DESIGN.md, map planned player/game events to audio intent, priority and timing, then describe music/ambience transitions, mix and mute or accessibility behavior as the project needs. Leave file sourcing to the asset plan and resource work.

Verify with the game running, preferably through the ordinary player path. Automated or headless checks should remain muted unless audio output is itself the subject of the test. Do not impose a full audio pass on a focused request.
