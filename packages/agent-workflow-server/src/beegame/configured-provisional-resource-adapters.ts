import { z } from 'zod/v4'
import { RESOURCE_ASSET_KINDS } from '@bee-game-studio/beegame-resource-core'
import {
  compactPlaceholderGltf,
  compactPlaceholderPng,
  compactPlaceholderWav,
  type ProvisionalResourceAdapter,
} from './provisional-resource-adapters'

const colorSchema = z
  .enum(['cyan', 'amber', 'green', 'red', 'violet', 'neutral'])
  .default('neutral')
const visualParametersSchema = z
  .object({ color: colorSchema.optional() })
  .strict()
  .optional()
const audioParametersSchema = z
  .object({ cue_ids: z.array(z.string().trim().min(1)).min(1).max(32) })
  .strict()

/**
 * Adapters registered by the currently deployed target toolchain. They are
 * injected into the engine-neutral AssetManifest boundary; that boundary has
 * no fallback adapter set of its own.
 */
export const CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS: readonly ProvisionalResourceAdapter[] =
  [
    {
      format: 'gltf',
      assetKinds: ['model', 'mesh'],
      description:
        'gltf: self-contained provisional 3D model; asset_kind must be model; optional parameters.color',
      author(input) {
        if (!['model', 'mesh'].includes(input.assetKind))
          throw new Error('gltf provisional resources require asset_kind model or mesh')
        const parameters = visualParametersSchema.parse(input.parameters)
        const color = parameters?.color ?? 'neutral'
        return {
          bytes: compactPlaceholderGltf(color),
          descriptor: { color },
          technicalFacts: {
            format: 'gltf',
            gltf_version: '2.0',
            bounds_width: 1,
            bounds_height: 1,
            bounds_depth: 1,
          },
        }
      },
    },
    {
      format: 'png',
      assetKinds: ['image', 'texture', 'sprite', 'sprite-sheet', 'sprite-atlas', 'frame-animation', 'tileset', 'tilemap', 'ui-document'],
      description:
        'png: self-contained provisional visual; asset_kind must be image, texture, sprite or ui-document; optional parameters.color',
      author(input) {
        if (
          !['image', 'texture', 'sprite', 'sprite-sheet', 'sprite-atlas', 'frame-animation', 'tileset', 'tilemap', 'ui-document'].includes(
            input.assetKind,
          )
        )
          throw new Error(
            'png provisional resources require a visual asset_kind',
          )
        const parameters = visualParametersSchema.parse(input.parameters)
        const color = parameters?.color ?? 'neutral'
        return {
          bytes: compactPlaceholderPng(color),
          descriptor: { color },
          technicalFacts: {
            format: 'png',
            width: 16,
            height: 16,
            color_space: 'srgb',
            alpha: true,
          },
        }
      },
    },
    {
      format: 'wav',
      assetKinds: ['audio-clip', 'audio-cue', 'audio-bank', 'music', 'ambience', 'voice'],
      description:
        'wav: self-contained provisional PCM cue bank; asset_kind must be audio-cue or audio-bank; parameters.cue_ids is required',
      author(input) {
        if (!['audio-clip', 'audio-cue', 'audio-bank', 'music', 'ambience', 'voice'].includes(input.assetKind))
          throw new Error(
            'wav provisional resources require an audio asset_kind',
          )
        const parameters = audioParametersSchema.parse(input.parameters)
        return {
          bytes: compactPlaceholderWav(parameters.cue_ids),
          descriptor: { cue_ids: parameters.cue_ids },
          technicalFacts: {
            format: 'wav',
            sample_rate_hz: 44_100,
            channels: 1,
            bit_depth: 16,
            cue_count: parameters.cue_ids.length,
            cue_duration_seconds: 0.5,
          },
        }
      },
    },
    {
      format: 'json',
      assetKinds: RESOURCE_ASSET_KINDS,
      description:
        'json: engine-neutral programmatic placeholder recipe for any canonical asset_kind; optional JSON object parameters',
      author(input) {
        const parameters = input.parameters ?? {}
        const document = {
          version: 1,
          kind: 'programmatic-placeholder',
          asset_kind: input.assetKind,
          parameters,
        }
        return {
          bytes: `${JSON.stringify(document, null, 2)}\n`,
          descriptor: { representation: 'programmatic-recipe' },
          technicalFacts: {
            format: 'json',
            schema: 'beegame-programmatic-placeholder-v1',
          },
        }
      },
    },
  ]
