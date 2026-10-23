# Sound Composition Examples

Use for a new audible identity, code-composed music or a material change in feedback/mix. A file-path fix does not require new music or a sound library. These examples describe listening decisions, not approved assets or fixed loudness/timing values.

## From meaning to audible treatment

| Situation | Possible treatment and its purpose | Competing treatment to examine |
|---|---|---|
| A quiet puzzle placement is accepted | A short, soft attack with a small resonant tail can acknowledge the placement while leaving room for the next action | A long celebratory sound on every placement can dominate the intended calm or falsely suggest level completion |
| A precision jump actually executes | A distinct onset can confirm the action; landing and a rejected attempt need different meanings if the game exposes them | Playing the success sound on raw input can lie when the action is unavailable |
| Dense action includes small hits and a major event | Give the major event a recognizable envelope/register and enough mix space to be noticed | Repeating identical loud transients for every event can mask the information the player needs |

Choose timbre, register, attack/decay, texture, repetition variation and space from the intended experience and its event rate. A shared palette does not require every sound to use the same pitch or instrument. Preserve recognizable event meaning when introducing variation. Silence and restrained ambience are compositional tools, not proof that an audio domain is unnecessary.

When a sample is needed, listen to a small relevant candidate in the intended event sequence with music/ambience, not only in isolation. Check whether frequent sounds become tiring, whether a tail competes with the next cue, and whether important events remain distinguishable. Determine which source continues, fades, suspends or stops at pause/retry/exit; a sound file alone cannot express that policy. Unavailable listening remains unverified.

The [Godot platformer player](https://github.com/godotengine/godot-demo-projects/blob/master/2d/platformer/player/player.gd) illustrates feedback tied to a legal jump rather than every input attempt. Its [audio demos](https://github.com/godotengine/godot-demo-projects/tree/master/audio) can answer specific implementation questions. These are integration references, not proof of an appropriate sound palette for another game.

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

Inspect the available production tool's capabilities before promising a treatment. BGS's built-in programmatic WAV recipe provides oscillator/noise voices, gain, linear attack/release, pitch sweep and pan; it is not a composer and has no recipe fields for filters, reverb or a full ADSR envelope. Its renderer reports normalization and leaves anti-aliasing, seamless loops and listening quality unverified. Use a simpler suitable treatment or an existing supported project audio path when necessary. Extend shared synthesis tooling only for a demonstrated unmet need, not to obtain an imagined complete instrument library.

### Runtime music and the audible mix

Let gameplay state change music only when it serves an audible purpose. For a small game, a level change or one added/removed voice may suffice. When switching material, consider pulse, phrase boundary, harmony and tails; do not restart a track on every repeated event. Beat/phrase alignment may suit a musical transition, while immediate action confirmation should not wait for the next beat unless that is the explicit gameplay design.

For live Web Audio sequences, schedule note starts and parameter changes against `AudioContext.currentTime`; a JavaScript timer can replenish a short look-ahead queue rather than directly timing each note. [A tale of two clocks](https://web.dev/articles/audio-scheduling) explains the timing tradeoff. For a finite rendered cue, authored sample timing may already be sufficient; do not add a live sequencer unnecessarily.

Judge level relationships in the actual combination of music, ambience and frequent/major events. Gain constants do not imply equal perceived loudness across different spectra, envelopes or overlapping voices. Make room through arrangement, shorter tails, register or level first; add ducking/concurrency control when actual masking or accumulation warrants it. Peak normalization prevents an individual rendered cue from exceeding its range; it does not set the final mix's loudness or prevent simultaneous cues from overloading it.

The MIT-licensed [game-audio Skill](https://github.com/playableintelligence/game-creator/blob/main/skills/game-audio/SKILL.md) and [mixing guide](https://github.com/playableintelligence/game-creator/blob/main/skills/game-audio/mixing-guide.md) offer Web Audio implementation examples. Adapt useful scheduling, one-shot and lifecycle ideas to the existing runtime. Their fixed gains, genre templates, file structure and timing claims are not universal requirements or evidence of good listening quality.

## Listening evidence

When producing or revising audio within an authorized task, compare a short relevant passage at comparable perceived levels and in the intended game sequence. Include the normal repeated action and the most relevant overlap or transition: listen for fatigue, obscured cues, unsuitable timbre, rhythmic instability, loop seams and abrupt endings. If a passage is too busy, remove or simplify the competing part before adding more processing. A comparison is useful only if it can change a decision; do not require multiple candidates or a separate review stage for every cue.

Record what was actually heard and how it informed the chosen treatment in the existing audio source or implementation report. Separate file decoding/signal checks, playback/lifecycle checks and audible judgment. Valid JSON, a non-silent waveform, normal peaks or a successful play call cannot establish musicality or integrated listening quality. When listening is unavailable, retain that uncertainty rather than inferring quality from code or a model's description.

Record the chosen audible treatment and event behavior in the existing audio source, separately from file format, source/license and production details. Use supplied volume/mute and accessibility requirements. Do not add audio generation, purchases or an independent listening/review stage without authorization.
