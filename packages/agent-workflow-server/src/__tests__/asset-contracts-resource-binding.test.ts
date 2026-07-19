import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  effectiveAssetFormats,
  importBeeGameLibraryResourceInWorkspace,
  normalizeBeeGameAssetManifest,
  readBeeGameAssetManifest,
  uploadBeeGameAsset,
} from '../beegame/asset-contracts'

describe('BeeGame resource contract migration', () => {
  test('intersects explicit requirement formats with the target runtime format contract', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      project_target: { asset_format_capabilities: ['glb', 'png', 'ogg'] },
      slots: [{ id: 'requirement-1', resource_requirement: { accepted_formats: ['fbx', 'glb'] } }],
    })
    expect(effectiveAssetFormats(manifest.requirements[0]!, manifest.project_target)).toEqual(['glb'])
  })

  test('does not claim technical compatibility without project target capabilities', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      slots: [{ id: 'requirement-1', resource_requirement: { accepted_formats: ['glb'] } }],
    })
    expect(effectiveAssetFormats(manifest.requirements[0]!, manifest.project_target)).toEqual([])
  })

  test('preserves structured requirements without inferring semantics from an id or label', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 5,
      requirements: [{
        id: 'requirement-1', name: 'Display label',
        resource_requirement: {
          category: 'models', dimension: '3D', accepted_formats: ['glb', 'fbx'],
          styles: ['Stylized'], game_types: ['Adventure'], purpose: 'Player traversal obstacle',
        },
      }],
      imports: [], compositions: [],
    })
    expect(manifest.requirements[0]?.resource_requirement).toEqual({
      category: 'models', dimension: '3D', accepted_formats: ['glb', 'fbx'],
      styles: ['Stylized'], game_types: ['Adventure'], purpose: 'Player traversal obstacle',
    })
  })

  test('keeps only canonical resource usage tags in a project requirement', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 5,
      requirements: [{ id: 'requirement-1', resource_requirement: { category: 'models', tags: ['character', 'free-text'] } }],
      imports: [], compositions: [],
    })
    expect(manifest.requirements[0]?.resource_requirement).toEqual({ category: 'models', accepted_formats: [], styles: [], game_types: [], tags: ['character'], purpose: undefined })
  })

  test('normalizes legacy slot dictionaries without inventing metadata from their keys', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: '1.1.0', integration_mode: 'filesystem',
      slots: {
        old_key: {
          slot_id: 'player-placeholder', purpose: 'Player character model', target_path: 'assets/models/player.fbx',
          status: 'placeholder', resource_requirement: { tags: ['character'], accepted_formats: ['fbx'] },
        },
      },
    })
    expect(manifest.project_target?.integration_mode).toBe('filesystem')
    expect(manifest.requirements).toEqual([expect.objectContaining({
      id: 'player-placeholder', target: expect.objectContaining({ path: 'assets/models/player.fbx' }),
      resource_requirement: expect.objectContaining({ tags: ['character'], accepted_formats: ['fbx'] }),
    })])
  })

  test('migrates a historical slot binding into an independent import exactly once', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 4,
      slots: [{
        id: 'hero', status: 'integrated', uploaded_files: ['assets/models/hero.glb'],
        integration_evidence: { runtime_event_ids: ['runtime.hero.loaded'] },
        resource_binding: {
          pack_id: 'character-pack', pack_version: '2.0.0', element_id: 'hero-root', element_path: 'models/hero.glb',
          source_url: 'https://storage.invalid/signed', selected_at: '2026-07-11T00:00:00.000Z', selection_reason: ['explicit-selection'],
        },
      }],
    })
    expect(manifest.imports).toEqual([expect.objectContaining({
      id: 'legacy.hero', status: 'referenced', root_path: 'assets/models/hero.glb',
      source: expect.objectContaining({ type: 'resource-library', pack_id: 'character-pack', element_id: 'hero-root' }),
    })])
  })

  test('records a user upload as an import instead of creating a Pack binding on the requirement', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-user-import-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 5,
        project_target: { asset_format_capabilities: ['png'] },
        requirements: [{ id: 'title-art', resource_requirement: { accepted_formats: ['png'] } }],
        imports: [], compositions: [],
      }))
      const result = await uploadBeeGameAsset(workspace, 'title-art', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'title.png'))
      expect(result.manifest.imports).toEqual([expect.objectContaining({ id: 'upload.title-art', source: { type: 'user-upload' }, status: 'available' })])
      expect(result.requirement.resource_binding).toBeUndefined()
      const persisted = JSON.parse(await readFile(join(workspace, 'assets/asset-manifest.json'), 'utf8'))
      expect(persisted).toEqual(expect.objectContaining({ version: 5, imports: [expect.objectContaining({ id: 'upload.title-art' })] }))
      expect(persisted.requirements[0].satisfied_by.import_ids).toEqual(['upload.title-art'])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('marks a migrated import failed when its recorded project file no longer exists', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-missing-import-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 4,
        slots: [{ id: 'item', status: 'integrated', uploaded_files: ['assets/models/item.glb'] }],
      }))
      const manifest = await readBeeGameAssetManifest(workspace)
      expect(manifest.imports?.[0]).toEqual(expect.objectContaining({ status: 'failed', error: expect.any(String) }))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('reuses a byte-identical dependency shared by several Pack elements', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-shared-dependency-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 5,
        project_target: { asset_format_capabilities: ['fbx', 'png'] },
        requirements: [], imports: [], compositions: [],
      }))
      const fetchImpl = async (input: RequestInfo | URL) => new Response(
        String(input).includes('texture') ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : new Uint8Array([1, 2, 3]),
      )
      const dependency = {
        key: 'texture', parent_key: 'root', element_id: 'texture-id', element_path: 'Textures/shared.png',
        reference_path: 'Textures/shared.png', source_url: 'https://signed.example/texture', kind: 'texture',
      }
      await importBeeGameLibraryResourceInWorkspace(workspace, {
        id: 'model-a', destination_path: 'assets/kit', pack_id: 'pack-a', pack_version: '1.0.0',
        element_id: 'model-a-id', element_path: 'models/a.fbx', source_url: 'https://signed.example/model-a', dependencies: [dependency],
      }, fetchImpl)
      const result = await importBeeGameLibraryResourceInWorkspace(workspace, {
        id: 'model-b', destination_path: 'assets/kit', pack_id: 'pack-a', pack_version: '1.0.0',
        element_id: 'model-b-id', element_path: 'models/b.fbx', source_url: 'https://signed.example/model-b', dependencies: [dependency],
      }, fetchImpl)

      expect(result.resourceImport.local_files).toContain('assets/kit/Textures/shared.png')
      await expect(readFile(join(workspace, 'assets/kit/Textures/shared.png'))).resolves.toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('refuses to overwrite a shared dependency with different bytes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-conflicting-dependency-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 5,
        project_target: { asset_format_capabilities: ['fbx', 'png'] },
        requirements: [], imports: [], compositions: [],
      }))
      let textureVersion = 1
      const fetchImpl = async (input: RequestInfo | URL) => new Response(
        String(input).includes('texture') ? new Uint8Array([0x89, 0x50, 0x4e, textureVersion]) : new Uint8Array([1, 2, 3]),
      )
      const dependency = {
        key: 'texture', parent_key: 'root', element_id: 'texture-id', element_path: 'Textures/shared.png',
        reference_path: 'Textures/shared.png', source_url: 'https://signed.example/texture', kind: 'texture',
      }
      await importBeeGameLibraryResourceInWorkspace(workspace, {
        id: 'model-a', destination_path: 'assets/kit', pack_id: 'pack-a', pack_version: '1.0.0',
        element_id: 'model-a-id', element_path: 'models/a.fbx', source_url: 'https://signed.example/model-a', dependencies: [dependency],
      }, fetchImpl)
      textureVersion = 2
      await expect(importBeeGameLibraryResourceInWorkspace(workspace, {
        id: 'model-b', destination_path: 'assets/kit', pack_id: 'pack-a', pack_version: '1.0.0',
        element_id: 'model-b-id', element_path: 'models/b.fbx', source_url: 'https://signed.example/model-b', dependencies: [dependency],
      }, fetchImpl)).rejects.toThrow('already exists with different content')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
