import { describe, expect, test } from 'bun:test'
import { bindBeeGameLibraryResource, bindBeeGameLibraryResourceInWorkspace, integrateBeeGameLibraryResourceInWorkspace, normalizeBeeGameAssetManifest, unbindBeeGameLibraryResource } from '../beegame/asset-contracts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

  test('preserves explicit selection requirements without inferring them from a slot name', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      slots: [{
        id: 'slot-1',
        name: 'Display label',
        resource_requirement: {
          category: 'models',
          dimension: '3D',
          accepted_formats: ['glb', 'fbx'],
          styles: ['Stylized'],
          game_types: ['Adventure'],
          purpose: 'Player traversal obstacle',
        },
      }],
    })

    expect(manifest.slots[0]?.resource_requirement).toEqual({
      category: 'models', dimension: '3D', accepted_formats: ['glb', 'fbx'],
      styles: ['Stylized'], game_types: ['Adventure'], purpose: 'Player traversal obstacle',
    })
  })

  test('rejects an unknown asset slot', () => {
    expect(() => bindBeeGameLibraryResource({ version: 1, slots: [] }, 'missing', {
      pack_id: 'fantasy-pack', pack_version: '1.2.0', element_id: 'oak-glb', source_url: 'https://storage.example/signed-oak', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [],
    })).toThrow('Asset slot not found: missing')
  })

  test('unbinds library provenance without deleting integrated project files', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      slots: [{ id: 'slot-1', status: 'integrated', uploaded_files: ['assets/models/tree.glb'], resource_binding: {
        pack_id: 'library-pack', pack_version: '1.0.0', element_id: 'tree', source_url: 'https://resource.example/tree.glb', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [],
      } }],
    })
    const result = unbindBeeGameLibraryResource(manifest, 'slot-1')
    expect(result.slot.resource_binding).toBeUndefined()
    expect(result.slot.uploaded_files).toEqual(['assets/models/tree.glb'])
    expect(result.slot.status).toBe('integrated')
  })

  test('persists a resource binding in the project asset manifest', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-binding-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({ version: 1, slots: [{ id: 'tree' }] }))
      await bindBeeGameLibraryResourceInWorkspace(workspace, 'tree', {
        pack_id: 'fantasy-pack', pack_version: '1.2.0', element_id: 'oak-glb', source_url: 'https://storage.example/signed-oak', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: ['category:models'],
      })
      expect(JSON.parse(await readFile(join(workspace, 'assets/asset-manifest.json'), 'utf8')).slots[0].resource_binding.element_id).toBe('oak-glb')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('copies a bound filesystem resource and marks the slot integrated', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-integration-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({ version: 1, slots: [{ id: 'tree', target: { path: 'assets/environment' }, integration_provider: { type: 'filesystem' } }] }))
      await bindBeeGameLibraryResourceInWorkspace(workspace, 'tree', { pack_id: 'fantasy', pack_version: '1', element_id: 'oak', source_url: 'https://storage.example/oak.glb', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [] })
      const result = await integrateBeeGameLibraryResourceInWorkspace(workspace, 'tree', async () => new Response(new Uint8Array([1, 2, 3])))
      expect(result.slot.status).toBe('integrated')
      await expect(readFile(join(workspace, 'assets/environment/oak.glb'))).resolves.toEqual(Buffer.from([1, 2, 3]))
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })
})
