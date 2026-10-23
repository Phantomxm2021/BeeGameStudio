import { describe, expect, it } from 'bun:test'
import { parseCanonicalBeeGameAssetManifest } from '../beegame/asset-contracts'

describe('BeeGame canonical modular resource contract', () => {
  const manifest = {
    version: 9,
    project_target: {
      asset_format_capabilities: ['png', 'json', 'yaml'],
      resource_library_usage: 'preferred',
      runtime_asset_root: 'assets/runtime',
      generated_asset_root: 'assets/generated',
    },
    requirements: [{ id: 'visual.player', required: true, acquisition_profile: {
      dimensions: ['2D'], asset_kinds: ['image'], usage_tags: [], capabilities: [], styles: [],
    } }],
    resources: [],
  }

  it('accepts the single resource manifest', () => {
    expect(parseCanonicalBeeGameAssetManifest(manifest)).toMatchObject({
      version: 9,
      requirements: [{ id: 'visual.player', required: true, acquisition_profile: expect.any(Object) }],
      resources: [],
    })
  })

  it('rejects retired and unknown manifest state', () => {
    expect(() => parseCanonicalBeeGameAssetManifest({
      ...manifest,
      requirements: [{ ...manifest.requirements[0], status: 'ready' }],
      retired_records: [],
    })).toThrow(/unknown fields|unknown field/i)
  })

  it('rejects the retired resource content root', () => {
    expect(() => parseCanonicalBeeGameAssetManifest({
      ...manifest,
      project_target: { ...manifest.project_target, content_root: 'assets/content' },
    })).toThrow(/unknown fields/i)
  })
})
