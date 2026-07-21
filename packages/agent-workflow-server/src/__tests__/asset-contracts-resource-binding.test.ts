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

describe('BeeGame canonical resource contract', () => {
  test('intersects explicit requirement formats with the target runtime format contract', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      project_target: { asset_format_capabilities: ['glb', 'png', 'ogg'] },
      requirements: [{ id: 'requirement-1', resource_requirement: { accepted_formats: ['fbx', 'glb'] } }],
    })
    expect(effectiveAssetFormats(manifest.requirements[0]!, manifest.project_target)).toEqual(['glb'])
  })

  test('does not claim technical compatibility without project target capabilities', () => {
    const manifest = normalizeBeeGameAssetManifest({
      version: 1,
      requirements: [{ id: 'requirement-1', resource_requirement: { accepted_formats: ['glb'] } }],
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

  test('rejects legacy slot structures instead of silently migrating uncertain semantics', () => {
    expect(() => normalizeBeeGameAssetManifest({ version: 4, slots: [] })).toThrow(
      'legacy slots manifests require explicit migration',
    )
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

  test('marks a canonical import failed when its recorded project file no longer exists', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-missing-import-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 5,
        requirements: [],
        imports: [{ id: 'item', source: { type: 'user-upload' }, status: 'available', root_path: 'assets/models/item.glb', local_files: ['assets/models/item.glb'], selected_at: '2026-07-21T00:00:00.000Z', selection_reason: ['user upload'] }],
        compositions: [],
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

  test('keeps preferred Resource Library imports inside the target-native asset root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-runtime-asset-root-'))
    try {
      await Bun.write(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 5,
        project_target: {
          asset_format_capabilities: ['glb'],
          resource_library_usage: 'preferred',
          runtime_asset_root: 'runtime/assets',
        },
        requirements: [], imports: [], compositions: [],
      }))
      const input = {
        id: 'model', pack_id: 'pack-a', pack_version: '1.0.0',
        element_id: 'model-id', element_path: 'models/model.glb', source_url: 'https://signed.example/model',
      }
      const fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]))

      await expect(importBeeGameLibraryResourceInWorkspace(workspace, {
        ...input,
        destination_path: 'inventory/models',
      }, fetchImpl)).rejects.toThrow('must be inside project_target.runtime_asset_root')

      const result = await importBeeGameLibraryResourceInWorkspace(workspace, {
        ...input,
        destination_path: 'runtime/assets/models',
      }, fetchImpl)
      expect(result.resourceImport.root_path).toBe('runtime/assets/models/model.glb')
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
