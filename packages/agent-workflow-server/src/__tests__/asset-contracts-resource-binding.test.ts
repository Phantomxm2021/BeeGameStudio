import { describe, expect, test } from 'bun:test'
import { bindBeeGameLibraryResource, normalizeBeeGameAssetManifest } from '../beegame/asset-contracts'

describe('BeeGame resource bindings', () => {
  test('binds a library selection without replacing the project target or user uploads', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      slots: [{ id: 'environment.tree', target: { path: 'assets/environment' }, uploaded_files: ['assets/environment/placeholder.png'] }],
    })

    const result = bindBeeGameLibraryResource(manifest, 'environment.tree', {
      pack_id: 'fantasy-pack', pack_version: '1.2.0', element_id: 'oak-glb',
      source_url: 'https://storage.example/signed-oak', selected_at: '2026-07-11T00:00:00.000Z',
      selection_reason: ['category:models', 'style:Fantasy'],
    })

    expect(result.slot).toEqual(expect.objectContaining({
      target: { path: 'assets/environment' }, uploaded_files: ['assets/environment/placeholder.png'],
      resource_binding: expect.objectContaining({ element_id: 'oak-glb' }),
    }))
    expect(result.manifest.slots[0]?.resource_binding?.pack_id).toBe('fantasy-pack')
  })

  test('rejects an unknown asset slot', () => {
    expect(() => bindBeeGameLibraryResource({ version: 1, slots: [] }, 'missing', {
      pack_id: 'fantasy-pack', pack_version: '1.2.0', element_id: 'oak-glb', source_url: 'https://storage.example/signed-oak', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [],
    })).toThrow('Asset slot not found: missing')
  })
})
