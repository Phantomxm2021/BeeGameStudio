import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBeeGameAssetManifest } from './asset-contracts'
import { createNativeAssetManifestTool } from './native-asset-manifest-tool'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

type Tool = {
  call(input: unknown): Promise<{ data: Record<string, unknown> }>
  prompt(): Promise<string>
  inputSchema: { safeParse(input: unknown): { success: boolean } }
}

describe('native AssetManifest planning tool', () => {
  test('commits the sole canonical plan with structured acquisition profiles', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace)
    await expect(tool.call(planInput())).resolves.toEqual({
      data: { accepted: true, requirement_count: 1 },
    })
    expect((await readBeeGameAssetManifest(workspace)).requirements[0]).toEqual(
      expect.objectContaining({ id: 'visual.player', acquisition_profile: profile }),
    )
    expect(await tool.prompt()).toContain('CommitResourceInventory')
  })

  test('rejects requirements without the canonical acquisition profile', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace)
    const input = planInput() as Record<string, unknown>
    input.requirements = [{ id: 'visual.player', required: true }]
    await expect(tool.call(input)).rejects.toThrow('acquisition_profile')
  })

  test('rejects aggregate capabilities when coverage declares multiple resource parts', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace)
    const input = planInput() as Record<string, unknown>
    input.requirements = [{
      id: 'visual.player',
      required: true,
      acquisition_profile: {
        dimensions: ['3D'],
        asset_kinds: ['model', 'texture'],
        usage_tags: ['character'],
        capabilities: ['contains-materials'],
        styles: ['stylized'],
        coverage: [{ asset_kinds: ['model'] }, { asset_kinds: ['texture'] }],
      },
    }]

    await expect(tool.call(input)).rejects.toThrow('capabilities must be empty when coverage declares multiple resource parts')
  })

  test('does not expose acquisition, placeholder or inventory completion actions', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace)
    expect(tool.inputSchema.safeParse({ action: 'unsupported' }).success).toBe(false)
  })
})

const profile = {
  dimensions: ['2D'] as const,
  asset_kinds: ['sprite'] as const,
  usage_tags: ['character'] as const,
  capabilities: [],
  styles: ['stylized'],
}

function planInput() {
  return {
    action: 'submit_resource_plan' as const,
    project_target: { asset_format_capabilities: ['png'] },
    requirements: [{ id: 'visual.player', required: true, acquisition_profile: profile }],
  }
}

function createTool(workspacePath: string): Tool {
  return createNativeAssetManifestTool({
    buildTool: definition => definition,
    workspacePath,
    resourceLibraryUsage: 'preferred',
  }) as Tool
}

async function createWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-manifest-tool-'))
  roots.push(workspace)
  return workspace
}
