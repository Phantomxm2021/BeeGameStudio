import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { createNativeResourceInventoryCommitTool } from './native-resource-inventory-commit-tool'

describe('native CommitResourceInventory tool', () => {
  test('publishes the canonical decision fields and runtime destination boundary', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-native-inventory-'))
    try {
      await writeBeeGameAssetManifest(workspace, {
        version: 8,
        project_target: {
          asset_format_capabilities: ['gltf'],
          resource_library_usage: 'optional',
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [{
          id: 'visual.tower',
          required: true,
          acquisition_profile: {
            dimensions: ['3D'],
            asset_kinds: ['model'],
            usage_tags: ['building'],
            capabilities: [],
            styles: ['stylized'],
          },
        }],
        resources: [],
      })
      const definition = createNativeResourceInventoryCommitTool({
        buildTool: value => value,
        workspacePath: workspace,
        dispatchId: 'dispatch-test',
        client: {} as never,
        provisionalAdapters: [{
          format: 'gltf',
          assetKinds: ['model'],
          description: 'gltf model placeholder',
          author: () => ({ bytes: '', descriptor: {}, technicalFacts: {} }),
        }],
        fetchImpl: async () => new Response(),
        assertMutationAuthority: async () => undefined,
      }) as {
        prompt(): Promise<string>
        inputSchema: { safeParse(input: unknown): { success: boolean } }
      }

      expect(definition.inputSchema.safeParse({ decisions: [] }).success).toBe(true)
      expect(definition.inputSchema.safeParse({}).success).toBe(true)
      await expect(definition.prompt()).resolves.toEqual(expect.stringContaining(
        'expected_pack_version (copy the candidate pack_version here)',
      ))
      await expect(definition.prompt()).resolves.toEqual(expect.stringContaining(
        'submitting decisions: []',
      ))
      await expect(definition.prompt()).resolves.toEqual(expect.stringContaining(
        'Every destination_path must be under assets/runtime',
      ))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
