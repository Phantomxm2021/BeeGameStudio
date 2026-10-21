# Optional audio helpers

Use when code-composing audio or diagnosing generated PCM. A resource-path fix or design-only task does not require these scripts. Resolve scripts from this installed Skill's base directory, shown when it is loaded; do not assume they were copied into the game. Both scripts use Node built-ins and also run under Bun. Read `--help` without executing production or playback.

## Compose with the existing renderer

[compose-audio.mjs](../scripts/compose-audio.mjs) exports `noteHz`, `beatMs`, `phrase`, `repeatPhrase`, `partials` and `audioRequest`. A project-owned generator imports only the helpers it needs and emits the normal resources request. It can keep explicit musical choices in ordinary JavaScript; no new score language or runtime audio manager is required.

```js
// Import from the installed Skill's actual script path.
import { phrase, repeatPhrase, beatMs, partials, audioRequest } from '<installed-skill>/scripts/compose-audio.mjs';
const bpm = 80;
const motif = [
  { at: 0, beats: .5, note: 'C4' },
  { at: 1, beats: .5, note: 'E4', velocity: .75 },
  { at: 2, beats: 1, note: 'G4' },
];
const cue = { id: 'music', duration_ms: beatMs(8, bpm),
  loop: { start_ms: 0, end_ms: beatMs(8, bpm) },
  voices: repeatPhrase(motif, { bpm, count: 2, periodBeats: 4, gain: .08 }) };
console.log(JSON.stringify(audioRequest([cue], { music: 'assets/runtime/music.wav' })));
```

These are illustrative notes and levels, not a style preset. `at`, `beats`, `startBeat` and `periodBeats` use quarter-note beats; BPM means quarter notes per minute. A null note is a rest. Numeric notes are MIDI numbers; use a source's `frequency_hz` for explicit Hz. Note articulation has explicit attack/release durations; choose shorter envelopes for short notes rather than silently truncating them.

For a resonant cue, `partials(fundamentalHz, [{ratio, durationMs, gain}, ...])` builds sine voices with individually chosen linear decays. Non-integer ratios are available for an intentionally inharmonic sound. Ratios, levels and decay relationships need listening; the helper does not model a complete physical instrument. It adds no filtering, reverb or exponential envelope to the existing renderer.

### An original arrangement study

[arrangement-study.mjs](../scripts/arrangement-study.mjs) is an executable example, not another production API. `node <installed-skill>/scripts/arrangement-study.mjs --example` prints the normal request without writing, rendering or playing it. It reuses `phrase`, `partials` and `audioRequest`; inspect the source when learning how the choices become voices.

Assume a hypothetical unhurried tinkering puzzle needs modest rhythmic support and a separate frequent placement acknowledgment. This is not a soundtrack for an existing game or an approved genre preset. The original four-bar study uses a D-minor-centered outline at 96 quarter-note BPM:

| Bar | Authored choice | Intended relationship |
| --- | --- | --- |
| A | Offbeat D–F–A–F motif over D-minor support | Establish a recognizable contour without filling every beat |
| A' | Same rhythm, changed upper turn and E ending over B-flat support | Preserve identity while leaving the phrase unsettled |
| B | Higher descending answer over G-minor support | Change contour/register and harmonic support rather than randomize notes |
| Ending | F–E–D, with a longer final D and return to D-minor support | Resolve the short phrase before the loop begins again |

Lead, chord and bass voices end by beat 2.5 of each four-beat bar. Their scheduled rests create space for an independently triggered short cue; players will not necessarily act during those rests, so this does not guarantee freedom from masking. The lead uses triangle waves and support uses sine waves with distinct linear attack/release choices. These are abstract synthesized sounds, not claims of acoustic instrument realism. No percussion, reverb or automatic variation is required by this example.

The request contains a 10-second `study-loop` and a separate 180ms `study-place`. The latter uses two differently decaying partials and is not quantized into the music. Do not delay an actual placement acknowledgment to fit the beat. The release durations fit the authored notes and final rest, but metadata and silence do not prove a pleasing or seamless loop. Gain choices are illustrative, not perceived-loudness targets.

Render through the same resource path described below. Audition several cycles and placement cues at the intended event rate; compare whether the answer/ending is useful, the pulse suits the action and the cue remains clear during occupied beats as well as rests. If it is busy, first reconsider support/density/tails. If the required identity needs unavailable synthesis or a different source, choose a supported production path rather than treating this study as the default soundtrack. Record actual listening separately from recipe/PCM checks.

Save the generator's request inside the authorized project and render it with the **current turn's supplied** `resources.mjs`. Registration/binding remains with the existing resource tools. The normal resource schema and Nyquist checks validate the final request. Cue limits remain 256 voices and 300 seconds; a compact authored loop can avoid unfolding a whole long song. Do not automatically raise limits, split files or install another audio engine on a failed request. Repetition/tail overlap and phase at the loop boundary remain the author's choices.

## Inspect and audition original WAVs

[inspect-audio.mjs](../scripts/inspect-audio.mjs) reads complete mono/stereo PCM16 RIFF/WAVE files, including BGS renderer output. Other codecs or PCM encodings fail explicitly; use the actual decoder for those files.

```sh
node <installed-skill>/scripts/inspect-audio.mjs assets/runtime/music.wav
node <installed-skill>/scripts/inspect-audio.mjs assets/runtime/music.wav --loop 0 6000
node <installed-skill>/scripts/inspect-audio.mjs --audition .beegame/tmp/audio-listen.html assets/runtime/music.wav assets/runtime/impact.wav
```

The first two commands only read. The loop range is in milliseconds; use actual authored bounds. Output includes source hash, duration/channels, peak/RMS, DC mean, silence, near-zero leading/trailing duration, and sample/slope/energy differences around the selected boundary. Null dBFS means zero signal, not a missing measurement. Full-scale samples do not establish clipping, RMS does not establish perceptual loudness, and a boundary difference does not establish an audible seam. There are no taste scores or automatic quality thresholds.

`--audition` creates exactly one new HTML file with native audio controls referencing the original WAVs; its parent directory must already exist, all inputs/output stay inside the current project, and existing files are never overwritten. It starts no server or playback. Open through an existing local preview or an available ordinary browser, click the controls and optionally play clips together. The page's repeat control loops the whole file, not custom runtime loop points. Relative asset URLs must remain valid when serving it; do not work around a blocked file by uploading it to another service.

Use this page to examine timbre, repetition and overlap at consciously chosen levels. Its controls do not reproduce the game's gain graph, action cadence, transitions or pause/retry policy. Inspect the same meaningful action/overlap in the actual delivered game through its player controls before making integration or final-mix claims. The current managed headless Preview browser is muted and its HTML-audio probe does not cover Web Audio graphs, short one-shots or listening quality. Successful tests there do not establish that anyone heard the game. Use an available ordinary player/browser or an authorized recording path; disclose listening that could not be performed rather than force-resuming or rerouting the game's graph.

For an accessible real Web Audio master/output node, the playtest Skill's [optional capture helper](../../game-playtest-performance/references/play-capture.md) records that node while the test uses actual player controls. It leaves original playback routes intact and provides explicit selected-node limits. A recorded bus is not automatically the complete device mix; missing/private graphs and native HTML media stay outside coverage. Listen to WebM recordings with the browser's actual decoder, not the PCM16-only diagnostic script.
