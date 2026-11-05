---
name: game-audio-designer
description: "Resolve a sound-identity or audio-event question; compose, integrate or repair game music, sound, ambience or dialogue. 中文：具体声音设计与事件反馈、音乐音效制作和集成问题。"
---

# Game Audio Designer

Use sound to communicate action, consequence, space, and mood. Start from the interactions and states that need audible feedback; do not generate or request audio assets when the task only calls for a design or a code fix.

- For audio production or integration, select sources through the shared [resource selection](../game-content-pipeline-engineer/references/resource-selection.md), then identify the source event, intended player meaning, timing, priority, variation, and whether the sound is 2D, positional 3D, or head-relative XR. Avoid feedback that lies about gameplay state.
- For an unresolved sound-identity or audible-feedback question, compare timbre, register, texture or silence by the intended player meaning. Record the chosen treatment and any event ordering that changes the perceived result. Exact synthesis, file and mix settings depend on actual audio. Read [sound composition examples](references/sound-composition.md) when they help resolve that choice or for actual composition/mix production; synthesis and listening procedures apply to production.
- For repeated note/beat arithmetic or procedural PCM production, use the optional [audio helpers](references/audio-tools.md). They assemble the existing synthesis recipe, inspect PCM and create an isolated audition page; composition and actual game listening still require judgment and observation.
- Keep reusable sound assets separate from event bindings and mix controls. For runtime integration, verify that authored audio references resolve and play in the chosen runtime rather than substituting an unrelated sound.
- During audio production and runtime integration, group music, effects, voice, and ambience when the game's scale needs independent levels or ducking. Resolve overlapping repeats, clipping, abrupt transitions and relevant lifecycle changes; when checking an implementation, test pause, restart, focus loss and scene change.
- Consider silent play and hearing differences: critical information also needs a visual or haptic path when relevant. Respect user volume/mute settings and platform autoplay or gesture-to-start rules, especially on the web.
- Check licenses and provenance before importing audio. Optimize format, duration, and loading only against the actual target platform and observed latency or memory issue.

Keep GDD cue meanings and shared behavior in their owning section. Record production scheduling, mix and state-specific stopping decisions in the corresponding asset or runtime source, referencing that design intent. Event behavior is separate from file sourcing specifications.

Match checks to the available output: inspect documented event/mix behavior for design, and decoding or audible quality for isolated resources. Those checks do not establish integrated playback or lifecycle behavior. For integrated playback, follow the ordinary player event through the actual music/effect combination and lifecycle. An accessible Web Audio node can use the existing [player-path capture method and its output limits](../game-playtest-performance/references/play-capture.md); it does not automatically capture private graphs, HTML media or device output. Use an available authorized player/recording for those observations, or retain them as unverified. Automated or headless checks should remain muted unless audio output is itself the subject of the test. Do not impose a full audio pass on a focused request.
