---
name: game-audio-designer
description: "Design and integrate a game’s soundscape; choose or compose music, ambience and event feedback, and resolve audio production or mixing problems. 中文：整体听觉氛围、配乐环境声与事件音效的设计集成，以及音频制作与混音修复。"
---

# Game Audio Designer

Shape the game’s audible experience as a whole: music can establish identity and pace, ambience can give a place presence, and event sounds communicate action and consequence alongside visual feedback. Choose their combination, including deliberate quiet, from the intended mood, play rhythm and sense of place. A first release or short game can use concise musical or ambient material; content size alone does not decide whether those roles are useful. For document-only work, record the sound design rather than producing unrequested audio; keep a local code fix scoped to the affected behavior.

- For audio production or integration, select sources through the shared [resource selection](../game-content-pipeline-engineer/references/resource-selection.md) for the adopted audible roles. Bind continuing music or ambience to the relevant player states, and one-shot feedback to valid events; choose timing, priority, variation and 2D, positional 3D or head-relative XR placement for those roles. Avoid feedback that lies about gameplay state.
- For an open question about music and event cues, the shared [playable relay study](../references/relay-crossing.html) lets you replay one passage with and without its travelling melody while retaining the arrival cue. In the game, listen across the action and the space between events to choose music, ambience or quiet for the intended pace. Exact synthesis, file and mix settings depend on actual audio. Read [sound composition examples](references/sound-composition.md) when they help resolve that choice or for actual composition/mix production; synthesis and listening procedures apply to production.
- For repeated note/beat arithmetic or procedural PCM production, use the optional [audio helpers](references/audio-tools.md). They assemble the existing synthesis recipe, inspect PCM and create an isolated audition page; composition and actual game listening still require judgment and observation.
- Keep reusable sound assets separate from event bindings and mix controls. For runtime integration, verify that authored audio references resolve and play in the chosen runtime rather than substituting an unrelated sound.
- During audio production and runtime integration, group music, effects, voice, and ambience when their overlap or differing roles need independent levels or ducking. Resolve overlapping repeats, clipping and abrupt transitions. Investigate interruption or lifecycle behavior when it affects the reported audio problem or required cue.
- Consider silent play and hearing differences: critical information also needs a visual or haptic path when relevant. Respect user volume/mute settings and platform autoplay or gesture-to-start rules, especially on the web.
- Check licenses and provenance before importing audio. Optimize format, duration, and loading only against the actual target platform and observed latency or memory issue.

Keep the audible mood, adopted roles and shared behavior with their owning GDD decisions. Record production scheduling, mix and state-specific stopping decisions in the corresponding asset or runtime source, referencing that design intent. Event behavior is separate from file sourcing specifications.

For an integrated trigger or mix problem, observe the affected player event and audio combination. For a recording question, [player-path observation](../game-playtest-performance/references/play-capture.md) covers Web Audio capture and its signal/output limits. Use an available authorized listening path; unavailable listening remains unverified. Automated or headless checks should remain muted unless audio output is itself the subject of the test.
