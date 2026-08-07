import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addBeeGameLibraryResourceToWorkspace,
  readBeeGameAssetManifest,
  writeBeeGameAssetManifest,
} from './asset-contracts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('source and delivered resource binding', () => {
  test('keeps converted source and target output under one stable resource identity', async () => {
    const sourceBytes = new TextEncoder().encode('Kaydara FBX Binary  test')
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-delivered-resource-'))
    roots.push(workspace)
    await writeBeeGameAssetManifest(workspace, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['glb'], resource_library_usage: 'preferred',
        runtime_asset_root: 'assets/runtime', content_root: 'assets/content', generated_asset_root: 'assets/generated',
      },
      requirements: [{ id: 'visual.tower', required: true, acquisition_profile: {
        dimensions: ['3D'], asset_kinds: ['model'], usage_tags: ['building'], capabilities: [], styles: [],
      } }],
      resources: [],
    })
    await addBeeGameLibraryResourceToWorkspace(workspace, {
      id: 'tower.model', destination_path: 'assets/runtime/library',
      pack_id: 'pack-a', pack_version: '1.0.0', element_id: 'tower', element_path: 'tower.fbx',
      source_url: 'https://resource.invalid/tower.fbx', selection_reason: ['Structured match.'],
      source_hash: createHash('sha256').update(sourceBytes).digest('hex'),
      asset_kind: 'model',
      delivery: { disposition: 'convert', source_format: 'fbx', target_format: 'glb', adapter_id: 'assimp-fbx-glb2' },
    }, async () => new Response(sourceBytes), {
      convert: async files => {
        expect(files.map(file => file.name)).toEqual(['tower.fbx'])
        return { filename: 'tower.glb', bytes: new TextEncoder().encode('glTF converted') }
      },
    })

    const resource = (await readBeeGameAssetManifest(workspace)).resources[0]!
    expect(resource.root_path).toBe('assets/generated/tower.model/delivery/tower.glb')
    expect(resource.file_paths).toEqual([
      'assets/generated/tower.model/delivery/tower.glb',
      'assets/generated/tower.model/source/tower.fbx',
    ])
    expect(resource.source).toEqual(expect.objectContaining({ type: 'resource-library', element_id: 'tower' }))
  })

  test('retries a transient certificate transport failure without changing the pinned resource', async () => {
    const sourceBytes = new TextEncoder().encode('Kaydara FBX Binary  test')
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-download-'))
    roots.push(workspace)
    await writeBeeGameAssetManifest(workspace, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['fbx'], resource_library_usage: 'preferred',
        runtime_asset_root: 'assets/runtime', content_root: 'assets/content', generated_asset_root: 'assets/generated',
      },
      requirements: [{ id: 'visual.tower', required: true, acquisition_profile: {
        dimensions: ['3D'], asset_kinds: ['model'], usage_tags: ['building'], capabilities: [], styles: [],
      } }],
      resources: [],
    })
    let calls = 0
    const result = await addBeeGameLibraryResourceToWorkspace(workspace, {
      id: 'tower.model', destination_path: 'assets/runtime/library',
      pack_id: 'pack-a', pack_version: '1.0.0', element_id: 'tower', element_path: 'tower.fbx',
      source_url: 'https://resource.invalid/tower.fbx', selection_reason: ['Structured match.'],
      source_hash: createHash('sha256').update(sourceBytes).digest('hex'), asset_kind: 'model',
    }, async () => {
      calls += 1
      if (calls < 3) throw Object.assign(new Error('certificate verification failed'), { code: 'UNKNOWN_CERTIFICATE_VERIFICATION_ERROR' })
      return new Response(sourceBytes)
    })

    expect(calls).toBe(3)
    expect(result.resource.source).toEqual(expect.objectContaining({ type: 'resource-library', element_id: 'tower' }))
  })
})
