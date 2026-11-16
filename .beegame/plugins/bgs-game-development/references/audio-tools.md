# Audio editing and optional helpers

Use for supported file edits, code composition or file/signal inspection, not a path-only repair or design-only task. Resolve the installed plugin root two levels above this Skill's directory; scripts live under `scripts/`, not in the game. The `.mjs` helpers use Node built-ins and also run under Bun; the MIDI study uses Python and optional dependencies below. `--help` reads usage without production/playback.

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

## Inspect the final delivery file

Inspect the encoded file actually adopted by the runtime, not only its lossless master. FFprobe reports container/stream facts; a full FFmpeg decode can expose errors beyond the header. Use the actual path in place of this illustrative OGG filename; WAV, MP3 and other supported media use the same tools.

```sh
ffprobe -v error -select_streams a:0 -show_entries format=duration,size:stream=codec_name,sample_rate,channels,duration -of json "music.ogg" &&
ffmpeg -nostdin -v error -xerror -i "music.ogg" -map 0:a:0 -f null -
```

For a level or clipping question, measure the decoded delivery directly without rewriting it:

```sh
ffmpeg -nostdin -hide_banner -nostats -xerror -i "music.ogg" -map 0:a:0 -af "ebur128=peak=true" -f null -
```

The native filter reports integrated loudness and true peak; choose any acceptance target from the actual mix requirements, not a universal music level. Retain the inspected file and conditions in existing production evidence. These commands neither certify a loop nor audition the music. Engine-cooked clips/banks may need the engine's own inspection: observe the adopted import/compression, loop binding and affected player passage there. A decoded source file does not verify that build. Keep the PCM-only helper below for its supported measurements; no new decoder or inspection wrapper is needed.

## Build a request, not an audio engine

[compose-audio.mjs](../scripts/compose-audio.mjs) exports `noteHz`, `beatMs`, `phrase`, `repeatPhrase`, `partials` and `audioRequest`. A project-owned generator imports needed helpers for simple procedural cues or an intentionally oscillator-based palette and emits the existing resources request. The MIDI example below demonstrates a sampled-instrument path. Keep musical decisions in ordinary code.

```js
import { partials, audioRequest } from '<installed-plugin>/scripts/compose-audio.mjs';
const voices = partials(700, [{ ratio: 1, durationMs: 150, gain: .045 },
  { ratio: 2.35, durationMs: 65, gain: .012 }], { attackMs: 3 });
console.log(JSON.stringify(audioRequest([{ id: 'place', duration_ms: 180, voices }],
  { place: 'assets/runtime/place.wav' })));
```

These notes/levels are illustrative, not a style preset. Beat fields use quarter-note beats; BPM is quarter notes/minute. Numeric notes are MIDI numbers, null is a rest, and `frequency_hz` is explicit Hz. Choose attack/release for the note length. `partials` produces sine voices with authored ratios, gains and linear decays, not a physical instrument/filter/reverb model. Use current production help for accepted fields and capacity: the helpers neither render nor define service limits.

## An original arrangement study

[arrangement-study.py](../scripts/arrangement-study.py) writes standard Type 1 MIDI: a tempo/meter track and independent lead, harmony and bass tracks with program changes, note velocities, note-off events and explicit end times. Its original four-bar motif retains variation, an answering phrase and authored rests. Adapt a project-owned copy to the game; its 96 BPM, notes and zero-based General MIDI programs are examples, not a required palette. A frequent action cue stays independently triggered rather than baked into the BGM beat grid.

