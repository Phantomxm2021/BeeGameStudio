// Bencho sound recipes / synthesis, MIT — Copyright (c) 2026 Lorenzo Cabra.
// https://bencho.dev/sounds — full licence in vendor/BENCHO-LICENSE.txt.
interface Note { hz: number; to?: number; ms: number; gain: number; wave: OscillatorType; cut: number; atk: number; at?: number }
const sounds: Record<string, Note[]> = {
  perk: [{ hz: 330, ms: 360, gain: .053, wave: 'sine', cut: 560, atk: 90 }],
  knock: [{ hz: 330, ms: 32, gain: .046, wave: 'triangle', cut: 1100, atk: 7 }],
  pat: [{ hz: 230, ms: 60, gain: .036, wave: 'triangle', cut: 1700, atk: 10 }],
  expand: [{ hz: 196, to: 174, ms: 360, gain: .042, wave: 'sine', cut: 880, atk: 36 }, { hz: 294, to: 262, ms: 300, gain: .014, wave: 'sine', cut: 1100, atk: 48, at: 24 }],
  hum: [{ hz: 196, ms: 302, gain: .061, wave: 'sine', cut: 560, atk: 90 }],
  chime: [{ hz: 220, ms: 271, gain: .046, wave: 'sine', cut: 820, atk: 90 }],
};
export type HomeSound = 'perk' | 'knock' | 'pat' | 'expand' | 'hum' | 'chime';
let context: AudioContext | undefined;
let master: GainNode | undefined;
let enabled: boolean | undefined;
const lastPlayed = new Map<HomeSound, number>();

export function isHomeSoundEnabled() {
  if (enabled !== undefined) return enabled;
  try { enabled = localStorage.getItem('bgs-home-sound') !== 'off'; }
  catch (error) { console.warn('Home sound preference unavailable:', error); enabled = true; }
  return enabled;
}

export function setHomeSoundEnabled(value: boolean) {
  enabled = value;
  if (context && master) master.gain.setValueAtTime(value ? .45 : 0, context.currentTime);
  try { localStorage.setItem('bgs-home-sound', value ? 'on' : 'off'); }
  catch (error) { console.warn('Unable to save home sound preference:', error); }
}

export function playHomeSound(name: HomeSound, userGesture = false, cooldown = 100) {
  if (!isHomeSoundEnabled() || document.hidden) return;
  // Never create/unlock audio for initial greeting, hover, or automatic typing.
  // An actual click unlocks one shared context for subsequent dialogue cues.
  if (!context) {
    if (!userGesture || typeof window.AudioContext !== 'function') return;
    try {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = .45;
      master.connect(context.destination);
    } catch (error) { console.warn('Home audio unavailable:', error); return; }
  }
  const audio = context;
  const play = () => {
    if (!isHomeSoundEnabled() || document.hidden || audio.state !== 'running') return;
    const now = performance.now();
    if (now - (lastPlayed.get(name) ?? -Infinity) < cooldown) return;
    lastPlayed.set(name, now);
    for (const note of sounds[name]) {
      const start = audio.currentTime + (note.at ?? 0) / 1000;
      const end = start + note.ms / 1000;
      const oscillator = audio.createOscillator();
      oscillator.type = note.wave;
      oscillator.frequency.setValueAtTime(note.hz, start);
      if (note.to) oscillator.frequency.exponentialRampToValueAtTime(note.to, end);
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = note.cut;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(note.gain, start + Math.min(note.atk / 1000, note.ms / 1000 * .6));
      gain.gain.exponentialRampToValueAtTime(.0001, end);
      oscillator.connect(filter).connect(gain).connect(master!);
      oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
      oscillator.start(start); oscillator.stop(end + .02);
    }
  };
  if (audio.state === 'running') play();
  else if (userGesture) void audio.resume().then(play).catch(error => console.warn('Unable to resume home audio:', error));
}
