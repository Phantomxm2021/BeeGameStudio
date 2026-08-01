import { describe, expect, it } from 'bun:test'
import { parseCanonicalBeeGameAssetManifest } from '../beegame/asset-contracts'

describe('BeeGame canonical v7 resource contract', () => {
  const manifest = {
    version: 7,
    project_target: {
      asset_format_capabilities: ['png', 'json', 'yaml'],
      resource_library_usage: 'preferred',
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [{ id: 'visual.player', required: true }],
    resources: [],
  }

  it('accepts the single resource-content manifest', () => {
    expect(parseCanonicalBeeGameAssetManifest(manifest)).toMatchObject({
      version: 7,
      requirements: [{ id: 'visual.player', required: true }],
      resources: [],
    })
  })

  it('rejects composition and legacy requirement state', () => {
    expect(() => parseCanonicalBeeGameAssetManifest({
      ...manifest,
      requirements: [{ id: 'visual.player', required: true, status: 'ready' }],
      compositions: [],
    })).toThrow(/unknown fields|unknown field/i)
  })

  it('requires the canonical resource, content and generated roots', () => {
    expect(() => parseCanonicalBeeGameAssetManifest({
      ...manifest,
      project_target: { ...manifest.project_target, content_root: 'assets/runtime' },
    })).toThrow(/content_root must be assets\/content/i)
  })
})
