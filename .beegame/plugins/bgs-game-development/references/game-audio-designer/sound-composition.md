# Sound Composition Examples

Use for a new soundscape, code-composed music, editing existing music or a material change in feedback/mix. A file-path fix does not require new music or a sound library. These examples describe listening decisions, not approved assets or fixed loudness/timing values.

## From meaning to audible treatment

| Situation | Possible treatment and its purpose | Competing treatment to examine |
|---|---|---|
| Repeated play needs a calm sense of place and continuity | A restrained musical phrase, environmental texture or a purposeful quiet passage can support the intended pace while leaving room for action sounds | Event pings alone may leave the intended atmosphere unexpressed; a dense continuous loop can be just as unsuitable if it overwhelms that calm |
| A precision jump actually executes | A distinct onset can confirm the action; landing and a rejected attempt need different meanings if the game exposes them | Playing the success sound on raw input can lie when the action is unavailable |
| Dense action includes small hits and a major event | Give the major event a recognizable envelope/register and enough mix space to be noticed | Repeating identical loud transients for every event can mask the information the player needs |

Choose timbre, register, attack/decay, texture, repetition variation and space from the intended experience and its event rate. A shared palette does not require every sound to use the same pitch or instrument. Preserve recognizable event meaning when introducing variation. Silence and restrained ambience are compositional tools, not proof that an audio domain is unnecessary.

For a reference comparison, listen to the relevant source passage and relate what is heard to its action or setting. A description or link is not a listening observation. Unavailable listening remains unverified.

## Edit existing music

Use for a requested change to a recording, stems, MIDI or a music project. Choose the editable source by the change: a shorter arrangement, a different performance and a quieter mix are different operations. Preserve the original and work in a derivative or session copy, retaining its source identity and any source-use constraints. An unavailable instrument or editable part remains a dependency, not permission to silently recompose it.

### Recordings, cuts and loops

