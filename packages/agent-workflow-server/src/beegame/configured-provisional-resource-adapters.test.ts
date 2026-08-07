import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RESOURCE_ASSET_KINDS } from '@bee-game-studio/beegame-resource-core'
import { CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS } from './configured-provisional-resource-adapters'
import { createNativeResourceInventoryCommitTool } from './native-resource-inventory-commit-tool'
import { writeBeeGameAssetManifest } from './asset-contracts'

describe('configured provisional resource adapters', () => {
  test('cover every canonical semantic asset kind through one current adapter set', () => {
    const covered = new Set(
      CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS.flatMap(adapter => adapter.assetKinds),
    )
    expect(RESOURCE_ASSET_KINDS.filter(kind => !covered.has(kind))).toEqual([])
  })

  test('authors a portable JSON program resource for a non-media semantic kind', () => {
    const adapter = CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS.find(item => item.format === 'json')
    expect(adapter).toBeDefined()
    const result = adapter!.author({
      assetKind: 'font',
      parameters: { family_role: 'interface' },
    })
    expect(JSON.parse(String(result.bytes))).toEqual({
      version: 1,
      kind: 'programmatic-placeholder',
      asset_kind: 'font',
      parameters: { family_role: 'interface' },
    })
    expect(result.descriptor).toEqual(expect.objectContaining({
      representation: 'programmatic-recipe',
    }))
  })

  test('projects only active target adapters into the sole commit tool prompt', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-adapter-prompt-'))
    await writeBeeGameAssetManifest(workspacePath, {
      version: 8,
      project_target: {
        asset_format_capabilities: ['png', 'json'],
        resource_library_usage: 'preferred',
        runtime_asset_root: 'assets/runtime',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
      requirements: [],
      resources: [],
    })
    const tool = createNativeResourceInventoryCommitTool({
      buildTool: definition => definition,
      workspacePath,
      dispatchId: 'dispatch',
      client: { matchRequirements: async () => ({ catalogRevision: 'revision', groups: [] }), resolveResources: async () => [] },
      provisionalAdapters: CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS,
      fetchImpl: async () => new Response(),
      assertMutationAuthority: async () => undefined,
    }) as {
      prompt(): Promise<string>
      inputSchema: { safeParse(input: unknown): { success: boolean } }
    }
    try {
      const prompt = await tool.prompt()
      expect(prompt).toContain('png:')
      expect(prompt).toContain('json:')
      expect(prompt).not.toContain('gltf:')
      expect(prompt).not.toContain('wav:')
      expect(tool.inputSchema.safeParse({
        decisions: [{
          requirement_id: 'visual', kind: 'placeholder', resource_id: 'resource',
          selection_reason: ['No match.'], destination_path: 'assets/runtime/resource.json',
          format: 'json', reason: 'No match.', asset_kind: 'material',
          capabilities: ['alpha'],
        }],
      }).success).toBe(false)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
