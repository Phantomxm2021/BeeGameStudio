import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { createNativeResourceLibraryTool } from './native-resource-library-tool'
import type { ProjectResourceSelectionClient } from './project-resource-application'

type ToolDefinition = {
  call(input: unknown): Promise<{ data: Record<string, unknown> }>
  checkPermissions(input: unknown): Promise<Record<string, unknown>>
  prompt(): Promise<string>
  inputSchema: { safeParse(input: unknown): { success: boolean } }
}

describe('native ResourceLibrary tool', () => {
  test('requires selected Pack inspection before exact import', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace, resourceClient())
    const selection = importInput()
    try {
      await expect(tool.call(selection)).rejects.toThrow(
        'Browse the selected Resource Library element before importing it',
      )
      await tool.call({ action: 'list_packs' })
      await expect(tool.call(selection)).rejects.toThrow(
        'Browse the selected Resource Library element before importing it',
      )
      await tool.call({ action: 'inspect_pack', pack_id: 'pack-a' })
      await expect(tool.call(selection)).resolves.toEqual({
        data: expect.objectContaining({
          result: 'imported',
          verified_count: 1,
        }),
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('exposes only Pack listing, Pack inspection and exact import actions', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace, resourceClient())
    try {
      expect(tool.inputSchema.safeParse({ action: 'list_packs' }).success).toBe(
        true,
      )
      expect(
        tool.inputSchema.safeParse({
          action: 'inspect_pack',
          pack_id: 'pack-a',
        }).success,
      ).toBe(true)
      expect(
        tool.inputSchema.safeParse({ action: 'unsupported' }).success,
      ).toBe(false)
      expect(await tool.prompt()).toContain('Start with list_packs')
      expect(
        (await tool.checkPermissions({ action: 'list_packs' })).behavior,
      ).toBe('allow')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('returns compact Pack summaries before bounded element details', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace, resourceClient())
    try {
      await expect(tool.call({ action: 'list_packs' })).resolves.toEqual({
        data: {
          packs: [
            expect.objectContaining({ pack_id: 'pack-a', element_count: 1 }),
          ],
          total: 1,
        },
      })
      const result = await tool.call({
        action: 'inspect_pack',
        pack_id: 'pack-a',
      })
      expect(result.data).toEqual(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              element_id: 'element-a',
              dependency_count: 0,
            }),
          ],
          total: 1,
        }),
      )
      expect(result.data).not.toHaveProperty('facets')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('pins import to the observed Pack version', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace, resourceClient())
    try {
      await tool.call({ action: 'inspect_pack', pack_id: 'pack-a' })
      const input = importInput()
      input.selections[0]!.expected_pack_version = '2.0.0'
      await expect(tool.call(input)).rejects.toThrow(
        'selected Pack version differs from the observed catalog version',
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

function createTool(
  workspacePath: string,
  client: ProjectResourceSelectionClient,
): ToolDefinition {
  return createNativeResourceLibraryTool({
    buildTool: definition => definition,
    workspacePath,
    client,
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])),
  }) as ToolDefinition
}

function resourceClient(): ProjectResourceSelectionClient {
  return {
    listPacks: async () => ({
      items: [
        {
          packId: 'pack-a',
          packVersion: '1.0.0',
          packName: 'Pack',
          dimension: '3D',
          primaryCategory: 'world-scene',
          styles: ['stylized'],
          gameTypes: [],
          tags: [],
          categories: ['models'],
          usageTags: [],
          assetKinds: ['model'],
          capabilities: [],
          formats: ['glb'],
          readyElementCount: 1,
          license: 'test-license',
          compatibleEngines: [],
        },
      ],
      total: 1,
      facets: facets(),
    }),
    inspectPack: async () => ({
      items: [
        {
          packId: 'pack-a',
          packVersion: '1.0.0',
          packName: 'Pack',
          packStyles: ['stylized'],
          packGameTypes: [],
          elementId: 'element-a',
          elementName: 'Element',
          elementPath: 'model.glb',
          category: 'models',
          usageTags: [],
          dimension: '3D',
          capabilities: [],
          relations: [],
          dependencyCount: 0,
        },
      ],
      total: 1,
      facets: facets(),
    }),
    resolveResources: async selections =>
      selections.map(selection => ({
        resourceId: selection.resourceId,
        packId: selection.packId,
        packVersion: selection.expectedPackVersion,
        elementId: selection.elementId,
        elementPath: 'model.glb',
        sourceUrl: 'https://download.invalid/model',
        selectionReason: selection.selectionReason,
        dependencies: [],
      })),
  }
}

function importInput() {
  return {
    action: 'import_resources' as const,
    selections: [
      {
        resource_id: 'resource-a',
        pack_id: 'pack-a',
        expected_pack_version: '1.0.0',
        element_id: 'element-a',
        destination_path: 'assets/runtime/library',
        selection_reason: ['Observed semantic and technical fit.'],
      },
    ],
  }
}

function facets() {
  return {
    dimensions: ['3D' as const],
    primaryCategories: [],
    categories: ['models' as const],
    styles: ['stylized'],
    gameTypes: [],
    packTags: [],
    usageTags: [],
    assetKinds: ['model' as const],
    capabilities: [],
    formats: ['glb'],
  }
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-native-resource-'))
  await writeBeeGameAssetManifest(workspace, {
    version: 8,
    project_target: {
      asset_format_capabilities: ['glb'],
      resource_library_usage: 'optional',
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [],
    resources: [],
  })
  return workspace
}
