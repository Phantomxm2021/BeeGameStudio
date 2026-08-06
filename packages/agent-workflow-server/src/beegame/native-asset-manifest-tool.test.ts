import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'bun:test'
import { createNativeAssetManifestTool } from './native-asset-manifest-tool'
import { CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS } from './configured-provisional-resource-adapters'
import {
  CURRENT_ASSET_MANIFEST_VERSION,
  readBeeGameAssetManifest,
} from './asset-contracts'

type Tool = {
  prompt(): Promise<string>
  call(input: unknown): Promise<{ data: Record<string, unknown> }>
}
const roots: string[] = []
afterEach(async () =>
  Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  ),
)

describe('native modular AssetManifest v8 boundary', () => {
  const visualProfile = {
    dimensions: ['2D'] as const,
    asset_kinds: ['sprite'] as const,
    usage_tags: ['character'] as const,
    capabilities: [] as const,
    styles: ['Stylized'],
  }

  it('creates the canonical requirements and resources manifest', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'required',
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: {
        asset_format_capabilities: ['png', 'json', 'yaml'],
      },
      requirements: [
        {
          id: 'visual.player',
          required: true,
          acquisition_profile: visualProfile,
        },
      ],
    })
    const manifest = await readBeeGameAssetManifest(workspace)
    expect(manifest).toEqual(
      expect.objectContaining({ version: 8, resources: [] }),
    )
    expect(manifest.project_target?.resource_library_usage).toBe('required')
    expect(manifest.project_target).toMatchObject({
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    })
    const index = JSON.parse(
      await readFile(join(workspace, 'assets/asset-manifest.json'), 'utf8'),
    )
    expect(index).toEqual(
      expect.objectContaining({
        version: 8,
        modules: {
          requirements: expect.stringContaining(
            'assets/manifest/requirements/',
          ),
          resources: [],
        },
      }),
    )
    expect(index).not.toHaveProperty('requirements')
    expect(index).not.toHaveProperty('resources')
    expect(
      JSON.parse(
        await readFile(join(workspace, index.modules.requirements), 'utf8'),
      ),
    ).toEqual({
      requirements: [
        {
          id: 'visual.player',
          required: true,
          acquisition_profile: visualProfile,
        },
      ],
    })
    const prompt = await tool.prompt()
    expect(prompt).toContain('canonical modular Manifest v8')
    expect(prompt).not.toContain(
      `version ${CURRENT_ASSET_MANIFEST_VERSION - 1}`,
    )
  })

  it('rejects a resource requirement without a structured acquisition profile', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'preferred',
    }) as Tool

    await expect(
      tool.call({
        action: 'submit_resource_plan',
        project_target: { asset_format_capabilities: ['png'] },
        requirements: [{ id: 'visual.player', required: true }],
      }),
    ).rejects.toThrow('acquisition_profile')
  })

  it('does not expose confirmed policy as model-controlled input', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      resourceLibraryUsage: 'required',
    }) as Tool

    await expect(
      tool.call({
        action: 'submit_resource_plan',
        project_target: {
          asset_format_capabilities: ['png'],
          resource_library_usage: 'preferred',
        },
        requirements: [
          { id: 'visual.player', acquisition_profile: visualProfile },
        ],
      }),
    ).rejects.toThrow()
  })

  it('authors and registers compact independent visual placeholders in one operation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      provisionalResourceAdapters: CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS,
      resourceLibraryUsage: 'preferred',
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['gltf', 'png', 'wav'] },
      requirements: [
        { id: 'visual.marker', acquisition_profile: visualProfile },
        { id: 'visual.palette', acquisition_profile: visualProfile },
      ],
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
          parameters: { color: 'cyan' },
        },
        {
          id: 'palette-placeholder',
          destination_path: 'assets/runtime/textures/palette.png',
          format: 'png',
          reason: 'No matching library texture was selected.',
          selection_reason: ['Independent visible placeholder.'],
          asset_kind: 'image',
          parameters: { color: 'amber' },
        },
        {
          id: 'music-placeholder',
          destination_path: 'assets/runtime/audio/music.wav',
          format: 'wav',
          reason: 'No matching library music was selected.',
          selection_reason: ['Independent audible placeholder.'],
          asset_kind: 'audio-bank',
          parameters: { cue_ids: ['build', 'combat', 'victory'] },
        },
      ],
    })

    expect(
      JSON.parse(
        await readFile(
          join(workspace, 'assets/runtime/models/marker.gltf'),
          'utf8',
        ),
      ),
    ).toMatchObject({
      asset: { version: '2.0' },
      nodes: [{ extras: { provisional: true } }],
    })
    expect(
      [
        ...(await readFile(
          join(workspace, 'assets/runtime/textures/palette.png'),
        )),
      ].slice(0, 8),
    ).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const wav = await readFile(
      join(workspace, 'assets/runtime/audio/music.wav'),
    )
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
      resources: [
        {
          id: 'palette-placeholder',
          destination_path: 'assets/runtime/textures/palette-revised.png',
          format: 'png',
          reason: 'Correct the provisional visual contract.',
          selection_reason: [
            'Stable identity with a corrected standalone file.',
          ],
          asset_kind: 'texture',
          parameters: { color: 'violet' },
        },
      ],
    })
    await expect(
      readFile(join(workspace, 'assets/runtime/textures/palette.png')),
    ).rejects.toThrow()
    expect((await readBeeGameAssetManifest(workspace)).resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'marker-placeholder',
          provisional: true,
          status: 'verified',
        }),
        expect.objectContaining({
          id: 'palette-placeholder',
          root_path: 'assets/runtime/textures/palette-revised.png',
          provisional: true,
          status: 'verified',
        }),
        expect.objectContaining({
          id: 'music-placeholder',
          provisional: true,
          status: 'verified',
        }),
      ]),
    )
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
      provisionalResourceAdapters: CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS,
      resourceLibraryUsage: 'preferred',
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['png'] },
      requirements: [
        { id: 'visual.marker', acquisition_profile: visualProfile },
      ],
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
    ).rejects.toThrow(
      'Requirement resource identities must be repaired in place',
    )
  })

  it('does not let inventory work expand the canonical target formats', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      provisionalResourceAdapters: CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS,
      resourceLibraryUsage: 'preferred',
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['png'] },
      requirements: [
        { id: 'visual.marker', acquisition_profile: visualProfile },
      ],
    })

    await expect(
      tool.call({
        action: 'author_provisional_resources',
        resources: [
          {
            id: 'audio-placeholder',
            destination_path: 'assets/runtime/audio/cues.wav',
            format: 'wav',
            reason: 'No matching library audio was selected.',
            selection_reason: ['Independent audible placeholder.'],
            asset_kind: 'audio-bank',
            parameters: { cue_ids: ['action'] },
          },
        ],
      }),
    ).rejects.toThrow('canonical resource plan does not allow format: wav')
  })

  it('requires content references to be removed before pruning inventory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-'))
    roots.push(workspace)
    const tool = createNativeAssetManifestTool({
      buildTool: value => value,
      workspacePath: workspace,
      provisionalResourceAdapters: CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS,
      resourceLibraryUsage: 'preferred',
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['png', 'json'] },
      requirements: [
        { id: 'visual.marker', acquisition_profile: visualProfile },
      ],
    })
    await tool.call({
      action: 'author_provisional_resources',
      resources: [
        {
          id: 'referenced-inventory-leaf',
          destination_path: 'assets/runtime/referenced.png',
          format: 'png',
          reason: 'Temporary inventory leaf.',
          selection_reason: ['Used by canonical content.'],
          asset_kind: 'image',
        },
      ],
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
      provisionalResourceAdapters: CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS,
      resourceLibraryUsage: 'preferred',
    }) as Tool
    await tool.call({
      action: 'submit_resource_plan',
      project_target: { asset_format_capabilities: ['png'] },
      requirements: [
        { id: 'visual.marker', acquisition_profile: visualProfile },
      ],
    })
    await tool.call({
      action: 'author_provisional_resources',
      resources: [
        {
          id: 'missing-inventory-leaf',
          destination_path: 'assets/runtime/missing.png',
          format: 'png',
          reason: 'Temporary inventory leaf.',
          selection_reason: ['No longer used.'],
          asset_kind: 'image',
        },
      ],
    })
    await rm(join(workspace, 'assets/runtime/missing.png'))

    await tool.call({
      action: 'prune_unbound_resources',
      resource_ids: ['missing-inventory-leaf'],
    })
    expect((await readBeeGameAssetManifest(workspace)).resources).toEqual([])
  })
})
