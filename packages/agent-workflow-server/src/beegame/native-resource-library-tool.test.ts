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
  inputSchema: {
    safeParse(input: unknown): { success: boolean }
  }
}

describe('native ResourceLibrary tool', () => {
  test('requires an exact element to be observed before acquisition', async () => {
    const workspace = await createWorkspace()
    let observedLimit: number | undefined
    const client = resourceClient(input => {
      observedLimit = input.limit
    })
    const tool = createTool(workspace, client)
    const selection = {
      action: 'import_resources',
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
    try {
      await expect(tool.call(selection)).rejects.toThrow(
        'Browse the selected Resource Library element before importing it',
      )
      await tool.call({ action: 'browse_catalog' })
      expect(observedLimit).toBe(8)
      await expect(tool.call(selection)).resolves.toEqual({
        data: expect.objectContaining({
          result: 'imported',
          verified_count: 1,
          resources: [expect.objectContaining({ resource_id: 'resource-a' })],
        }),
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('exposes broad structured browsing and no requirement-binding operation', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace, resourceClient())
    try {
      const prompt = await tool.prompt()
      expect(prompt).toContain('Begin broadly')
      expect(prompt).toContain('independently replaceable')
      expect(prompt).toContain('next_cursor as cursor without filters')
      const permission = await tool.checkPermissions({
        action: 'browse_catalog',
        filters: { dimensions: ['3D'] },
      })
      expect(permission.behavior).toBe('allow')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('blocks every catalog operation until durable prior-dispatch files are registered', async () => {
    const workspace = await createWorkspace()
    const barrierPath = 'assets/runtime/durable.glb'
    const tool = createTool(workspace, resourceClient(), [barrierPath])
    try {
      expect(await tool.prompt()).toContain(
        'register every path in contract.existingUnregisteredResourcePaths',
      )
      await expect(tool.call({ action: 'browse_catalog' })).rejects.toThrow(
        `registered through AssetManifest: ${barrierPath}`,
      )

      await writeBeeGameAssetManifest(workspace, {
        version: 7,
        project_target: {
          asset_format_capabilities: ['glb'],
          resource_library_usage: 'optional',
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [],
        resources: [
          {
            id: 'durable-resource',
            source: {
              type: 'agent-authored',
              created_at: '2026-08-01T00:00:00.000Z',
              reason: 'A standalone replaceable resource.',
            },
            root_path: barrierPath,
            file_paths: [barrierPath],
            provisional: true,
            status: 'verified',
            selected_at: '2026-08-01T00:00:00.000Z',
            selection_reason: ['Provides durable material.'],
          },
        ],
      })

      await expect(tool.call({ action: 'browse_catalog' })).resolves.toEqual({
        data: expect.objectContaining({ total: 1 }),
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('keeps catalog discovery single-pass across ordinary recovery dispatches', async () => {
    const workspace = await createWorkspace()
    try {
      await writeBeeGameAssetManifest(workspace, {
        version: 7,
        project_target: {
          asset_format_capabilities: ['glb'],
          resource_library_usage: 'optional',
          runtime_asset_root: 'assets/runtime',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
        requirements: [],
        resources: [
          {
            id: 'existing-resource',
            source: {
              type: 'agent-authored',
              created_at: '2026-08-01T00:00:00.000Z',
              reason: 'Existing material from the initial production pass.',
            },
            root_path: 'assets/runtime/existing.glb',
            file_paths: ['assets/runtime/existing.glb'],
            provisional: true,
            status: 'verified',
            selected_at: '2026-08-01T00:00:00.000Z',
            selection_reason: ['Provides existing material.'],
          },
        ],
      })

      const recoveryTool = createTool(workspace, resourceClient())
      await expect(
        recoveryTool.call({ action: 'browse_catalog' }),
      ).rejects.toThrow(
        'ResourceLibrary reopens only for an exact semantic review finding',
      )

      const remediationTool = createTool(
        workspace,
        resourceClient(),
        undefined,
        true,
      )
      await expect(
        remediationTool.call({ action: 'browse_catalog' }),
      ).resolves.toEqual({ data: expect.objectContaining({ total: 1 }) })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('returns one bounded snake-case selection contract without duplicate categories', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace, resourceClient())
    try {
      expect(
        tool.inputSchema.safeParse({
          action: 'browse_catalog',
          filters: { categories: ['models'] },
        }).success,
      ).toBe(false)

      const result = await tool.call({ action: 'browse_catalog' })
      expect(result.data).toEqual(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              pack_id: 'pack-a',
              pack_version: '1.0.0',
              element_id: 'element-a',
              element_path: 'model.glb',
              usage_tags: [],
              dependency_count: 0,
            }),
          ],
          filter_values: expect.objectContaining({
            dimensions: ['3D'],
            formats: ['glb'],
          }),
          catalog_revision: 'a'.repeat(64),
        }),
      )
      expect(result.data).not.toHaveProperty('facets')
      expect(result.data).not.toHaveProperty('filter_values.categories')
      expect(result.data.items).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ category: 'models' })]),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('summarizes large inspected metadata instead of returning catalog internals', async () => {
    const workspace = await createWorkspace()
    const client = resourceClient()
    const originalBrowse = client.browseCatalog
    client.browseCatalog = async input => {
      const page = await originalBrowse(input)
      return {
        ...page,
        items: page.items.map(item => ({
          ...item,
          contentProfile: {
            packaging: 'external-dependencies' as const,
            components: Array.from({ length: 40 }, (_, index) => ({
              id: `mesh:${index}`,
              kind: 'mesh' as const,
            })),
            inspection: {
              status: 'complete' as const,
              source: 'server' as const,
              inspectorVersion: 'resource-inspection-v1',
            },
          },
          technicalFacts: {
            vertices: 120,
            materialTextureCandidates: 'x'.repeat(2_000),
          },
        })),
      }
    }
    const tool = createTool(workspace, client)
    try {
      const result = await tool.call({ action: 'browse_catalog' })
      const encoded = JSON.stringify(result.data)
      expect(encoded).not.toContain('mesh:39')
      expect(encoded).not.toContain('x'.repeat(500))
      expect(result.data.items).toEqual([
        expect.objectContaining({
          content_profile: {
            packaging: 'external-dependencies',
            component_counts: { mesh: 40 },
            inspection: {
              status: 'complete',
              source: 'server',
              inspector_version: 'resource-inspection-v1',
            },
          },
          technical_facts: { vertices: 120 },
          omitted_technical_fact_keys: ['materialTextureCandidates'],
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

function createTool(
  workspacePath: string,
  client: ProjectResourceSelectionClient,
  registrationBarrierPaths?: string[],
  allowCatalogWithExistingInventory?: boolean,
): ToolDefinition {
  return createNativeResourceLibraryTool({
    buildTool: definition => definition,
    workspacePath,
    registrationBarrierPaths,
    allowCatalogWithExistingInventory,
    client,
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])),
  }) as ToolDefinition
}

function resourceClient(
  onBrowse?: (input: { limit?: number }) => void,
): ProjectResourceSelectionClient {
  return {
    browseCatalog: async input => {
      onBrowse?.(input)
      return {
      items: [
        {
          packId: 'pack-a',
          packVersion: '1.0.0',
          packName: 'Pack',
          packStyles: ['style'],
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
      facets: {
        dimensions: ['3D'],
        primaryCategories: [],
        categories: ['models'],
        styles: ['style'],
        gameTypes: [],
        packTags: [],
        usageTags: [],
        assetKinds: [],
        capabilities: [],
        formats: ['glb'],
      },
      catalogRevision: 'a'.repeat(64),
      normalizedFilters: {},
      }
    },
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

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-native-resource-'))
  await writeBeeGameAssetManifest(workspace, {
    version: 7,
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
