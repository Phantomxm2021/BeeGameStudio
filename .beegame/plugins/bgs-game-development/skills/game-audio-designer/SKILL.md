---
name: game-audio-designer
description: "Choose, compose, edit or implement game music, sound assets and audible feedback, including existing recordings, MIDI/project arrangements and mix/lifecycle revisions. Use when deciding what an action or game should sound like, including code-generated cues. 中文：首次听觉表达、音乐剪辑与编排、事件音效实现，以及环境声、混音和生命周期修订。"
---

# Game Audio Designer

Shape the audible experience through play, including the space between events. Choose what carries identity/rhythm, gives the place presence and communicates consequences. Music, ambience, event cues and deliberate silence can serve those roles. Quiet need not mean event-only: sparse phrases or a restrained texture can carry a world. Choose by intended experience, not game size or a default package; no role is mandatory when it adds nothing. Document-only work records intent; repairs stay local.

## Choose and produce the audible roles

Use [meaning and audible treatment](../../references/game-audio-designer/sound-composition.md#from-meaning-to-audible-treatment) for a role question, [music editing](../../references/game-audio-designer/sound-composition.md#edit-existing-music) for existing recordings, stems or MIDI/projects, and [code composition](../../references/game-audio-designer/sound-composition.md#from-references-to-code-composed-sound) for synthesis. The [playable relay study](../../references/relay-crossing.html) contrasts travelling melody and arrival cue. Reuse its description or retained observations; audition only when the audible distinction remains unresolved.

When continuing sound's role is uncertain, compare a concise sketch with event-only or silence during the relevant passage. Judge identity, pace and room for cues, not just whether notes play. Reuse an adequate sketch; this is not another soundtrack stage. Muted/unavailable playback does not establish intentional silence.

Choose production from the gap between the intended sound and the available source in the current event sequence. If the source fits but its trigger, mix or state interruption is wrong, retain it and adjust integration. If it lacks the required timbre, articulation or rhythmic role, choose source processing, synthesis, acquired material or their combination by their actual ability to supply it. If fit is unresolved only for lack of listening evidence, keep the source as a candidate rather than infer adoption or replacement from technical playback. Obtain required inputs through [resource selection](../../references/game-content-pipeline-engineer/resource-selection.md), preserving explicit source choices, rights and provenance. For repeated note/beat arithmetic or procedural PCM, [audio helpers](../../references/game-audio-designer/audio-tools.md) assemble the existing recipe, inspect PCM and offer isolated audition; they do not compose by judgment, render by themselves or establish listening quality.

## Integrate the soundscape

Keep reusable assets separate from event/state bindings and mix controls. Bind continuing music/ambience to player states and one-shots to confirmed events. Choose timing, variation, priority and 2D, positional 3D or head-relative XR placement by role. Resolve overlapping repeats, clipping, abrupt transitions and interruption through the existing audio lifecycle. Independent groups or ducking serve actual mix needs, not a universal audio architecture.

Respect user levels/mute and platform gesture/autoplay rules. Critical information also needs a relevant visual/haptic path. Optimize format/loading against the target platform and observed latency or memory needs, preserving the chosen sound instead of substituting an unrelated cue.

Keep audible intent with its existing design decision; production scheduling, mix and stopping details live with their asset/runtime owner. For an integration claim, listen to the affected player event and overlap in the actual game, using [listening evidence](../../references/game-audio-designer/sound-composition.md#listening-evidence). An isolated file or muted browser run does not establish final mix or event triggering. [Player-path observation](../../references/game-playtest-performance/play-capture.md) explains capture limits; a selected Web Audio signal is not necessarily the whole device mix. Disclose unavailable listening; keep unrelated headless checks muted.
