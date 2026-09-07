import { z } from 'zod'

export const BEEGAME_PROGRAMMATIC_AUDIO_FORMAT =
  'beegame-programmatic-audio-v1' as const

const oscillatorSourceSchema = z
  .object({
    type: z.literal('oscillator'),
    waveform: z.enum(['sine', 'square', 'triangle', 'sawtooth']),
    frequency_hz: z.number().finite().positive().max(24_000),
    end_frequency_hz: z.number().finite().positive().max(24_000).optional(),
  })
  .strict()

const noiseSourceSchema = z
  .object({
    type: z.literal('noise'),
    color: z.enum(['white', 'pink', 'brown']),
  })
  .strict()

const programmaticAudioVoiceSchema = z
  .object({
    source: z.discriminatedUnion('type', [
      oscillatorSourceSchema,
      noiseSourceSchema,
    ]),
    start_ms: z.number().finite().nonnegative(),
    duration_ms: z.number().finite().positive(),
    gain: z.number().finite().min(0).max(1),
    attack_ms: z.number().finite().nonnegative().optional(),
    release_ms: z.number().finite().nonnegative().optional(),
    pan: z.number().finite().min(-1).max(1).optional(),
  })
  .strict()

const programmaticAudioCueSchema = z
  .object({
    id: z.string().trim().min(1),
    duration_ms: z.number().finite().positive().max(300_000),
    loop: z
      .object({
        start_ms: z.number().finite().nonnegative(),
        end_ms: z.number().finite().positive(),
      })
      .strict()
      .optional(),
    voices: z.array(programmaticAudioVoiceSchema).min(1).max(256),
  })
  .strict()
  .superRefine((cue, context) => {
    if (cue.loop && cue.loop.end_ms <= cue.loop.start_ms)
      context.addIssue({
        code: 'custom',
        path: ['loop', 'end_ms'],
        message: 'must be greater than loop.start_ms',
      })
    if (cue.loop && cue.loop.end_ms > cue.duration_ms)
      context.addIssue({
        code: 'custom',
        path: ['loop', 'end_ms'],
        message: 'must not exceed cue duration_ms',
      })
    cue.voices.forEach((voice, index) => {
      if (voice.start_ms + voice.duration_ms > cue.duration_ms)
        context.addIssue({
          code: 'custom',
          path: ['voices', index, 'duration_ms'],
          message: 'voice must end within cue duration_ms',
        })
      if ((voice.attack_ms ?? 0) + (voice.release_ms ?? 0) > voice.duration_ms)
        context.addIssue({
          code: 'custom',
          path: ['voices', index],
          message: 'attack_ms plus release_ms must not exceed duration_ms',
        })
    })
  })

export const beeGameProgrammaticAudioResourceSchema = z
  .object({
    format: z.literal(BEEGAME_PROGRAMMATIC_AUDIO_FORMAT),
    cues: z.array(programmaticAudioCueSchema).min(1).max(32),
  })
  .strict()
  .superRefine((resource, context) => {
    const ids = new Set<string>()
    resource.cues.forEach((cue, index) => {
      if (ids.has(cue.id))
        context.addIssue({
          code: 'custom',
          path: ['cues', index, 'id'],
          message: 'cue id must be unique',
        })
      ids.add(cue.id)
    })
  })

export type BeeGameProgrammaticAudioResource = z.infer<
  typeof beeGameProgrammaticAudioResourceSchema
>

export function parseBeeGameProgrammaticAudioResource(
  value: unknown,
): BeeGameProgrammaticAudioResource {
  const result = beeGameProgrammaticAudioResourceSchema.safeParse(value)
  if (result.success) return result.data
  const detail = result.error.issues
    .map(issue => `${issue.path.join('.') || 'resource'}: ${issue.message}`)
    .join('; ')
  throw new Error(`Invalid BeeGame programmatic audio resource: ${detail}`)
}

export function parseBeeGameProgrammaticAudioText(
  value: string,
): BeeGameProgrammaticAudioResource {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Invalid BeeGame programmatic audio resource: invalid JSON')
  }
  return parseBeeGameProgrammaticAudioResource(parsed)
}
