export type NoteEvent = { at: number; beats: number; note: string | number | null; velocity?: number }
export type PhraseOptions = {
  bpm: number; startBeat?: number; waveform?: 'sine' | 'square' | 'triangle' | 'sawtooth'
  gain?: number; attackMs?: number; releaseMs?: number; pan?: number
}
export type OscillatorVoice = {
  source: { type: 'oscillator'; waveform: NonNullable<PhraseOptions['waveform']>; frequency_hz: number }
  start_ms: number; duration_ms: number; gain: number; attack_ms: number; release_ms: number; pan: number
}
export function noteHz(note: string | number): number
export function beatMs(beats: number, bpm: number): number
export function phrase(events: NoteEvent[], options: PhraseOptions): OscillatorVoice[]
export function repeatPhrase(events: NoteEvent[], options: PhraseOptions & { count: number; periodBeats: number }): OscillatorVoice[]
export function partials(fundamentalHz: number, components: { ratio: number; durationMs: number; gain: number }[],
  options?: { startMs?: number; attackMs?: number; pan?: number }): OscillatorVoice[]
export function audioRequest<C extends { id: string; duration_ms: number; voices: unknown[] }, O extends Record<string, string>>(
  cues: C[], outputs: O, sampleRate?: number,
): { operation: 'audio'; recipe: { format: 'beegame-programmatic-audio-v1'; cues: C[] }; outputs: O; sampleRate: number }
export const help: string
