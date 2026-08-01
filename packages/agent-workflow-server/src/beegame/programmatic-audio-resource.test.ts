import { describe, expect, test } from 'bun:test'
import {
  BEEGAME_PROGRAMMATIC_AUDIO_FORMAT,
  parseBeeGameProgrammaticAudioResource,
  parseBeeGameProgrammaticAudioText,
} from './programmatic-audio-resource'

describe('programmatic audio resource', () => {
  test('accepts an engine-neutral playable cue recipe', () => {
    expect(
      parseBeeGameProgrammaticAudioResource({
        format: BEEGAME_PROGRAMMATIC_AUDIO_FORMAT,
        cues: [
          {
            id: 'cue-1',
            duration_ms: 500,
            voices: [
              {
                source: {
                  type: 'oscillator',
                  waveform: 'sine',
                  frequency_hz: 220,
                  end_frequency_hz: 330,
                },
                start_ms: 0,
                duration_ms: 500,
                gain: 0.3,
                attack_ms: 20,
                release_ms: 100,
              },
            ],
          },
        ],
      }).cues,
    ).toHaveLength(1)
  })

  test('rejects metadata cards and non-playable timing', () => {
    expect(() =>
      parseBeeGameProgrammaticAudioText(
        JSON.stringify({
          format: BEEGAME_PROGRAMMATIC_AUDIO_FORMAT,
          description: 'audio placeholder',
        }),
      ),
    ).toThrow('Invalid BeeGame programmatic audio resource')
    expect(() =>
      parseBeeGameProgrammaticAudioResource({
        format: BEEGAME_PROGRAMMATIC_AUDIO_FORMAT,
        cues: [
          {
            id: 'cue-1',
            duration_ms: 100,
            voices: [
              {
                source: { type: 'noise', color: 'pink' },
                start_ms: 50,
                duration_ms: 100,
                gain: 0.2,
              },
            ],
          },
        ],
      }),
    ).toThrow('voice must end within cue duration_ms')
  })
})
