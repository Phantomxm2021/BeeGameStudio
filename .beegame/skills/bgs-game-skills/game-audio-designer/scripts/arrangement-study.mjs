import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { phrase, beatMs, partials, audioRequest } from './compose-audio.mjs';

/** Original four-bar study, not a genre preset or automatic composer. */
export function arrangementStudy() {
  const bpm = 96;
  const bars = [
    // A: an offbeat entry, rising outline, then space after beat 2.5.
    [{ at: .25, beats: .5, note: 'D4' }, { at: .75, beats: .5, note: 'F4', velocity: .7 },
      { at: 1.5, beats: .5, note: 'A4' }, { at: 2, beats: .5, note: 'F4', velocity: .65 }],
    // A': retain rhythm; change the upper turn and end on an unsettled E.
    [{ at: .25, beats: .5, note: 'D4' }, { at: .75, beats: .5, note: 'F4', velocity: .7 },
      { at: 1.5, beats: .5, note: 'G4' }, { at: 2, beats: .5, note: 'E4', velocity: .65 }],
    // B: a higher descending answer over different support.
    [{ at: .25, beats: .5, note: 'Bb4' }, { at: .75, beats: .5, note: 'A4', velocity: .7 },
      { at: 1.5, beats: .5, note: 'G4' }, { at: 2, beats: .5, note: 'F4', velocity: .65 }],
    // Ending: fewer notes and a longer tonic, still ending before the boundary.
    [{ at: .25, beats: .5, note: 'F4' }, { at: .75, beats: .5, note: 'E4', velocity: .7 },
      { at: 1.5, beats: 1, note: 'D4' }],
  ];
  const chords = [['D3', 'F3', 'A3'], ['Bb2', 'D3', 'F3'],
    ['G2', 'Bb2', 'D3'], ['D3', 'F3', 'A3']];
  const bass = ['D2', 'Bb2', 'G2', 'D2'];
  const voices = bars.flatMap((notes, bar) => [
    ...phrase(notes, { bpm, startBeat: bar * 4, waveform: 'triangle',
      gain: .045, attackMs: 8, releaseMs: 100 }),
    ...phrase(chords[bar].map(note => ({ at: 0, beats: 2, note })),
      { bpm, startBeat: bar * 4, gain: .012, attackMs: 30, releaseMs: 220 }),
    ...phrase([{ at: 0, beats: 2.5, note: bass[bar] }],
      { bpm, startBeat: bar * 4, gain: .035, attackMs: 12, releaseMs: 160 }),
  ]);
  const duration = beatMs(16, bpm);
  return audioRequest([
    { id: 'study-loop', duration_ms: duration,
      loop: { start_ms: 0, end_ms: duration }, voices },
    // Separate frequent-action cue, not baked into the music's beat grid.
    { id: 'study-place', duration_ms: 180, voices: partials(700, [
      { ratio: 1, durationMs: 150, gain: .045 },
      { ratio: 2.35, durationMs: 65, gain: .012 },
    ], { attackMs: 3 }) },
  ], { 'study-loop': 'assets/runtime/study-loop.wav',
    'study-place': 'assets/runtime/study-place.wav' });
}

const help = `node <this-script> --example prints an original four-bar loop and separate placement cue as a normal resource request.
It writes, renders and plays nothing. Use the current supplied resources.mjs inside an authorized project to render the request.
The notes, gains, 96 BPM and rests illustrate choices, not a prescribed sound palette. Audible quality and integrated mix remain unverified.`;

const invokedFile = process.argv[1] ? await realpath(process.argv[1]).catch(() => undefined) : undefined;
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  if (process.argv.length === 3 && process.argv[2] === '--example')
    console.log(JSON.stringify(arrangementStudy(), null, 2));
  else if (process.argv.length === 3 && process.argv[2] === '--help') console.log(help);
  else { console.error(help); process.exitCode = 1; }
}