**Production dependencies:** Python 3 with [Mido](https://mido.readthedocs.io/en/stable/files/midi.html) for MIDI writing, the [FluidSynth CLI](https://www.fluidsynth.org/wiki/UserManual/) for SoundFont rendering, and FFmpeg/FFprobe for encoding and file inspection. File-only MIDI writing requires no MIDI port backend. These are optional authoring-machine dependencies, not game-runtime dependencies. The plugin neither installs them nor downloads a soundbank; missing dependencies leave this production path unavailable rather than replace the selected instrument with an oscillator.

**SoundFont choice and rights:** explicitly select a local `.sf2` and verify its actual banks/programs and articulation. General MIDI program numbers are not proof that an arbitrary bank contains those instruments; inspect render warnings rather than accept an unintended fallback instrument. Check MIDI rights and the specific soundbank's rendered-music/commercial-use, attribution and redistribution terms. Keep its source, exact version/hash and applicable license with the existing asset-source records; permission to distribute rendered music need not permit bundling the soundbank. This example bundles no MIDI library, FluidSynth binary or SoundFont. [Mido is MIT-licensed](https://github.com/mido/mido/blob/main/LICENSE); [FluidSynth's licensing FAQ](https://www.fluidsynth.org/wiki/LicensingFAQ/) distinguishes its software license from rights in MIDI and SoundFont inputs. Software redistribution would need a separate check of the actual binaries and their licenses.

Run only inside an authorized project, using fresh output paths and a soundbank whose use has been established:

```sh
python3 <installed-plugin>/scripts/arrangement-study.py study.mid --repeats 3 &&
fluidsynth -ni -F study-full.wav -T wav -O s16 -r 44100 "/absolute/licensed-bank.sf2" study.mid &&
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,duration -of json study-full.wav
```

The MIDI writer refuses an existing output. FluidSynth may replace an output: choose an unused render filename and retain the original MIDI and audio. Rendering uses the external CLI directly, without a BGS request or renderer wrapper. Retain the selected bank/programs and actual renderer settings in the existing production record. Successful file output does not prove instrument fidelity or musical quality.

For this fixed-tempo study, one period is 16 quarter notes at 96 BPM, or 10 seconds. Continuous repetitions let release/reverb from one cycle carry into the next. Compare adjacent full periods before choosing a settled one; three periods are a preparation example, not proof of convergence. If the middle period is suitable, this preserves its musical length rather than shorten the cycle with an arbitrary crossfade:

```sh
ffmpeg -n -i study-full.wav -af "atrim=start=10:end=20,asetpts=PTS-STARTPTS" -c:a pcm_s16le study-loop.wav &&
ffmpeg -n -i study-loop.wav -c:a libvorbis -q:a 5 study-loop.ogg
```

Other music uses its own tempo map, meter, loop range and tail treatment. These times and encoding settings are illustrative. An unresolved tail or harmonic jump remains a loop defect; do not keep rendering more periods without diagnosing it. A one-shot ending can retain its natural tail separately. Reuse the PCM diagnostics below, audition repeated joins, and test the final encoded file and actual loop binding in the selected engine. Compare timbre, phrasing and mix at comparable perceived levels with ordinary gameplay and cue overlap. Signal checks cannot replace listening, and unavailable rendering/listening remains unverified. Fix the affected phrase, articulation, mix or seam and retest that passage rather than restart soundtrack design.

## Inspect or audition PCM16 WAVs

```sh
node <installed-plugin>/scripts/inspect-audio.mjs assets/runtime/music.wav
node <installed-plugin>/scripts/inspect-audio.mjs assets/runtime/music.wav --loop 0 6000
node <installed-plugin>/scripts/inspect-audio.mjs --audition .beegame/tmp/audio-listen.html assets/runtime/music.wav assets/runtime/impact.wav
```

[inspect-audio.mjs](../scripts/inspect-audio.mjs) accepts complete mono/stereo PCM16 RIFF/WAVE, failing explicitly for other encodings. The first commands only read; loop bounds are authored milliseconds. Statistics include source hash, levels/DC/silence and boundary sample/slope/energy differences. Null dBFS means zero signal. Full-scale samples do not prove clipping, RMS is not perceptual loudness and boundary differences do not prove an audible seam. No taste thresholds are inferred.

`--audition` creates one new HTML with native controls pointing to original WAVs. Its parent must exist, inputs/output stay in the project and files are never overwritten. It starts no server or playback. Open via the existing preview/browser; keep relative URLs valid rather than upload elsewhere. Repeat loops the whole file, not custom runtime points.

An isolated audition can compare timbre/repetition/overlap, but does not reproduce the game's gain graph, event cadence, transitions or pause/retry. Listen to the affected game passage before integration/final-mix claims. Muted runs and diagnostics are not listening. [Player-path observation](play-capture.md) covers selected Web Audio signals and capture limits; they are not necessarily the whole device mix. Use a decoder supporting the actual capture format; this PCM16 tool does not decode WebM. Disclose unavailable listening without rerouting or force-resuming the game graph.