To shorten music while retaining pace, identify phrases, downbeats and a useful ending, then remove or reorder complete musical material. To retain all material at a different pace, stretch time instead. Locate edit points from the actual recording and any available tempo map; seconds alone do not identify bars. For fixed tempo and meter, derive seconds from beats and BPM using the same beat unit; variable tempo needs local timing. Keep both stereo channels aligned, preserve attacks and intended tails, and choose a local fade or overlap where the join needs it. A zero crossing in one channel does not guarantee a clean stereo join. [Audacity's editing guidance](https://manual.audacityteam.org/man/faq_editing.html) and [crossfade example](https://manual.audacityteam.org/man/creating_a_crossfade.html) explain these mechanisms without supplying a universal fade length.

Choose tempo and pitch changes independently when the target requires it: tempo adjustment keeps pitch, while transposition keeps duration. Playback-rate changes affect both. Derive tempo ratio from target/source BPM or source/target duration, and pitch ratio from `2 ** (semitones / 12)`. Preserve the intended articulation and instrument identity rather than assume processing is transparent. [Change Tempo](https://manual.audacityteam.org/man/change_tempo.html) and [Change Pitch](https://manual.audacityteam.org/man/change_pitch.html) document separate operations; use the actual editor's equivalents.

For a loop, retain the intended musical period when handling tails: overlap a rendered tail into the head or use the editor's loop render where appropriate. Merely overlapping the end and start can shorten the cycle or duplicate a beat. A one-shot ending can instead retain its full decay. Carry the adopted range and timing into the existing runtime binding; this is separate from deciding what a state transition should stop. Mechanical file operations are illustrated in [audio editing commands](audio-tools.md#edit-existing-recordings).

### Stems and mixes

Use supplied instrument/group stems for changes to individual parts. Import them at a shared time origin, preserve leading alignment silence, and apply structural edits or tempo-map changes across linked parts. Change gain, pan, automation or processing on the part causing the mix problem; preserve the other performances. [Splitting stereo channels](https://manual.audacityteam.org/man/splitting_and_joining_stereo_tracks.html) does not recover instrument stems. A finished mix supports whole-mix edits; changing one instrument requires suitable stems, the source project or an explicitly chosen separation method with its own artifacts and rights constraints.

### MIDI and native projects

For MIDI changes, import or open the existing clip in a compatible note editor; select the relevant phrase/part and edit pitch, onset, duration, velocity or controller data according to the musical goal. Preserve tempo/meter, sustain and overlapping-note relationships. Quantization is a deliberate timing change, not routine cleanup. MIDI supplies performance instructions, not the final timbre: retain the intended instrument, samples and articulation when rendering. [Ableton's MIDI editor](https://www.ableton.com/en/live-manual/12/editing-midi/) demonstrates note and controller editing; its shortcuts and devices are not dependencies for another editor.

For an available DAW project, use its native editing facilities in a working copy. Retain referenced media, instruments, routing and automation; missing plug-ins or samples prevent an equivalent render unless a suitable printed source exists or a replacement is chosen. Export the intended mix or stems over one shared start, range and sample rate. Choose whether tails belong in a one-shot or wrap into a loop, and how shared effects are printed so recombining stems does not duplicate them. [Project and export documentation](https://www.ableton.com/en/live-manual/12/managing-files-and-sets/) illustrates media dependencies, common export ranges and loop-tail rendering. Use the corresponding facilities in the actual DAW; a stereo bounce or MIDI file is not the editable project.

## From references to code-composed sound

Use a relevant public listening example to answer a concrete question: what makes this movement feel light, this impact sound substantial, or this loop remain comfortable during repeated play? Describe the audible mechanism—onset, partials, register, rhythm, density, decay or space—and why it suits the game's event rate. Transfer that relationship into an original treatment; do not copy a melody, recording or preset without the applicable rights. Descriptions and links alone do not establish that a reference was heard.

### Musical identity and variation

- Choose the musical role before notes: foreground theme, rhythmic support, evolving ambience or occasional punctuation. A quiet game need not have constant music, and an atmospheric texture need not have a lead melody.
- For melodic or rhythmic music, establish a recognizable motif or pattern, its pulse, phrase shape and resting points. Relate bass/harmony and register to that idea. Translate these choices into note durations, rests, accents, instrument envelopes and phrase order rather than a list of arbitrary frequencies.
- Preserve identity when varying a loop. Changing instrumentation, density, register, rhythm or a phrase ending can be enough; random notes from a scale are not by themselves musical development. Use constrained variation only for the intended effect, with a reproducible version when debugging or comparing candidates.
- Repetition can be the intended style. Listen for whether changes in texture or arrangement sustain that intention, rather than requiring a longer tune or more layers. Check the actual loop boundary, including release/reverb tails and harmonic continuity; loop metadata does not make a seam inaudible.

[Ableton Learning Music](https://learningmusic.ableton.com/) offers audible comparisons of rhythm, melody, harmony and arrangement. Its [“Ride” example](https://learningmusic.ableton.com/make-melodies/ride.html) shows how a repeating pattern can develop mainly through timbral changes. [ZzFXM](https://github.com/keithclark/ZzFXM) separates instruments, patterns and their sequence in a small code-based music renderer. Study that organization when useful; it does not require a new dependency, tracker or fixed song form.

For a concrete translation into the existing renderer, the helpers' [original arrangement study](audio-tools.md#an-original-arrangement-study) explains a four-bar motif, variation, answer and ending with bass/chord support and a separate frequent-action cue. Use it to inspect how explicit musical choices become code, not as a required form, sound preset or listening-quality claim.

### Timbre, material and articulation

Translate an adjective into audible controls. For example, a struck resonant object may need a brief excitation followed by partials that decay at different rates; a sustained airy movement may need shaped noise and gradual modulation. A single sine tone or pitch sweep can be appropriate for abstract feedback, but does not automatically convey metal, wood, wind or an acoustic instrument.

Choose only the synthesis elements the sound needs: oscillator/noise balance, harmonic or inharmonic partials, amplitude and pitch envelopes, and filtering or space if available and justified. Keep onset and stopping transitions intentional; gain discontinuities can introduce clicks. Small event variants should retain recognizable meaning and suit the source material, not change pitch arbitrarily on every repetition.

[Ableton Learning Synths](https://learningsynths.ableton.com/) provides interactive envelope, oscillator and filter comparisons. [Gordon Reid's bell synthesis article](https://www.soundonsound.com/techniques/synthesizing-bells) is a material-specific additive-synthesis reference, not a recipe for every reward sound.

Inspect the available production tool's capabilities before promising a treatment. BGS's built-in programmatic WAV recipe provides oscillator/noise voices, gain, linear attack/release, pitch sweep and pan; it is not a composer and has no recipe fields for filters, reverb or a full ADSR envelope. Its renderer reports normalization and leaves anti-aliasing, seamless loops and listening quality unverified. Simplify nonessential voices or processing while preserving required sound identity, rhythmic role and event meaning. If this method cannot supply those, use another available production path or source under [Audio's production choice](../../skills/game-audio-designer/SKILL.md#choose-and-produce-the-audible-roles); a change to required identity belongs to its existing design decision and authorization. Extend shared synthesis tooling only for a demonstrated unmet need, not to obtain an imagined complete instrument library.

### Runtime music and the audible mix

Determine which source continues, fades, suspends or stops at pause/retry/exit; a sound file alone cannot express that policy.

The [Godot platformer player](https://github.com/godotengine/godot-demo-projects/blob/master/2d/platformer/player/player.gd) illustrates feedback tied to a legal jump rather than every input attempt. Its [audio demos](https://github.com/godotengine/godot-demo-projects/tree/master/audio) can answer specific implementation questions. These are integration references, not proof of an appropriate sound palette for another game.

Let gameplay state change music only when it serves an audible purpose. For a small game, a level change or one added/removed voice may suffice. When switching material, consider pulse, phrase boundary, harmony and tails; do not restart a track on every repeated event. Beat/phrase alignment may suit a musical transition, while immediate action confirmation should not wait for the next beat unless that is the explicit gameplay design.

For live Web Audio sequences, schedule note starts and parameter changes against `AudioContext.currentTime`; a JavaScript timer can replenish a short look-ahead queue rather than directly timing each note. [A tale of two clocks](https://web.dev/articles/audio-scheduling) explains the timing tradeoff. For a finite rendered cue, authored sample timing may already be sufficient; do not add a live sequencer unnecessarily.

Judge level relationships in the actual combination of music, ambience and frequent/major events. Gain constants do not imply equal perceived loudness across different spectra, envelopes or overlapping voices. Make room through arrangement, shorter tails, register or level first; add ducking/concurrency control when actual masking or accumulation warrants it. Peak normalization prevents an individual rendered cue from exceeding its range; it does not set the final mix's loudness or prevent simultaneous cues from overloading it.

The MIT-licensed [game-audio Skill](https://github.com/playableintelligence/game-creator/blob/main/skills/game-audio/SKILL.md) and [mixing guide](https://github.com/playableintelligence/game-creator/blob/main/skills/game-audio/mixing-guide.md) offer Web Audio implementation examples. Adapt useful scheduling, one-shot and lifecycle ideas to the existing runtime. Their fixed gains, genre templates, file structure and timing claims are not universal requirements or evidence of good listening quality.

## Listening evidence

When producing or revising audio within an authorized task, listen across the action and the space between events to choose music, ambience or quiet for the intended pace. Compare a short relevant passage at comparable perceived levels and in the intended game sequence. Include the normal repeated action and the most relevant overlap or transition: listen for fatigue, obscured cues, unsuitable timbre, rhythmic instability, loop seams and abrupt endings. If a passage is too busy, remove or simplify the competing part before adding more processing. A comparison is useful only if it can change a decision; do not require multiple candidates or a separate review stage for every cue.

Record what was actually heard and how it informed the chosen treatment in the existing audio source or implementation report. Separate file decoding/signal checks, playback/lifecycle checks and audible judgment. Valid JSON, a non-silent waveform, normal peaks or a successful play call cannot establish musicality or integrated listening quality. When listening is unavailable, retain that uncertainty rather than inferring quality from code or a model's description.

Record the chosen audible treatment and event behavior in the existing audio source, separately from file format, source/license and production details. Use supplied volume/mute and accessibility requirements. Do not add audio generation, purchases or an independent listening/review stage without authorization.
