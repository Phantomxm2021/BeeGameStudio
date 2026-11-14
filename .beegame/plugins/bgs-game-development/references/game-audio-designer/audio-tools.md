# Audio editing and optional helpers

Use for supported file edits, code composition or PCM diagnosis, not a path-only repair or design-only task. Resolve the installed plugin root two levels above this Skill's directory; scripts live under `scripts/game-audio-designer/`, not in the game. They use Node built-ins and also run under Bun. `--help` reads usage without production/playback; the executable example avoids rewriting request boilerplate.

## Edit existing recordings

Use an available editor or FFmpeg; these examples add no dependency. Inspect the actual file with `ffprobe`, preserve its original, and use fresh output paths. Example times, gains and curves are illustrative, not musical defaults.

```sh
# Keep seconds 2–8, reset timestamps, then fade the six-second excerpt edges.
ffmpeg -n -i source.wav -af "atrim=start=2:end=8,asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=5.96:d=0.04" -c:a pcm_s16le clip.wav
# Two six-second excerpts, same rate/layout; 0.25s overlap produces 11.75s.
ffmpeg -n -i clip.wav -i answer.wav -filter_complex "[0:a][1:a]acrossfade=d=0.25:c1=tri:c2=tri" -c:a pcm_s16le joined.wav
# Increase tempo 10%, retaining pitch; duration becomes approximately 6/1.1 seconds.
ffmpeg -n -i clip.wav -af "atempo=1.1" -c:a pcm_s16le faster.wav
# Same-origin stems: lower the first part, retaining explicit gains and longest duration.
ffmpeg -n -i clip.wav -i answer.wav -filter_complex "[0:a]volume=0.6[a];[a][1:a]amix=inputs=2:duration=longest:normalize=0" -c:a pcm_s16le mix.wav
```

`atrim` retains input timestamps, hence the explicit reset. `amix` normalization is disabled here to retain chosen gains; the mix still needs headroom. These are [FFmpeg filter operations](https://ffmpeg.org/ffmpeg-filters.html), not musical or loudness verdicts.

Independent pitch/tempo processing with `rubberband` is conditional on an installed build containing it (`ffmpeg -h filter=rubberband`). Where available, this raises pitch one semitone without changing tempo:

```sh
ffmpeg -n -i clip.wav -af "rubberband=tempo=1:pitch=1.059463" -c:a pcm_s16le raised.wav
```

Changing sample-rate interpretation alone also changes timing. Use only available capabilities; these commands do not edit MIDI notes or DAW projects.

## Build a request, not an audio engine

[compose-audio.mjs](../../scripts/game-audio-designer/compose-audio.mjs) exports `noteHz`, `beatMs`, `phrase`, `repeatPhrase`, `partials` and `audioRequest`. A project-owned generator imports needed helpers and emits the normal resources request. Keep musical decisions in ordinary code; no new score language or runtime manager is needed.

```js
import { beatMs, repeatPhrase, audioRequest } from '<installed-plugin>/scripts/game-audio-designer/compose-audio.mjs';
const bpm = 80;
const motif = [{ at: 0, beats: .5, note: 'C4' },
  { at: 1, beats: .5, note: 'E4', velocity: .75 }, { at: 2, beats: 1, note: 'G4' }];
const duration = beatMs(8, bpm);
console.log(JSON.stringify(audioRequest([{ id: 'music', duration_ms: duration,
  loop: { start_ms: 0, end_ms: duration },
  voices: repeatPhrase(motif, { bpm, count: 2, periodBeats: 4, gain: .08 })
}], { music: 'assets/runtime/music.wav' })));
```

These notes/levels are illustrative, not a style preset. Beat fields use quarter-note beats; BPM is quarter notes/minute. Numeric notes are MIDI numbers, null is a rest, and `frequency_hz` is explicit Hz. Choose attack/release for the note length. `partials` produces sine voices with authored ratios, gains and linear decays, not a physical instrument/filter/reverb model. Use current production help for accepted fields and capacity: the helpers neither render nor define service limits.

## An original arrangement study

`node <installed-plugin>/scripts/game-audio-designer/arrangement-study.mjs --example` prints an original four-bar request without writing/rendering/playing. Inspect [its source](../../scripts/game-audio-designer/arrangement-study.mjs) when the translation from composition to voices is useful.

The hypothetical tinkering-puzzle study establishes an offbeat contour, varies its upper turn, answers in another register/harmony and resolves before repetition. Lead/support/bass leave rests; a separate short placement cue remains immediate rather than quantized to the music. Those relationships illustrate motif development, density and role separation, not an approved soundtrack or synthesis preset. Events may occur during occupied beats, so rests do not guarantee an unmasked cue.

Render through the available authorized resource capability. Listen across cycles and realistic cue overlap: does the phrase support the action, is the ending/seam useful, do density and tails leave room? Gains/metadata do not establish perceived loudness or a pleasing loop. Choose a different supported source when required identity exceeds this synthesis method instead of silently substituting timbre.

The same request can target Ogg/Vorbis where supported; the existing resources operation uses installed FFmpeg/FFprobe and returns actual format/duration/channels/rate with authored loop bounds. WAV remains PCM. Encoding errors stay explicit; PCM statistics do not measure the lossy output or its loop seam.

## Inspect or audition PCM16 WAVs

```sh
node <installed-plugin>/scripts/game-audio-designer/inspect-audio.mjs assets/runtime/music.wav
node <installed-plugin>/scripts/game-audio-designer/inspect-audio.mjs assets/runtime/music.wav --loop 0 6000
node <installed-plugin>/scripts/game-audio-designer/inspect-audio.mjs --audition .beegame/tmp/audio-listen.html assets/runtime/music.wav assets/runtime/impact.wav
```

[inspect-audio.mjs](../../scripts/game-audio-designer/inspect-audio.mjs) accepts complete mono/stereo PCM16 RIFF/WAVE, failing explicitly for other encodings. The first commands only read; loop bounds are authored milliseconds. Statistics include source hash, levels/DC/silence and boundary sample/slope/energy differences. Null dBFS means zero signal. Full-scale samples do not prove clipping, RMS is not perceptual loudness and boundary differences do not prove an audible seam. No taste thresholds are inferred.

`--audition` creates one new HTML with native controls pointing to original WAVs. Its parent must exist, inputs/output stay in the project and files are never overwritten. It starts no server or playback. Open via the existing preview/browser; keep relative URLs valid rather than upload elsewhere. Repeat loops the whole file, not custom runtime points.

An isolated audition can compare timbre/repetition/overlap, but does not reproduce the game's gain graph, event cadence, transitions or pause/retry. Listen to the affected game passage before integration/final-mix claims. Muted runs and diagnostics are not listening. [Player-path observation](../game-playtest-performance/play-capture.md) covers selected Web Audio signals and capture limits; they are not necessarily the whole device mix. Use a decoder supporting the actual capture format; this PCM16 tool does not decode WebM. Disclose unavailable listening without rerouting or force-resuming the game graph.
