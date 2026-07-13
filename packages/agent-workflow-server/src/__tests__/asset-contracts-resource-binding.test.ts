import { describe, expect, test } from 'bun:test'
import { bindBeeGameLibraryResource, bindBeeGameLibraryResourceInWorkspace, effectiveAssetFormats, integrateBeeGameLibraryResourceInWorkspace, normalizeBeeGameAssetManifest, readBeeGameAssetManifest, removeBeeGameAssetIntegrationInWorkspace, unbindBeeGameLibraryResource } from '../beegame/asset-contracts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('BeeGame resource bindings', () => {
  test('intersects explicit slot formats with the target runtime format contract', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      project_target: { asset_format_capabilities: ['glb', 'png', 'ogg'] },
      slots: [{ id: 'slot-1', resource_requirement: { accepted_formats: ['fbx', 'glb'] } }],
    })

    expect(effectiveAssetFormats(manifest.slots[0]!, manifest.project_target)).toEqual(['glb'])
  })

  test('does not permit automatic format selection without project target capabilities', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      slots: [{ id: 'slot-1', resource_requirement: { accepted_formats: ['glb'] } }],
    })

    expect(effectiveAssetFormats(manifest.slots[0]!, manifest.project_target)).toEqual([])
  })

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

  test('keeps only canonical resource usage tags in a project requirement', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      slots: [{ id: 'slot-1', resource_requirement: { category: 'models', tags: ['character', 'unclassified-free-text'] } }],
    })

    expect(manifest.slots[0]?.resource_requirement).toEqual({ category: 'models', accepted_formats: [], styles: [], game_types: [], tags: ['character'], purpose: undefined })
  })

  test('normalizes legacy slot dictionaries without inventing metadata from their keys', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: '1.1.0',
      integration_mode: 'filesystem',
      slots: {
        player_placeholder: {
          slot_id: 'player_placeholder',
          purpose: 'Player character model',
          target_path: 'assets/models/player.fbx',
          status: 'placeholder',
          resource_requirement: { tags: ['character'], accepted_formats: ['fbx'] },
        },
      },
    })

    expect(manifest.project_target?.integration_mode).toBe('filesystem')
    expect(manifest.slots).toEqual([expect.objectContaining({
      id: 'player_placeholder',
      target: expect.objectContaining({ path: 'assets/models/player.fbx' }),
      resource_requirement: expect.objectContaining({ tags: ['character'], accepted_formats: ['fbx'] }),
    })])
  })

  test('migrates explicit legacy replacement contracts without guessing an unsupported category', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: '1.0.0',
      integration_mode: 'filesystem',
      assets: {
        character: {
          slot_id: 'hero-model',
          purpose: 'Playable character',
          status: 'placeholder',
          replacement: {
            target_path: 'assets/models/hero.glb',
            resource_requirement: {
              category: '3d_character',
              accepted_formats: ['glb'],
              styles: ['Stylized'],
              game_types: ['Adventure'],
              purpose: 'Rigged player character',
            },
          },
        },
      },
    })

    expect(manifest.project_target?.integration_mode).toBe('filesystem')
    expect(manifest.slots).toEqual([expect.objectContaining({
      id: 'hero-model',
      target: expect.objectContaining({ path: 'assets/models/hero.glb' }),
      resource_requirement: {
        category: undefined,
        accepted_formats: ['glb'],
        styles: ['Stylized'],
        game_types: ['Adventure'],
        purpose: 'Rigged player character',
      },
    })])
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

  test('marks a bound slot missing when its copied library file was removed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-missing-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 1,
        slots: [{
          id: 'slot-1', status: 'integrated', target: { path: 'assets/models/item.glb' },
          resource_binding: { pack_id: 'library', pack_version: '1', element_id: 'item', source_url: 'https://storage.example/item', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [] },
        }],
      }))
      const manifest = await readBeeGameAssetManifest(workspace)
      expect(manifest.slots[0]).toEqual(expect.objectContaining({ status: 'missing', placeholder: true }))
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('marks a manually uploaded slot missing when its declared target was removed', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manual-resource-missing-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 1,
        slots: [{ id: 'slot-1', status: 'integrated', target: { path: 'public/assets/item.dat' }, uploaded_files: ['public/assets/item.dat'] }],
      }))
      const manifest = await readBeeGameAssetManifest(workspace)
      expect(manifest.slots[0]).toEqual(expect.objectContaining({ status: 'missing', placeholder: true, integration_error: expect.any(String) }))
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('removes recorded project integration files while preserving the pinned library binding', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-remove-resource-integration-'))
    try {
      await Bun.write(join(workspace, 'public/assets/item.glb'), new Uint8Array([1, 2, 3]))
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 1,
        slots: [{
          id: 'slot-1', status: 'uploaded', placeholder: false, uploaded_files: ['public/assets/item.glb'],
          resource_binding: { pack_id: 'library', pack_version: '1', element_id: 'item', source_url: 'https://storage.example/item', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [] },
        }],
      }))

      const result = await removeBeeGameAssetIntegrationInWorkspace(workspace, 'slot-1')

      expect(result.removedPaths).toEqual(['public/assets/item.glb'])
      expect(result.slot).toEqual(expect.objectContaining({ status: 'placeholder', placeholder: true, uploaded_files: [], resource_binding: expect.objectContaining({ element_id: 'item' }) }))
      expect(await Bun.file(join(workspace, 'public/assets/item.glb')).exists()).toBe(false)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('copies a bound filesystem resource and keeps the slot pending real project integration', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-integration-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({ version: 1, project_target: { asset_format_capabilities: ['glb'] }, slots: [{ id: 'tree', target: { path: 'assets/environment' }, integration_provider: { type: 'filesystem' } }] }))
      await bindBeeGameLibraryResourceInWorkspace(workspace, 'tree', { pack_id: 'fantasy', pack_version: '1', element_id: 'oak', source_url: 'https://storage.example/oak.glb', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [] })
      const result = await integrateBeeGameLibraryResourceInWorkspace(workspace, 'tree', async () => new Response(new Uint8Array([1, 2, 3])))
      expect(result.slot.status).toBe('uploaded')
      await expect(readFile(join(workspace, 'assets/environment/oak.glb'))).resolves.toEqual(Buffer.from([1, 2, 3]))
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('preserves the selected resource extension instead of disguising a GLB as an FBX target', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-format-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({ version: 1, project_target: { asset_format_capabilities: ['glb'] }, slots: [{ id: 'hero', target: { path: 'assets/models/hero.fbx' }, integration_provider: { type: 'filesystem' } }] }))
      await bindBeeGameLibraryResourceInWorkspace(workspace, 'hero', { pack_id: 'library', pack_version: '1', element_id: 'hero-glb', element_path: 'models/hero.glb', source_url: 'https://storage.example/sign/opaque-token', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [] })
      const result = await integrateBeeGameLibraryResourceInWorkspace(workspace, 'hero', async () => new Response(new Uint8Array([1, 2, 3])))

      expect(result.path).toBe('assets/models/hero.glb')
      expect(result.slot.target?.path).toBe('assets/models/hero.glb')
      await expect(readFile(join(workspace, 'assets/models/hero.glb'))).resolves.toEqual(Buffer.from([1, 2, 3]))
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('rejects a library binary whose self-identifying format contradicts its declared path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-format-mismatch-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({ version: 1, project_target: { asset_format_capabilities: ['mp3'] }, slots: [{ id: 'sound', target: { path: 'assets/sound.mp3' }, integration_provider: { type: 'filesystem' } }] }))
      await bindBeeGameLibraryResourceInWorkspace(workspace, 'sound', { pack_id: 'library', pack_version: '1', element_id: 'sound', element_path: 'audio/sound.mp3', source_url: 'https://storage.example/sound', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [] })
      await expect(integrateBeeGameLibraryResourceInWorkspace(workspace, 'sound', async () => new Response(new TextEncoder().encode('OggS')))).rejects.toThrow('Resource binary format mismatch')
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('downgrades a legacy integrated slot when its copied binary contradicts its extension', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-legacy-contract-mismatch-'))
    try {
      await Bun.write(join(workspace, 'assets/models/item.fbx'), new TextEncoder().encode('glTF'))
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 1,
        slots: [{ id: 'item', status: 'integrated', target: { path: 'assets/models/item.fbx' }, uploaded_files: ['assets/models/item.fbx'] }],
      }))
      const manifest = await readBeeGameAssetManifest(workspace)
      expect(manifest.slots[0]).toEqual(expect.objectContaining({
        status: 'failed',
        integration_error: 'File format mismatch: expected .fbx, found glb',
      }))
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })

  test('copies a selected dependency closure into its declared relative layout', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-dependency-closure-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({ version: 1, project_target: { asset_format_capabilities: ['glb', 'png'] }, slots: [{ id: 'scene', target: { path: 'assets/models/scene.glb' }, integration_provider: { type: 'filesystem' } }] }))
      await bindBeeGameLibraryResourceInWorkspace(workspace, 'scene', {
        pack_id: 'library', pack_version: '1', element_id: 'scene', element_path: 'models/scene.glb', source_url: 'https://storage.example/scene.glb', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: [],
        dependencies: [{ key: 'root.0', parent_key: 'root', element_id: 'surface', element_path: 'materials/surface.png', reference_path: 'materials/surface.png', source_url: 'https://storage.example/surface.png' }],
      })
      const result = await integrateBeeGameLibraryResourceInWorkspace(workspace, 'scene', async input => {
        const url = String(input)
        return new Response(url.endsWith('surface.png') ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : new Uint8Array([1, 2, 3]))
      })
      expect(result.slot.uploaded_files).toEqual(expect.arrayContaining(['assets/models/scene.glb', 'assets/models/materials/surface.png']))
      await expect(readFile(join(workspace, 'assets/models/materials/surface.png'))).resolves.toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })
})
