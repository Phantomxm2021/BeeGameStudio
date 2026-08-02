import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'bun:test'
import { createNativeAssetManifestTool } from './native-asset-manifest-tool'
import { readBeeGameAssetManifest } from './asset-contracts'

type Tool = { call(input: unknown): Promise<{ data: Record<string, unknown> }> }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('native AssetManifest v7 boundary', () => {
  it('creates requirements and resources without compositions', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'required',
    }) as Tool
    await tool.call({ action: 'submit_resource_plan', project_target: {
      asset_format_capabilities: ['png', 'json', 'yaml'],
    }, requirements: [{ id: 'visual.player', required: true }] })
    const manifest = await readBeeGameAssetManifest(workspace)
    expect(manifest).toEqual(expect.objectContaining({ version: 7, resources: [] }))
    expect(manifest.project_target?.resource_library_usage).toBe('required')
    expect(manifest.project_target).toMatchObject({
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    })
    expect(manifest).not.toHaveProperty('compositions')
  })

  it('does not expose confirmed policy as model-controlled input', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'required',
    }) as Tool

    await expect(tool.call({ action: 'submit_resource_plan', project_target: {
      asset_format_capabilities: ['png'], resource_library_usage: 'preferred',
    }, requirements: [{ id: 'visual.player' }] })).rejects.toThrow()
  })

  it('decodes binary resources without routing bytes through generic file tools', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'optional',
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['png'] },
      requirements: [{ id: 'visual.player' }],
    })

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await tool.call({
      action: 'author_encoded_resources',
      resources: [{
        id: 'player-placeholder',
        root_path: 'assets/runtime/player.png',
        file_paths: ['assets/runtime/player.png'],
        provisional: true,
        reason: 'No suitable library resource was selected.',
        selection_reason: ['Independent replaceable placeholder.'],
        files: [{ path: 'assets/runtime/player.png', base64: bytes.toString('base64') }],
      }],
    })

    expect(await readFile(join(workspace, 'assets/runtime/player.png'))).toEqual(bytes)
    expect((await readBeeGameAssetManifest(workspace)).resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'player-placeholder',
        status: 'verified',
        provisional: true,
      }),
    ]))
  })

  it('authors and registers compact independent visual placeholders in one operation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'preferred',
      allowResourceRemediationMutations: true,
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['gltf', 'png'] },
      requirements: [{ id: 'visual.marker' }, { id: 'visual.palette' }],
    })

    await tool.call({
      action: 'author_provisional_resources',
      resources: [
        {
          id: 'marker-placeholder',
          destination_path: 'assets/runtime/models/marker.gltf',
          format: 'gltf',
          reason: 'No matching library model was selected.',
          selection_reason: ['Independent visible placeholder.'],
          asset_kind: 'model',
          color: 'cyan',
        },
        {
          id: 'palette-placeholder',
          destination_path: 'assets/runtime/textures/palette.png',
          format: 'png',
          reason: 'No matching library texture was selected.',
          selection_reason: ['Independent visible placeholder.'],
          asset_kind: 'image',
          color: 'amber',
        },
        {
          id: 'music-placeholder',
          destination_path: 'assets/runtime/audio/music.wav',
          format: 'wav',
          reason: 'No matching library music was selected.',
          selection_reason: ['Independent audible placeholder.'],
          asset_kind: 'audio-bank',
          cue_ids: ['build', 'combat', 'victory'],
        },
      ],
    })

    expect(JSON.parse(await readFile(join(workspace, 'assets/runtime/models/marker.gltf'), 'utf8'))).toMatchObject({
      asset: { version: '2.0' },
      nodes: [{ extras: { provisional: true } }],
    })
    expect([...await readFile(join(workspace, 'assets/runtime/textures/palette.png'))].slice(0, 8)).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    const wav = await readFile(join(workspace, 'assets/runtime/audio/music.wav'))
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.includes(Buffer.from('build\0'))).toBe(true)
    expect(wav.includes(Buffer.from('combat\0'))).toBe(true)
    expect(wav.includes(Buffer.from('victory\0'))).toBe(true)
    expect(
      (await readBeeGameAssetManifest(workspace)).project_target
        ?.asset_format_capabilities,
    ).toEqual(['gltf', 'png', 'wav'])
    await tool.call({
      action: 'author_provisional_resources',
      resources: [{
        id: 'palette-placeholder',
        destination_path: 'assets/runtime/textures/palette-revised.png',
        format: 'png',
        reason: 'Correct the provisional visual contract.',
        selection_reason: ['Stable identity with a corrected standalone file.'],
        asset_kind: 'texture',
        color: 'violet',
      }],
    })
    await expect(readFile(join(workspace, 'assets/runtime/textures/palette.png'))).rejects.toThrow()
    expect((await readBeeGameAssetManifest(workspace)).resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'marker-placeholder', provisional: true, status: 'verified' }),
      expect.objectContaining({
        id: 'palette-placeholder',
        root_path: 'assets/runtime/textures/palette-revised.png',
        provisional: true,
        status: 'verified',
      }),
      expect.objectContaining({ id: 'music-placeholder', provisional: true, status: 'verified' }),
    ]))
    expect(
      (await readBeeGameAssetManifest(workspace)).resources.find(
        resource => resource.id === 'music-placeholder',
      )?.technical_facts,
    ).toEqual(
      expect.objectContaining({
        format: 'wav',
        sample_rate_hz: 44_100,
        channels: 1,
        bit_depth: 16,
        cue_count: 3,
      }),
    )
  })

  it('prunes only unreferenced non-requirement inventory during remediation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'preferred',
      allowResourceRemediationMutations: true,
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['png'] },
      requirements: [{ id: 'visual.marker' }],
    })
    await tool.call({
      action: 'author_provisional_resources',
      resources: [
        {
          id: 'unused-library-leaf',
          destination_path: 'assets/runtime/unused.png',
          format: 'png',
          reason: 'Temporary inventory leaf.',
          selection_reason: ['Will be superseded.'],
          asset_kind: 'image',
        },
      ],
    })
    await tool.call({
      action: 'prune_unbound_resources',
      resource_ids: ['unused-library-leaf'],
    })
    await expect(
      readFile(join(workspace, 'assets/runtime/unused.png')),
    ).rejects.toThrow()
    expect((await readBeeGameAssetManifest(workspace)).resources).toEqual([])
    await expect(
      tool.call({
        action: 'prune_unbound_resources',
        resource_ids: ['visual.marker'],
      }),
    ).rejects.toThrow('Requirement resource identities must be repaired in place')
  })

  it('does not expose remediation mutations to ordinary resource authoring', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'preferred',
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['png'] },
      requirements: [{ id: 'visual.marker' }],
    })

    await expect(
      tool.call({
        action: 'author_provisional_resources',
        resources: [{
          id: 'audio-placeholder',
          destination_path: 'assets/runtime/audio/cues.wav',
          format: 'wav',
          reason: 'No matching library audio was selected.',
          selection_reason: ['Independent audible placeholder.'],
          asset_kind: 'audio-bank',
          cue_ids: ['action'],
        }],
      }),
    ).rejects.toThrow(
      'Format capabilities may be extended only by an accepted resource remediation replacement',
    )
    await expect(
      tool.call({
        action: 'prune_unbound_resources',
        resource_ids: ['inventory-leaf'],
      }),
    ).rejects.toThrow(
      'Inventory pruning is available only during an accepted resource remediation',
    )
  })

  it('requires content references to be removed before pruning inventory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'preferred',
      allowResourceRemediationMutations: true,
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['png', 'json'] },
      requirements: [{ id: 'visual.marker' }],
    })
    await tool.call({
      action: 'author_provisional_resources',
      resources: [{
        id: 'referenced-inventory-leaf',
        destination_path: 'assets/runtime/referenced.png',
        format: 'png',
        reason: 'Temporary inventory leaf.',
        selection_reason: ['Used by canonical content.'],
        asset_kind: 'image',
      }],
    })
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    await writeFile(
      join(workspace, 'assets/content/entities.json'),
      JSON.stringify({
        schema: 'beegame-content-v1',
        id: 'entities',
        kind: 'entity-definitions',
        fulfills: [],
        resources: ['referenced-inventory-leaf'],
        data: {},
      }),
    )

    await expect(
      tool.call({
        action: 'prune_unbound_resources',
        resource_ids: ['referenced-inventory-leaf'],
      }),
    ).rejects.toThrow(
      'Remove resource references from JSON/YAML before pruning inventory',
    )
  })

  it('can prune an obsolete inventory record whose local file is already absent', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'preferred',
      allowResourceRemediationMutations: true,
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['png'] },
      requirements: [{ id: 'visual.marker' }],
    })
    await tool.call({
      action: 'author_provisional_resources',
      resources: [{
        id: 'missing-inventory-leaf',
        destination_path: 'assets/runtime/missing.png',
        format: 'png',
        reason: 'Temporary inventory leaf.',
        selection_reason: ['No longer used.'],
        asset_kind: 'image',
      }],
    })
    await rm(join(workspace, 'assets/runtime/missing.png'))

    await tool.call({
      action: 'prune_unbound_resources',
      resource_ids: ['missing-inventory-leaf'],
    })
    expect((await readBeeGameAssetManifest(workspace)).resources).toEqual([])
  })
})
