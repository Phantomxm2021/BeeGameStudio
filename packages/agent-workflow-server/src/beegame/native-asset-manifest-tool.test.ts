import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
      asset_format_capabilities: ['svg', 'json', 'yaml'],
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
    expect((await readBeeGameAssetManifest(workspace)).resources).toEqual([
      expect.objectContaining({
        id: 'player-placeholder',
        status: 'verified',
        provisional: true,
      }),
    ])
  })
})
