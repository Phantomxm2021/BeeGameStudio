import { pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';

const finite = (value, name, minimum = 0) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)
    throw new Error(`${name} must be a finite number >= ${minimum}`);
  return value;
};

/** Equal temperament, A4=440Hz. Numeric inputs are MIDI notes, not Hz. */
export function noteHz(note) {
  let midi = note;
  if (typeof note === 'string') {
    const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note);
    if (!match) throw new Error('Use a note such as C4, F#3 or Bb5, or a MIDI number');
    const pitch = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
    midi = (Number(match[3]) + 1) * 12 + pitch + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  }
  finite(midi, 'MIDI note');
  if (midi > 127) throw new Error('MIDI note must be in 0..127');
  return 440 * 2 ** ((midi - 69) / 12);
}

/** BPM counts quarter notes; one beat here is one quarter note. */
export function beatMs(beats, bpm) {
  finite(beats, 'beats'); finite(bpm, 'bpm', Number.MIN_VALUE);
  const value = beats * 60_000 / bpm;
  if (!Number.isFinite(value)) throw new Error('Beat time exceeds finite range');
  return value;
}

/** Explicit note/rest events. No generated harmony or random composition. */
export function phrase(events, { bpm, startBeat = 0, waveform = 'sine', gain = .1,
  attackMs = 5, releaseMs = 60, pan = 0 } = {}) {
  beatMs(startBeat, bpm);
  if (!['sine', 'square', 'triangle', 'sawtooth'].includes(waveform)) throw new Error('Unsupported waveform');
  finite(gain, 'gain'); finite(attackMs, 'attackMs'); finite(releaseMs, 'releaseMs');
  if (gain > 1 || !Number.isFinite(pan) || Math.abs(pan) > 1) throw new Error('gain must be 0..1 and pan -1..1');
  if (!Array.isArray(events)) throw new Error('Supply an array of explicit phrase events');
  return events.flatMap(event => {
    if (!event || typeof event !== 'object') throw new Error('Invalid phrase event');
    const start = beatMs(startBeat + finite(event.at, 'event.at'), bpm);
    const duration = beatMs(finite(event.beats, 'event.beats', Number.MIN_VALUE), bpm);
    if (event.note === null) return []; // A rest still has explicit timing.
    if (attackMs + releaseMs > duration) throw new Error('Note is shorter than attackMs + releaseMs; choose its articulation');
    const velocity = event.velocity === undefined ? 1 : finite(event.velocity, 'event.velocity');
    if (velocity > 1) throw new Error('event.velocity must be 0..1');
    return [{ source: { type: 'oscillator', waveform, frequency_hz: noteHz(event.note) },
      start_ms: start, duration_ms: duration, gain: gain * velocity,
      attack_ms: attackMs, release_ms: releaseMs, pan }];
  });
}

/** Repeat a deliberately authored phrase; leave space/tails in periodBeats. */
export function repeatPhrase(events, { count, periodBeats, ...options }) {
  if (!Number.isInteger(count) || count < 1 || count > 256) throw new Error('count must be an integer in 1..256');
  finite(periodBeats, 'periodBeats', Number.MIN_VALUE);
  const voices = [];
  for (let index = 0; index < count; index++) {
    voices.push(...phrase(events, { ...options, startBeat: (options.startBeat ?? 0) + index * periodBeats }));
    if (voices.length > 256) throw new Error('Repeated phrase exceeds the existing 256-voice cue limit; author a smaller loop');
  }
  return voices;
}

/** Each explicit partial owns its amplitude and linear decay duration. */
export function partials(fundamentalHz, components, { startMs = 0, attackMs = 2, pan = 0 } = {}) {
  finite(fundamentalHz, 'fundamentalHz', Number.MIN_VALUE);
  finite(startMs, 'startMs'); finite(attackMs, 'attackMs');
  if (!Number.isFinite(pan) || Math.abs(pan) > 1) throw new Error('pan must be -1..1');
  if (!Array.isArray(components) || !components.length) throw new Error('Supply explicit partial components');
  return components.map(component => {
    const frequency = fundamentalHz * finite(component.ratio, 'partial.ratio', Number.MIN_VALUE);
    const duration = finite(component.durationMs, 'partial.durationMs', Number.MIN_VALUE);
    const gain = finite(component.gain, 'partial.gain');
    if (frequency > 24_000 || gain > 1 || attackMs > duration) throw new Error('Partial exceeds recipe frequency, gain or envelope bounds');
    return { source: { type: 'oscillator', waveform: 'sine', frequency_hz: frequency },
      start_ms: startMs, duration_ms: duration, gain, attack_ms: attackMs,
      release_ms: duration - attackMs, pan };
  });
}

/** Assemble existing resource-tool data. Its normal schema/renderer remains authoritative. */
export function audioRequest(cues, outputs, sampleRate = 44100) {
  if (![22050, 44100, 48000].includes(sampleRate)) throw new Error('Unsupported sample rate');
  if (!Array.isArray(cues) || !cues.length || cues.length > 32) throw new Error('Supply 1..32 cues');
  const ids = new Set();
  for (const cue of cues) {
    if (!cue || typeof cue.id !== 'string' || !cue.id.trim() || ids.has(cue.id)) throw new Error('Supply unique non-empty cue IDs');
    ids.add(cue.id);
    finite(cue.duration_ms, 'cue.duration_ms', Number.MIN_VALUE);
    if (cue.duration_ms > 300_000 || !Array.isArray(cue.voices) || !cue.voices.length || cue.voices.length > 256)
      throw new Error('Cue exceeds existing duration/voice bounds');
    if (typeof outputs?.[cue.id] !== 'string' || !outputs[cue.id]) throw new Error('Supply an output for each cue ID');
  }
  return { operation: 'audio', recipe: { format: 'beegame-programmatic-audio-v1', cues }, outputs, sampleRate };
}

export const help = `Import { noteHz, beatMs, phrase, repeatPhrase, partials, audioRequest } from this installed Skill script in your project-owned .mjs generator.
node <this-script> --example prints a small resource request to stdout, without writing/rendering/playing anything.
Use the current supplied resources.mjs to render the saved request; do not guess its turn-specific path.
phrase events: {at: quarter-note beat, beats: duration, note: "C4"|MIDI|null, velocity?:0..1}.
partials components: {ratio: positive multiplier, durationMs, gain:0..1}.
Keep explicit articulation and phase/loop choices. These helpers do arithmetic, not composing, filtering, reverb, acceptance or seamless-loop repair.`;

const invokedFile = process.argv[1] ? await realpath(process.argv[1]).catch(() => undefined) : undefined;
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--help') console.log(help);
    else if (process.argv.length === 3 && process.argv[2] === '--example') {
      const bpm = 80, duration = beatMs(4, bpm);
      const voices = phrase([{ at: 0, beats: .5, note: 'C4' }, { at: 1, beats: .5, note: 'E4', velocity: .75 },
        { at: 2, beats: 1, note: 'G4' }], { bpm, gain: .08 });
      console.log(JSON.stringify(audioRequest([{ id: 'example', duration_ms: duration, voices }],
        { example: 'assets/runtime/example.wav' }), null, 2));
    } else throw new Error(help);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
